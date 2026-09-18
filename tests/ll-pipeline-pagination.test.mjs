// Run: node --test tests/ll-pipeline-pagination.test.mjs
// Optional SQL/UI checks: set PGLITE_MODULE and REACT_RENDERER_MODULE to the
// entry points of disposable test dependencies (no project dependency changes).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
function loadSource(path, overrides = {}) {
  const filename = fileURLToPath(new URL("../" + path, import.meta.url));
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const localRequire = (id) =>
    Object.hasOwn(overrides, id) ? overrides[id] : require(id);
  new Function("require", "module", "exports", outputText)(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}

const constants = loadSource("src/constants/llPipeline.ts");
let requests = [];
let respond;
const supabase = createClient("https://pipeline.test", "test-key", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: async (url, options) => {
      requests.push({ url: new URL(url), ...options });
      return respond(requests.at(-1));
    },
  },
});
const queries = loadSource("src/queries/llApplications.ts", {
  "@tanstack/react-query": { useQuery: (options) => options },
  "@/constants/llPipeline": constants,
  "@/lib/supabaseClient": { supabase },
});
const filters = {
  queue: "all",
  search: "",
  route: "all",
  dateField: "updated_at",
  dateFrom: "",
  dateTo: "",
};
const success = () =>
  new Response(JSON.stringify([{ id: "page-record" }]), {
    headers: { "content-range": "0-0/47", "content-type": "application/json" },
  });
async function fetchPage(queue, page = 1, changes = {}) {
  requests = [];
  respond = success;
  const options = queries.useLLApplicationsPage(
    { ...filters, queue, ...changes },
    page,
  );
  const result = await options.queryFn({
    signal: new AbortController().signal,
  });
  return { options, result, request: requests[0] };
}

test("all eight tabs request exactly one database page with exact totals", async () => {
  for (const queue of [
    "all",
    ...constants.LL_PHASES.map((phase) => phase.key),
    "escalations",
  ]) {
    const { options, result, request } = await fetchPage(queue, 3);
    const names = request.url.searchParams.get("select");
    assert.equal(names, "*,Learner(id,name,phone,email,area)");
    assert.equal(queries.LL_PIPELINE_PAGE_SIZE, 15);
    assert.equal(
      request.url.pathname,
      "/rest/v1/rpc/get_ll_pipeline_applications",
    );
    assert.equal(request.url.searchParams.get("offset"), "30");
    assert.equal(request.url.searchParams.get("limit"), "15");
    assert.equal(
      request.url.searchParams.get("order"),
      "updated_at.desc,id.desc",
    );
    assert.match(new Headers(request.headers).get("Prefer"), /count=exact/);
    assert.equal(result.total, 47);
    assert.equal(result.data.length, 1);
    assert.equal(requests.length, 1);
    assert.deepEqual(options.queryKey.slice(0, 2), ["ll-applications", "page"]);
    assert.equal(options.queryKey[3], 3);
    if (queue === "all") {
      assert.equal(request.url.searchParams.has("status"), false);
    } else if (queue === "escalations") {
      assert.match(request.url.searchParams.get("or"), /escalated.is.true/);
      for (const status of Object.keys(constants.LL_FAILURE_STAGES)) {
        assert.ok(request.url.searchParams.get("or").includes(status));
      }
    } else {
      const predicate = request.url.searchParams.get("status");
      for (const stage of constants.LL_STAGES.filter(
        (s) => s.phase === queue,
      )) {
        assert.ok(predicate.includes(stage.key));
      }
      for (const status of Object.keys(constants.LL_FAILURE_STAGES)) {
        if (constants.llStagePhase(status) === queue) {
          assert.ok(predicate.includes(status));
        }
      }
    }
  }
});

test("search/route/date filters go to the database without learner-ID requests", async () => {
  const { request } = await fetchPage("escalations", 2, {
    search: "  Add-on, name mismatch  ",
    route: "D",
    dateField: "created_at",
    dateFrom: "2026-09-01",
    dateTo: "2026-09-18",
  });
  assert.deepEqual(JSON.parse(request.body), {
    search_term: "Add-on, name mismatch",
    search_routes: ["D"],
  });
  assert.equal(request.url.searchParams.get("batch_code"), "eq.D");
  assert.deepEqual(request.url.searchParams.getAll("created_at"), [
    "gte.2026-09-01T00:00:00+05:30",
    "lte.2026-09-18T23:59:59+05:30",
  ]);
  assert.equal(requests.length, 1);
  assert.equal(queries.useLLApplicationsPage(filters, 1, false).enabled, false);
});

test("out-of-range pages recover with a filtered count-only request", async () => {
  requests = [];
  respond = () =>
    requests.length === 1
      ? new Response(JSON.stringify({ code: "PGRST103", message: "range" }), {
          status: 416,
        })
      : new Response(null, { headers: { "content-range": "*/16" } });
  const options = queries.useLLApplicationsPage(
    { ...filters, queue: "documents", search: "learner", route: "A" },
    3,
  );
  assert.deepEqual(
    await options.queryFn({ signal: new AbortController().signal }),
    { data: [], total: 16 },
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[1].method, "HEAD");
  assert.equal(requests[1].url.searchParams.has("offset"), false);
  assert.equal(requests[1].url.searchParams.get("search_term"), "learner");
  assert.equal(requests[1].url.searchParams.get("batch_code"), "eq.A");
});

test("selected details reuse page data and keep the invalidation prefix", () => {
  const application = { id: "selected" };
  const selected = queries.useLLApplication(application.id, application);
  assert.equal(selected.enabled, false);
  assert.equal(selected.initialData, application);
  assert.deepEqual(selected.queryKey, [
    "ll-applications",
    "detail",
    "selected",
  ]);
  assert.equal(queries.useLLApplication(application.id).enabled, true);
  assert.equal(queries.useLLApplication(null).enabled, false);
});

test(
  "SQL search/count/range exceeds old lookup and response caps, preserving RLS",
  {
    skip: !process.env.PGLITE_MODULE,
  },
  async () => {
    const { PGlite } = await import(process.env.PGLITE_MODULE);
    const db = new PGlite();
    try {
      await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE public."Learner" (id uuid PRIMARY KEY, name text, phone text, email text);
      CREATE TABLE public.ll_applications (
        id uuid PRIMARY KEY, learner_id uuid REFERENCES public."Learner"(id),
        application_number text, ll_number text, batch_code text, status text,
        escalated boolean, updated_at timestamptz
      );
      INSERT INTO public."Learner"
        SELECT md5(i::text)::uuid, 'Shared learner ' || i, '555' || i, i || '@example.test'
        FROM generate_series(1,1120) i;
      INSERT INTO public.ll_applications
        SELECT id, id, 'APP-' || name, 'LL-' || phone, 'A', 'payment_received', false, now()
        FROM public."Learner";
    `);
      await db.exec(
        readFileSync(
          new URL(
            "../supabase/migrations/20260918000700_ll_pipeline_pagination.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const count = async (search, routes = []) =>
        (
          await db.query(
            "SELECT count(*)::int AS total FROM get_ll_pipeline_applications($1,$2)",
            [search, routes],
          )
        ).rows[0].total;
      assert.equal(await count("shared"), 1120);
      const page = (
        await db.query(`
      SELECT * FROM get_ll_pipeline_applications('SHARED')
      ORDER BY updated_at DESC, id DESC LIMIT 15 OFFSET 1095
    `)
      ).rows;
      assert.equal(page.length, 15);
      const nextPage = (
        await db.query(`
      SELECT * FROM get_ll_pipeline_applications('SHARED')
      ORDER BY updated_at DESC, id DESC LIMIT 15 OFFSET 1110
    `)
      ).rows;
      assert.equal(nextPage.length, 10);
      assert.equal(
        new Set([...page, ...nextPage].map((row) => row.id)).size,
        25,
      );
      assert.equal(await count("5551120"), 1);
      assert.equal(await count("1120@example.test"), 1);
      assert.equal(await count("LL-5551120"), 1);
      assert.equal(await count("APP-Shared learner 1120"), 1);
      assert.equal(await count("unknown"), 0);
      assert.equal(await count("Out of state", ["A"]), 1120);
      assert.equal(await count("%"), 0); // Literal search, not wildcard expansion.
      await db.exec(`
      UPDATE public."Learner" SET name = 'Comma, (quoted) learner' WHERE phone = '5551';
      ALTER TABLE public.ll_applications ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public."Learner" ENABLE ROW LEVEL SECURITY;
      CREATE POLICY applications_visible ON public.ll_applications FOR SELECT
        USING (id <> md5('1120')::uuid);
      CREATE POLICY learners_visible ON public."Learner" FOR SELECT
        USING (phone <> '5551');
      GRANT SELECT ON public.ll_applications, public."Learner" TO authenticated;
    `);
      assert.equal(await count("Comma, (quoted) learner"), 1);
      await db.exec("SET ROLE authenticated");
      assert.equal(await count(""), 1119);
      assert.equal(await count("Comma, (quoted) learner"), 0);
      await db.exec("RESET ROLE; SET ROLE anon");
      await assert.rejects(count(""), /permission denied/);
    } finally {
      await db.close();
    }
  },
);

test(
  "UI retains independent pages, resets filters/search, and disables boundary controls",
  {
    skip: !process.env.REACT_RENDERER_MODULE,
  },
  async () => {
    const rendererRequire = createRequire(process.env.REACT_RENDERER_MODULE);
    const React = rendererRequire("react");
    const { create, act } = rendererRequire(process.env.REACT_RENDERER_MODULE);
    const hosts = new Proxy(
      { __esModule: true },
      {
        get: (target, key) =>
          key in target
            ? target[key]
            : (props) =>
                React.createElement(String(key), props, props.children),
      },
    );
    let activePage;
    let total = 47;
    const mockQueries = new Proxy(
      {
        ...queries,
        useLLApplicationsPage: (activeFilters, page, enabled) => {
          activePage = { ...activeFilters, page, enabled };
          return {
            data: {
              data: Array.from(
                { length: Math.max(0, Math.min(15, total - (page - 1) * 15)) },
                (_, index) => ({
                  id: `${activeFilters.queue}-${page}-${index}`,
                  status: "payment_received",
                  Learner: { name: `Learner on page ${page}`, phone: "555" },
                }),
              ),
              total,
            },
            isLoading: false,
            isFetching: false,
          };
        },
        useLLApplication: () => ({}),
        useLLQueueCounts: () => ({ data: {} }),
        useLLLearnerSearch: () => ({ data: [] }),
        useActiveLLApplication: () => ({}),
        useUpdateLLStatus: () => ({}),
        useRevertLLStatus: () => ({}),
        useUpdateLLFields: () => ({}),
        useCreateLLApplication: () => ({}),
      },
      { get: (target, key) => (key in target ? target[key] : () => ({})) },
    );
    const overrides = {
      react: React,
      "react/jsx-runtime": rendererRequire("react/jsx-runtime"),
      "@tanstack/react-query": { useQueryClient: () => ({}) },
      "react-router-dom": { useNavigate: () => () => {} },
      "lucide-react": hosts,
      "@/constants/llPipeline": constants,
      "@/queries/llApplications": mockQueries,
      "@/queries/userManagement": { useCurrentUser: () => ({}) },
      "@/hooks/useDebouncedValue": loadSource(
        "src/hooks/useDebouncedValue.ts",
        { react: React },
      ),
      "@/components/ui/use-toast": { useToast: () => ({ toast: () => {} }) },
    };
    for (const name of [
      "badge",
      "button",
      "card",
      "dialog",
      "input",
      "scroll-area",
      "select",
      "textarea",
    ])
      overrides["@/components/ui/" + name] = hosts;
    overrides["@/components/admin/LLDocumentsReview"] = hosts;
    const Pipeline = loadSource(
      "src/routes/admin/LLPipeline.tsx",
      overrides,
    ).default;
    let view;
    await act(async () => {
      view = create(React.createElement(Pipeline));
    });
    const button = (label) =>
      view.root
        .findAllByType("Button")
        .find((node) => node.props.children === label);
    const click = async (label) =>
      act(async () => {
        button(label).props.onClick();
      });
    const tab = async (index) =>
      act(async () => {
        view.root
          .findAllByType("button")
          .filter((node) => node.props.className?.includes("px-3 py-1"))
          [index].props.onClick();
      });
    const list = () =>
      view.root
        .findAllByType("button")
        .filter((node) => node.props.className?.includes("mb-2 block w-full"));
    try {
      assert.equal(list().length, 15);
      assert.ok(JSON.stringify(view.toJSON()).includes("47 records"));
      assert.equal(button("Previous").props.disabled, true);
      await click("Next");
      assert.equal(list().length, 15); // Replace the page; never append records.
      await click("Next");
      await click("Next");
      assert.equal(activePage.page, 4);
      assert.equal(list().length, 2);
      assert.equal(button("Next").props.disabled, true);
      await tab(1);
      assert.equal(activePage.page, 1);
      await click("Next");
      await tab(0);
      assert.equal(activePage.page, 4);
      await tab(1);
      assert.equal(activePage.page, 2);
      for (let index = 2; index < 8; index++) {
        await tab(index);
        assert.equal(activePage.page, 1);
        await click("Next");
        assert.equal(activePage.page, 2);
      }
      await act(async () => {
        view.root
          .findAllByType("Input")
          .find((node) => node.props.placeholder?.startsWith("Name,"))
          .props.onChange({ target: { value: "learner" } });
      });
      assert.equal(activePage.page, 1);
      assert.equal(activePage.enabled, false); // No old-search page-one request.
      assert.equal(button("Next").props.disabled, true);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 330));
      });
      assert.equal(activePage.search, "learner");
      assert.equal(activePage.enabled, true);
      for (let index = 0; index < 8; index++) {
        await tab(index);
        assert.equal(activePage.page, 1);
      }
      await click("Next");
      await act(async () => {
        view.root.findAllByType("Select")[0].props.onValueChange("D");
      });
      assert.equal(activePage.page, 1);
      assert.equal(activePage.route, "D");
      await click("Next");
      await act(async () => {
        view.root
          .findAllByType("Input")
          .find((node) => node.props.type === "date")
          .props.onChange({ target: { value: "2026-09-18" } });
      });
      assert.equal(activePage.page, 1);
      assert.equal(activePage.dateFrom, "2026-09-18");
      await click("Next");
      await click("Next");
      await click("Next");
      total = 16;
      await act(async () => {
        view.update(React.createElement(Pipeline));
      });
      assert.equal(activePage.page, 2); // A mutation shrank the last page.
      assert.equal(list().length, 1);
    } finally {
      await act(async () => {
        view.unmount();
      });
    }
  },
);
