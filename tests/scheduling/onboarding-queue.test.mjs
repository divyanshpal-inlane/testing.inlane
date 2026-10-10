// Offline regression tests: node --test tests/scheduling/onboarding-queue.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, imports) {
  const source = readFileSync(
    new URL(`../../${path}`, import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", "console", outputText)(
    (name) => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    module,
    module.exports,
    { error() {}, log() {} },
  );
  return module.exports;
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

// Minimal hooks/JSX harness exercises the real component's Save handler without
// a browser, credentials, network requests or writes to the production DB.
function selector({
  type = "new",
  isFlexible = false,
  prefs = [{ day_of_week: 0, time_slot: "6-9" }],
  savePreferences = async () => {},
  saveRequest = async () => {},
} = {}) {
  let cursor = 0;
  const state = [];
  const events = [];
  const jsx = (type, props) => ({ type, props });
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in state)) state[i] = initial;
      return [
        state[i],
        (value) => {
          state[i] = typeof value === "function" ? value(state[i]) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      return (state[i] ??= { current: initial });
    },
    useEffect(effect) {
      effect();
    },
  };
  const { default: Component } = load(
    "src/components/lesson/PreferenceSelector.tsx",
    {
      react: hooks,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-router-dom": {
        useNavigate:
          () =>
          (...args) =>
            events.push(["navigate", ...args]),
      },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/card": { Card: "Card", CardContent: "CardContent" },
      "@/components/ui/scroll-area": {
        ScrollArea: "ScrollArea",
        ScrollBar: "ScrollBar",
      },
      "@/lib/supabaseClient": {
        supabase: {
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { name: "New Learner" } }),
              }),
            }),
          }),
          functions: {
            invoke: async (...args) => {
              events.push(["notify", ...args]);
              return {};
            },
          },
        },
      },
      "@/queries/learner": {
        useMutationRescheduleRequest: () => ({
          mutateAsync: async (args) => {
            events.push(["request", args]);
            return saveRequest(args);
          },
        }),
      },
      "@/queries/preferences": {
        useSchedulePreferences: () => ({ data: prefs, isLoading: false }),
        useUpdatePreference: () => ({
          mutateAsync: async (args) => {
            events.push(["preferences", args]);
            return savePreferences(args);
          },
        }),
      },
      "@/types/schedule": {
        DAYS_OF_WEEK: ["Mon"],
        TIME_SLOTS: ["6-9"],
        TIME_SLOT_LABELS: { "6-9": "6–9 AM" },
      },
    },
  );
  const render = () => {
    cursor = 0;
    return Component({
      learnerId: "learner-1",
      lessons: ["virtual-lesson-1", "virtual-lesson-2"],
      type,
      isFlexible,
    });
  };
  render(); // seed the saved preferences via the effect
  const save = () =>
    nodes(render())
      .find((n) => n.type === "Button" && n.props.className === "w-full")
      .props.onClick();
  return { save, render, events };
}

test("Save waits for preferences AND request before navigating or notifying", async () => {
  const preferences = deferred();
  const request = deferred();
  const ui = selector({
    savePreferences: () => preferences.promise,
    saveRequest: () => request.promise,
  });
  const saving = ui.save();
  assert.deepEqual(
    ui.events.map(([name]) => name),
    ["preferences"],
  );
  preferences.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    ui.events.map(([name]) => name),
    ["preferences", "request"],
  );
  assert.deepEqual(ui.events[1][1].lessonIds, [
    "virtual-lesson-1",
    "virtual-lesson-2",
  ]);
  request.resolve();
  await saving;
  assert.equal(ui.events.at(-1)[0], "navigate");
});

test("request failure stays on screen with a visible error and permits retry", async () => {
  let attempts = 0;
  const ui = selector({
    saveRequest: async () => {
      if (++attempts === 1) throw new Error("RLS/network failure");
    },
  });
  await ui.save();
  assert.equal(
    ui.events.some(([name]) => name === "navigate" || name === "notify"),
    false,
  );
  const alert = nodes(ui.render()).find((n) => n.props?.role === "alert");
  assert.match(alert.props.children, /try Save again/);
  await ui.save();
  assert.equal(attempts, 2);
  assert.equal(ui.events.at(-1)[0], "navigate");
});

test("RLS rejection explains authorization failure without navigating or notifying", async () => {
  const ui = selector({
    saveRequest: async () => {
      throw { code: "42501", message: "new row violates row-level security policy" };
    },
  });
  await ui.save();
  assert.equal(
    ui.events.some(([name]) => name === "navigate" || name === "notify"),
    false,
  );
  const alert = nodes(ui.render()).find((n) => n.props?.role === "alert");
  assert.match(alert.props.children, /couldn't be authorized/);
  assert.match(alert.props.children, /selected timings have been kept/);
});

test("preference failure does not create a queue request", async () => {
  const ui = selector({
    savePreferences: async () => {
      throw new Error("write failed");
    },
  });
  await ui.save();
  assert.deepEqual(
    ui.events.map(([name]) => name),
    ["preferences"],
  );
});

test("rapid Save clicks submit once while a write is in flight", async () => {
  const preferences = deferred();
  const ui = selector({ savePreferences: () => preferences.promise });
  const first = ui.save();
  await ui.save();
  assert.equal(ui.events.length, 1);
  preferences.resolve();
  await first;
  assert.equal(ui.events.filter(([name]) => name === "request").length, 1);
});

test("empty availability is rejected without writes", async () => {
  const ui = selector({ prefs: [] });
  await ui.save();
  assert.equal(ui.events.length, 0);
  assert.match(
    nodes(ui.render()).find((n) => n.props?.role === "alert").props.children,
    /at least one/,
  );
});

test("flexible availability saves all slots and queues the learner", async () => {
  const ui = selector({ prefs: [], isFlexible: true });
  await ui.save();
  assert.deepEqual(ui.events[0][1].preferences, [{ day: 0, timeSlot: "6-9" }]);
  assert.equal(ui.events.filter(([name]) => name === "request").length, 1);
  assert.equal(ui.events.at(-1)[0], "navigate");
});

test("lesson10 queues a request; reschedule does not duplicate its existing request", async () => {
  for (const type of ["lesson10", "reschedule"]) {
    const ui = selector({ type });
    await ui.save();
    const requests = ui.events.filter(([name]) => name === "request");
    assert.equal(requests.length, type === "lesson10" ? 1 : 0);
    if (requests.length) assert.equal(requests[0][1].type, type);
  }
});

const { filterUnfulfilledSchedulingRequests } = load(
  "src/lib/scheduling-requests.ts",
  {},
);

function queries(supabase = {}) {
  const invalidations = [];
  const queryClient = {
    invalidateQueries: async (args) => invalidations.push(args.queryKey),
  };
  const preferences = load("src/queries/preferences.ts", {
    "@tanstack/react-query": {
      useQuery: (options) => options,
      useInfiniteQuery: (options) => options,
    },
    "@/lib/supabaseClient": { supabase },
    "@/lib/scheduling-requests": { filterUnfulfilledSchedulingRequests },
  });
  const learner = load("src/queries/learner.ts", {
    "@tanstack/react-query": {
      useMutation: (options) => options,
      useQueryClient: () => queryClient,
    },
    "@/context/auth-context": {},
    "@/lib/learner-service": {},
    "@/lib/supabaseClient": { supabase },
    "@/queries/preferences": preferences,
    "@/utils/phoneNormalization": {},
  });
  return { learner, preferences, invalidations };
}

const queueRequest = (changes = {}) => ({
  id: "request-1",
  learner_id: "learner-1",
  type: "new",
  lesson_ids: ["lesson-1"],
  created_at: "2026-10-06T09:00:00Z",
  ...changes,
});
const scheduled = (changes = {}) => ({
  learner_id: "learner-1",
  lesson_id: "lesson-1",
  created_at: "2026-10-06T09:00:00Z",
  status: "booked",
  ...changes,
});

test("new learner without schedules remains in the admin queue", () => {
  const request = queueRequest();
  assert.deepEqual(filterUnfulfilledSchedulingRequests([request], []), [
    request,
  ]);
});

test("cancelled and paused classes never hide a ready learner", () => {
  for (const status of [
    "paused",
    "PAUSED",
    "cancelled",
    "CANCELLED",
    "canceled",
  ]) {
    const request = queueRequest();
    assert.deepEqual(
      filterUnfulfilledSchedulingRequests([request], [scheduled({ status })]),
      [request],
    );
  }
});

test("recent demos and unrelated-course lessons do not fulfill a new course request", () => {
  const request = queueRequest();
  for (const lesson_id of [null, "different-course-lesson"]) {
    assert.deepEqual(
      filterUnfulfilledSchedulingRequests(
        [request],
        [scheduled({ lesson_id })],
      ),
      [request],
    );
  }
});

test("fulfilled course requests disappear; partial and old schedules do not", () => {
  assert.deepEqual(
    filterUnfulfilledSchedulingRequests([queueRequest()], [scheduled()]),
    [],
  );
  const partial = queueRequest({ lesson_ids: ["lesson-1", "lesson-2"] });
  assert.deepEqual(
    filterUnfulfilledSchedulingRequests([partial], [scheduled()]),
    [partial],
  );
  const request = queueRequest();
  assert.deepEqual(
    filterUnfulfilledSchedulingRequests(
      [request],
      [scheduled({ created_at: "2026-09-01T09:00:00Z" })],
    ),
    [request],
  );
});

test("duplicate schedule rows cannot fulfill a missing lesson", () => {
  const request = queueRequest({ lesson_ids: ["lesson-1", "lesson-2"] });
  assert.deepEqual(
    filterUnfulfilledSchedulingRequests([request], [scheduled(), scheduled()]),
    [request],
  );
});

test("reschedule, lesson10 and incomplete metadata are never silently filtered out", () => {
  for (const changes of [
    { type: "reschedule" },
    { type: "lesson10" },
    { lesson_ids: [] },
    { created_at: null },
  ]) {
    const request = queueRequest(changes);
    assert.deepEqual(
      filterUnfulfilledSchedulingRequests([request], [scheduled()]),
      [request],
    );
  }
});

test("virtual requests only count null-lesson schedules, not unrelated course rows", () => {
  const request = queueRequest({ lesson_ids: ["virtual-lesson-1"] });
  assert.deepEqual(
    filterUnfulfilledSchedulingRequests([request], [scheduled()]),
    [request],
  );
  assert.deepEqual(
    filterUnfulfilledSchedulingRequests(
      [request],
      [scheduled({ lesson_id: null })],
    ),
    [],
  );
});

function queueDatabase(requests, schedules) {
  const ranges = [];
  const selections = [];
  const orders = [];
  return {
    ranges,
    selections,
    orders,
    from(table) {
      const chain = {
        select(fields) {
          selections.push([table, fields]);
          return this;
        },
        eq() {
          return this;
        },
        order(field, options) {
          orders.push([table, field, options]);
          return this;
        },
        in() {
          return this;
        },
        range(from, to) {
          ranges.push([from, to]);
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: table === "Schedule" ? schedules : requests,
            error: null,
          }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

test("regular and infinite admin queries both show unscheduled/cancelled learners", async () => {
  const ready = queueRequest();
  const cancelled = queueRequest({ id: "request-2", learner_id: "learner-2" });
  const fulfilled = queueRequest({ id: "request-3", learner_id: "learner-3" });
  const db = queueDatabase(
    [ready, cancelled, fulfilled],
    [
      scheduled({ learner_id: "learner-2", status: "cancelled" }),
      scheduled({ learner_id: "learner-3" }),
    ],
  );
  const q = queries(db).preferences;
  assert.deepEqual(await q.useSchedulingRequests().queryFn(), [
    ready,
    cancelled,
  ]);
  const page = await q
    .useInfiniteSchedulingRequests()
    .queryFn({ pageParam: 25 });
  assert.deepEqual(page.data, [ready, cancelled]);
  assert.deepEqual(db.ranges, [[25, 49]]);
  assert.deepEqual(db.orders, [
    ["reschedule_requests", "created_at", { ascending: false }],
    ["reschedule_requests", "id", { ascending: false }],
    ["reschedule_requests", "created_at", { ascending: false }],
    ["reschedule_requests", "id", { ascending: false }],
  ]);
  assert.ok(
    db.selections
      .filter(([table]) => table === "Schedule")
      .every(
        ([, fields]) =>
          fields.includes("lesson_id") && fields.includes("status"),
      ),
  );
});

test("infinite queue continues loading when a full page contains mostly fulfilled requests", async () => {
  const requests = Array.from({ length: 25 }, (_, i) =>
    queueRequest({ id: `request-${i}`, learner_id: `learner-${i}` }),
  );
  const schedules = requests
    .slice(0, 24)
    .map((r) => scheduled({ learner_id: r.learner_id }));
  const query = queries(
    queueDatabase(requests, schedules),
  ).preferences.useInfiniteSchedulingRequests();
  const page = await query.queryFn({ pageParam: 0 });
  assert.deepEqual(page.data, [requests[24]]);
  assert.equal(page.hasMoreInDb, true);
  assert.equal(query.getNextPageParam(page, [page]), 25);
});

test("creation and completion invalidate both admin queues and learner pending requests", async () => {
  const q = queries();
  await q.learner
    .useMutationRescheduleRequest()
    .onSuccess({}, { learnerId: "learner-1" });
  assert.deepEqual(q.invalidations, [
    ["scheduling-requests"],
    ["scheduling-requests-infinite"],
    ["learnerRescheduleRequests", "learner-1"],
  ]);
  q.invalidations.length = 0;
  await q.learner.useMutationCompleteRescheduleRequest().onSuccess();
  assert.deepEqual(q.invalidations, [
    ["scheduling-requests"],
    ["scheduling-requests-infinite"],
    ["learnerRescheduleRequests"],
  ]);
  assert.equal(
    q.preferences.useInfiniteSchedulingRequests().refetchInterval,
    30000,
  );
});

test("a failed pending-request lookup is surfaced instead of creating a duplicate", async () => {
  const error = new Error("lookup failed");
  const chain = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle: async () => ({ data: null, error }),
  };
  const q = queries({ from: () => chain });
  await assert.rejects(
    q.learner.useMutationRescheduleRequest().mutationFn({
      learnerId: "learner-1",
      lessonIds: ["lesson-1"],
      type: "new",
    }),
    /lookup failed/,
  );
});

test("retry reuses the pending request and preserves its payment association", async () => {
  let update;
  const chain = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle: async () => ({
      data: { id: "existing-request" },
      error: null,
    }),
    update(body) {
      update = body;
      return this;
    },
    single: async () => ({ data: { id: "existing-request" }, error: null }),
  };
  const q = queries({ from: () => chain });
  const result = await q.learner.useMutationRescheduleRequest().mutationFn({
    learnerId: "learner-1",
    lessonIds: ["virtual-lesson-1"],
    type: "new",
  });
  assert.equal(result.id, "existing-request");
  assert.equal("payment_id" in update, false);
  assert.deepEqual(update.lesson_ids, ["virtual-lesson-1"]);
});
