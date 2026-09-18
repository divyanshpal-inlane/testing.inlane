// Run: node --test tests/no-show-pagination.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadModule(path, overrides = {}, extra = "", globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source + extra, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) =>
      overrides[name] ?? (name.startsWith("@/") ? {} : require(name)),
    console,
    ...globals,
  });
  return module.exports;
}

function queries(path, respond) {
  const requests = [];
  const invalidations = [];
  const supabase = createClient("https://pagination.invalid", "test-key", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const url = new URL(input);
        requests.push({ url, init });
        return respond(url, init);
      },
    },
  });
  const hooks = loadModule(path, {
    "@/lib/supabaseClient": { supabase },
    "@tanstack/react-query": {
      useInfiniteQuery: (options) => options,
      useMutation: (options) => options,
      useQueryClient: () => ({
        invalidateQueries: (options) => invalidations.push(options.queryKey),
      }),
    },
  });
  return { hooks, requests, invalidations };
}

function response(rows, count) {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...(count == null
        ? {}
        : { "Content-Range": `0-${Math.max(0, rows.length - 1)}/${count}` }),
    },
  });
}

function batch(url, rows, counted = false) {
  const offset = Number(url.searchParams.get("offset"));
  const limit = Number(url.searchParams.get("limit"));
  assert.ok(
    limit > 0 && limit <= 21,
    "case requests must have a database-level limit",
  );
  return response(
    rows.slice(offset, offset + limit),
    counted ? rows.length : undefined,
  );
}

async function observe(options, run) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const observer = new InfiniteQueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await run(observer);
  } finally {
    unsubscribe();
    client.clear();
  }
}

test("reported cases load 20 at a time, append pages, and stop at the last record", async () => {
  const rows = Array.from({ length: 41 }, (_, i) => ({
    id: `case-${i}`,
    schedule_id: i + 1,
  }));
  const { hooks, requests } = queries("../src/queries/noShow.ts", (url) => {
    if (url.pathname.endsWith("/schedule_no_show")) return batch(url, rows);
    return response([]); // Schedule enrichment is limited to the loaded cases.
  });
  const options = hooks.useNoShowCases({ status: "open", party: "learner" });
  assert.equal(options.initialPageParam, 0);
  await observe(options, async (observer) => {
    let result = await observer.fetchNextPage({ cancelRefetch: false });
    assert.equal(result.data.pages.length, 1);
    assert.equal(result.data.pages[0].rows.length, 20);
    assert.equal(result.hasNextPage, true);
    result = await observer.fetchNextPage({ cancelRefetch: false });
    assert.equal(result.data.pages.flatMap((page) => page.rows).length, 40);
    result = await observer.fetchNextPage({ cancelRefetch: false });
    assert.equal(result.data.pages.flatMap((page) => page.rows).length, 41);
    assert.equal(result.hasNextPage, false);
    await observer.fetchNextPage({ cancelRefetch: false });
  });
  const cases = requests.filter(({ url }) =>
    url.pathname.endsWith("/schedule_no_show"),
  );
  assert.deepEqual(
    cases.map(({ url }) => url.searchParams.get("offset")),
    ["0", "20", "40"],
  );
  for (const { url } of cases) {
    assert.equal(url.searchParams.get("status"), "eq.open");
    assert.equal(url.searchParams.get("no_show_party"), "eq.learner");
    assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc");
  }
  const enrichment = requests.find(({ url }) =>
    url.pathname.endsWith("/Schedule"),
  );
  assert.equal(
    enrichment.url.searchParams.get("id").slice(3, -1).split(",").length,
    20,
  );
});

test("an exactly full final reported batch does not request an empty extra page", async () => {
  const { hooks } = queries("../src/queries/noShow.ts", (url) =>
    url.pathname.endsWith("/schedule_no_show")
      ? batch(
          url,
          Array.from({ length: 20 }, (_, i) => ({
            id: String(i),
            schedule_id: i,
          })),
        )
      : response([]),
  );
  const options = hooks.useNoShowCases();
  const page = await options.queryFn({
    pageParam: 0,
    signal: new AbortController().signal,
  });
  assert.equal(page.rows.length, 20);
  assert.equal(options.getNextPageParam(page), undefined);
});

test("potential cases exclude instructor flags in the database before pagination", async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({
    id: i,
    date: "2026-09-17",
  }));
  const { hooks, requests } = queries("../src/queries/noShow.ts", (url) =>
    batch(url, rows),
  );
  const options = hooks.usePotentialInstructorNoShows();
  const page = await options.queryFn({
    pageParam: 0,
    signal: new AbortController().signal,
  });
  assert.equal(page.rows.length, 20);
  assert.equal(options.getNextPageParam(page), 20);
  assert.equal(requests.length, 1, "no full-list or client-side flag lookup");
  const params = requests[0].url.searchParams;
  assert.match(params.get("select"), /flagged:schedule_no_show\(\)/);
  assert.equal(params.get("flagged.no_show_party"), "eq.instructor");
  assert.equal(params.get("flagged"), "is.null");
  assert.equal(params.get("status"), "eq.booked");
  assert.equal(params.get("started_at"), "is.null");
  assert.equal(params.get("order"), "date.desc,id.desc");
  assert.match(params.get("date"), /^gte\./);
  assert.equal(params.getAll("date").length, 2);
});

test("all fees and pending appeals paginate independently and retain database totals", async () => {
  const fees = Array.from({ length: 40 }, (_, i) => ({
    id: `fee-${i}`,
    schedule_id: i,
  }));
  const { hooks, requests } = queries("../src/queries/noShowFees.ts", (url) => {
    if (url.pathname.endsWith("/no_show_fee")) {
      const rows = url.searchParams.has("pending_appeal.status")
        ? fees.map((fee) => ({
            ...fee,
            pending_appeal: [{ id: `appeal-${fee.id}`, status: "pending" }],
          }))
        : fees;
      return batch(url, rows, true);
    }
    return response([]);
  });
  const all = hooks.useAllNoShowFees();
  const pending = hooks.useAllNoShowFees({ pendingAppealsOnly: true });
  assert.notDeepEqual(all.queryKey, pending.queryKey);
  for (const options of [all, pending]) {
    const first = await options.queryFn({
      pageParam: 0,
      signal: new AbortController().signal,
    });
    assert.equal(first.rows.length, 20);
    assert.equal(first.total, 40);
    if (options === pending) assert.equal(first.rows[0].appeal.status, "pending");
    assert.equal(options.getNextPageParam(first), 20);
    const last = await options.queryFn({
      pageParam: 20,
      signal: new AbortController().signal,
    });
    assert.equal(last.rows.length, 20);
    assert.equal(options.getNextPageParam(last), undefined);
  }
  const pendingRequest = requests.find(({ url }) =>
    url.searchParams.has("pending_appeal.status"),
  );
  assert.match(
    pendingRequest.url.searchParams.get("select"),
    /pending_appeal:no_show_appeal!inner\(\*\)/,
  );
  assert.equal(
    pendingRequest.url.searchParams.get("pending_appeal.status"),
    "eq.pending",
  );
  assert.match(pendingRequest.init.headers.get("Prefer"), /count=exact/);
});

test("failed database requests do not become empty successful pages", async () => {
  for (const [path, hook] of [
    ["../src/queries/noShow.ts", "useNoShowCases"],
    ["../src/queries/noShow.ts", "usePotentialInstructorNoShows"],
    ["../src/queries/noShowFees.ts", "useAllNoShowFees"],
  ]) {
    const { hooks } = queries(
      path,
      () =>
        new Response(JSON.stringify({ message: "Unavailable" }), {
          status: 500,
        }),
    );
    await assert.rejects(
      hooks[hook]().queryFn({
        pageParam: 0,
        signal: new AbortController().signal,
      }),
      (error) => error.message === "Unavailable",
    );
  }
});

test("mutations still invalidate the same case, potential, and fee query prefixes", () => {
  const noShow = queries("../src/queries/noShow.ts", () => response([]));
  noShow.hooks.useResolveNoShow().onSuccess();
  noShow.hooks.useFlagInstructorNoShow().onSuccess();
  assert.deepEqual(structuredClone(noShow.invalidations), [
    ["no_show_cases"],
    ["no_show_cases"],
    ["potential_instructor_no_shows"],
  ]);
  const fees = queries("../src/queries/noShowFees.ts", () => response([]));
  fees.hooks.useChargeNoShowFee().onSuccess();
  fees.hooks.useReviewAppeal().onSuccess();
  assert.deepEqual(structuredClone(fees.invalidations), [
    ["no_show_fees"],
    ["no_show_cases"],
    ["no_show_appeals"],
    ["no_show_fees"],
    ["learner_no_show_fees"],
  ]);
});

function scrollHarness(overrides = {}) {
  const listeners = new Map();
  const observers = [];
  const effects = [];
  const requests = [];
  const sentinel = { getBoundingClientRect: () => ({ top: 900, bottom: 901 }) };
  const exports = loadModule(
    "../src/routes/admin/NoShowManagement.tsx",
    {
      react: {
        useRef: (current) => ({ current }),
        useEffect: (effect) => effects.push(effect),
      },
    },
    "\nexports.testHelpers = { LoadMoreCases, loadedRows };",
    {
      window: {
        innerHeight: 800,
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type) => listeners.delete(type),
      },
      Element: class Element {},
      IntersectionObserver: class IntersectionObserver {
        constructor(callback) {
          this.callback = callback;
          observers.push(this);
        }
        observe() {}
        disconnect() {}
      },
    },
  );
  const element = exports.testHelpers.LoadMoreCases({
    hasNextPage: true,
    isFetching: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: async (options) => requests.push(options),
    ...overrides,
  });
  if (element) element.ref.current = sentinel;
  const cleanup = effects.map((effect) => effect());
  return { ...exports.testHelpers, listeners, observers, requests, cleanup };
}

test("scrolling appends one batch near the bottom, not on opening or repeated callbacks", () => {
  const harness = scrollHarness();
  harness.observers[0].callback([{ isIntersecting: true }]);
  assert.equal(harness.requests.length, 0);
  harness.listeners.get("scroll")({ target: {} });
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].cancelRefetch, false);
  harness.listeners.get("scroll")({ target: {} });
  harness.observers[0].callback([{ isIntersecting: true }]);
  assert.equal(harness.requests.length, 1);
  harness.cleanup.forEach((cleanup) => cleanup?.());
  assert.equal(harness.listeners.size, 0);
  const merged = harness.loadedRows(
    [
      { rows: [{ id: "a" }, { id: "b" }] },
      { rows: [{ id: "b" }, { id: "c" }] },
    ],
    (row) => row.id,
  );
  assert.deepEqual(
    structuredClone(merged).map((row) => row.id),
    ["a", "b", "c"],
  );
});

test("loading/exhausted lists cannot request more; failed pages retry only on a new scroll", () => {
  for (const overrides of [{ isFetching: true }, { hasNextPage: false }]) {
    const harness = scrollHarness(overrides);
    assert.equal(harness.observers.length, 0);
    assert.equal(harness.listeners.size, 0);
    assert.equal(harness.requests.length, 0);
  }
  const harness = scrollHarness({ isFetchNextPageError: true });
  harness.observers[0].callback([{ isIntersecting: true }]);
  assert.equal(harness.requests.length, 0);
  harness.listeners.get("scroll")({ target: {} });
  assert.equal(harness.requests.length, 1);
});
