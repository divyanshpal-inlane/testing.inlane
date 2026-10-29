// Offline regression tests (no production reads or writes):
// node --test tests/scheduling/reschedule-request-completion.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, overrides) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
    {
      fileName: path,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (id) => {
      if (id in overrides) return overrides[id];
      if (id.startsWith("@/")) {
        return new Proxy({}, { get: (_, name) => String(name) });
      }
      return require(id);
    },
    module,
    module.exports,
  );
  return module.exports;
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

const request = (id, changes = {}) => ({
  id,
  learner_id: `learner-${id}`,
  type: "reschedule",
  status: "pending",
  lesson_ids: ["lesson-1"],
  Learner: { id: `learner-${id}`, name: `Learner ${id}` },
  ...changes,
});
const first = request("first");
const second = request("second");
const newRequest = request("new", { type: "new" });
const lesson10 = request("tenth", { type: "lesson10" });
const queryKey = ["scheduling-requests-infinite"];
const success = (ids) => ({
  data: ids.map((id) => ({ id, status: "completed" })),
  error: null,
});

function setup({
  requests = [first, newRequest, second, lesson10],
  save = async (ids) => success(ids),
  schedulePending = false,
} = {}) {
  const client = new QueryClient();
  const invalidations = [];
  // Leave cached results unchanged on refetch to verify the immediate UI update.
  client.invalidateQueries = async ({ queryKey }) => {
    invalidations.push(queryKey);
  };
  client.setQueryData(queryKey, {
    pages: [
      { data: requests.slice(0, 2), hasMoreInDb: true },
      { data: requests.slice(2), hasMoreInDb: false },
    ],
    pageParams: [0, 25],
  });
  const writes = [];
  const toasts = [];
  const mutation = { isPending: false, variables: undefined };
  const supabase = {
    from(table) {
      const write = { table, filters: [] };
      writes.push(write);
      let ids;
      return {
        update(values) {
          write.values = values;
          return this;
        },
        eq(field, value) {
          write.filters.push([field, "eq", value]);
          if (field === "id") ids = [value];
          return this;
        },
        in(field, values) {
          write.filters.push([field, "in", values]);
          assert.equal(field, "id");
          ids = values;
          return this;
        },
        select: () => save(ids),
      };
    },
  };
  const preferences = load("src/queries/preferences.ts", {
    "@tanstack/react-query": {},
    "@/lib/supabaseClient": { supabase },
  });
  const learner = load("src/queries/learner.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => client,
      useMutation(options) {
        mutation.mutateAsync = async (variables) => {
          mutation.isPending = true;
          mutation.variables = variables;
          try {
            const data = await options.mutationFn(variables);
            await options.onSuccess?.(data, variables);
            return data;
          } finally {
            mutation.isPending = false;
          }
        };
        return mutation;
      },
    },
    "@/lib/supabaseClient": { supabase },
    "@/queries/preferences": preferences,
  });

  let cursor = 0;
  const state = [];
  function useState(initial) {
    const i = cursor++;
    if (!(i in state)) state[i] = initial;
    return [
      state[i],
      (value) => {
        state[i] = typeof value === "function" ? value(state[i]) : value;
      },
    ];
  }
  const jsx = (type, props) => ({ type, props });
  const { default: AdminSchedules } = load("src/routes/admin/schedules.tsx", {
    react: {
      useState,
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useRef: (value) => useState({ current: value })[0],
      useEffect() {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-router-dom": { useNavigate: () => () => {} },
    "@tanstack/react-query": {
      useQueryClient: () => client,
      useMutation: () => ({ isPending: schedulePending }),
      useQuery: () => ({ data: [] }),
      useInfiniteQuery: () => ({ data: { pages: [] } }),
    },
    "@/lib/supabaseClient": { supabase },
    "@/lib/admin-learner-list": { uniqueAdminLearners: () => [] },
    "@/components/ui/use-toast": {
      useToast: () => ({ toast: (value) => toasts.push(value) }),
    },
    "@/queries/learner": learner,
    "@/queries/preferences": {
      ...preferences,
      useInfiniteSchedulingRequests: () => ({
        data: client.getQueryData(queryKey),
      }),
      useEnrollmentTypesByLearner: () => ({ data: new Map() }),
    },
  });

  const render = () => {
    cursor = 0;
    return AdminSchedules();
  };
  const tab = (value = "reschedule") =>
    nodes(render()).find(
      (node) => node.type === "TabsContent" && node.props.value === value,
    );
  const cards = () =>
    nodes(tab()).filter((node) => node.type === "LearnerInfoCard");
  const buttons = (value = "reschedule") =>
    nodes(tab(value)).filter(
      (node) =>
        node.type === "Button" &&
        (node.props.children === "Mark as Completed" ||
          nodes(node).some((child) =>
            child.props?.children?.includes?.("Completing..."),
          )),
    );
  const findButton = (label) =>
    nodes(tab()).find(
      (node) => node.type === "Button" && node.props.children === label,
    );
  const startSelecting = () => findButton("Select")?.props.onClick();
  const cancel = () => findButton("Cancel")?.props.onClick();
  const checkboxes = (value = "reschedule") =>
    nodes(tab(value)).filter((node) => node.type === "Checkbox");
  const requestCheckboxes = () =>
    checkboxes().filter((node) => node.props["aria-label"]);
  const select = (index = 0, checked = true) => {
    startSelecting();
    requestCheckboxes()[index].props.onCheckedChange(checked);
  };
  const selectAllCheckbox = () =>
    checkboxes().find(
      (node) => node.props.id === "select-all-reschedule-requests",
    );
  const selectAll = (checked = true) => {
    startSelecting();
    selectAllCheckbox().props.onCheckedChange(checked);
  };
  const selectedCount = () =>
    nodes(tab()).find((node) => node.props?.["aria-live"] === "polite")?.props
      .children[0] ?? 0;
  const complete = () => buttons()[0]?.props.onClick();
  const selectedId = () =>
    nodes(tab()).find((node) => node.props?.request)?.props.request.id;
  return {
    client,
    invalidations,
    writes,
    toasts,
    render,
    cards,
    buttons,
    findButton,
    startSelecting,
    cancel,
    checkboxes,
    requestCheckboxes,
    select,
    selectAll,
    selectAllCheckbox,
    selectedCount,
    complete,
    selectedId,
    mutate: (variables) =>
      learner.useMutationCompleteRescheduleRequest().mutateAsync(variables),
  };
}

test("selection controls are hidden by default and Select reveals circular checkboxes", () => {
  const ui = setup({
    requests: [
      first,
      newRequest,
      lesson10,
      ...["completed", "cancelled", "pending_payment"].map((status) =>
        request(status, { status }),
      ),
    ],
  });
  assert.equal(ui.buttons().length, 0);
  assert.equal(ui.checkboxes().length, 0);
  assert.equal(ui.findButton("Cancel"), undefined);
  assert.equal(ui.findButton("Select").props.type, "button");
  assert.equal(ui.findButton("Select").props.disabled, false);
  ui.startSelecting();
  assert.equal(ui.findButton("Select"), undefined);
  assert.ok(ui.findButton("Cancel"));
  assert.equal(ui.buttons().length, 1);
  assert.equal(ui.buttons()[0].props.children, "Mark as Completed");
  assert.equal(ui.buttons()[0].props.type, "button");
  assert.equal(ui.buttons()[0].props.disabled, true);
  assert.equal(ui.selectedCount(), 0);
  assert.ok(
    ui
      .checkboxes()
      .every((checkbox) => checkbox.props.className === "rounded-full"),
  );
  assert.deepEqual(
    ui.requestCheckboxes().map((checkbox) => checkbox.props.disabled),
    [false, true, true, true],
  );
  for (const value of ["new", "lesson10"]) {
    assert.equal(ui.buttons(value).length, 0);
    assert.equal(ui.checkboxes(value).length, 0);
  }
  ui.selectAll();
  assert.equal(ui.selectedCount(), 1);
});

test("an empty selection cannot issue an update", async () => {
  const ui = setup();
  ui.startSelecting();
  await ui.complete();
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.toasts.length, 0);
});

test("Cancel hides selection controls, clears checked requests and preserves the selected schedule", () => {
  const ui = setup();
  ui.cards()[1].props.onClick();
  ui.selectAll();
  assert.equal(ui.selectedCount(), 2);
  ui.cancel();
  assert.equal(ui.checkboxes().length, 0);
  assert.equal(ui.buttons().length, 0);
  assert.equal(ui.selectedId(), second.id);
  assert.ok(ui.findButton("Select"));
  assert.equal(ui.writes.length, 0);
  ui.startSelecting();
  assert.equal(ui.selectedCount(), 0);
  assert.ok(ui.requestCheckboxes().every((checkbox) => !checkbox.props.checked));
  assert.equal(ui.buttons()[0].props.disabled, true);
});

test("checkboxes toggle the count and button without changing schedule selection", () => {
  const ui = setup();
  ui.select();
  assert.equal(ui.selectedCount(), 1);
  assert.equal(ui.buttons()[0].props.disabled, false);
  assert.equal(ui.selectedId(), undefined);
  ui.cards()[1].props.onClick();
  assert.equal(ui.selectedId(), second.id);
  assert.equal(ui.selectedCount(), 1);
  ui.select(0, false);
  assert.equal(ui.selectedCount(), 0);
  assert.equal(ui.buttons()[0].props.disabled, true);
  assert.equal(ui.selectedId(), second.id);
});

test("select all supports checked, indeterminate and cleared states", () => {
  const ui = setup();
  ui.startSelecting();
  assert.equal(ui.selectAllCheckbox().props.checked, false);
  ui.select();
  assert.equal(ui.selectAllCheckbox().props.checked, "indeterminate");
  ui.selectAll();
  assert.equal(ui.selectedCount(), 2);
  assert.equal(ui.selectAllCheckbox().props.checked, true);
  assert.ok(ui.requestCheckboxes().every((checkbox) => checkbox.props.checked));
  ui.selectAll(false);
  assert.equal(ui.selectedCount(), 0);
  assert.equal(ui.selectAllCheckbox().props.checked, false);
});

test("single completion updates only the checked request and clears its selection", async () => {
  const ui = setup();
  ui.cards()[0].props.onClick();
  ui.select();
  await ui.complete();
  assert.deepEqual(ui.writes, [
    {
      table: "reschedule_requests",
      values: { status: "completed" },
      filters: [
        ["id", "in", [first.id]],
        ["type", "eq", "reschedule"],
        ["status", "eq", "pending"],
      ],
    },
  ]);
  assert.deepEqual(
    ui.cards().map((card) => card.props.learner.id),
    [second.learner_id],
  );
  assert.equal(ui.selectedId(), undefined);
  assert.equal(ui.selectedCount(), 0);
  assert.equal(ui.buttons()[0].props.disabled, true);
  const count = nodes(ui.render()).find(
    (node) => node.type === "TabsTrigger" && node.props.value === "reschedule",
  );
  assert.deepEqual(count.props.children, ["Reschedule Requests ", 1]);
  const cached = ui.client.getQueryData(queryKey);
  assert.deepEqual(
    cached.pages.map((page) => page.data.map((r) => r.id)),
    [[newRequest.id], [second.id, lesson10.id]],
  );
  assert.deepEqual(cached.pageParams, [0, 25]);
  assert.deepEqual(ui.invalidations, [
    ["scheduling-requests"],
    ["scheduling-requests-infinite"],
    ["learnerRescheduleRequests"],
  ]);
  assert.equal(ui.toasts[0].title, "Requests completed");
});

test("multiple selected requests complete in one backend update across queue pages", async () => {
  const ui = setup();
  ui.selectAll();
  await ui.complete();
  assert.equal(ui.writes.length, 1);
  assert.deepEqual(ui.writes[0].filters[0], [
    "id",
    "in",
    [first.id, second.id],
  ]);
  assert.equal(ui.invalidations.length, 3);
  assert.equal(ui.cards().length, 0);
  assert.equal(ui.selectedCount(), 0);
  assert.equal(
    ui.toasts[0].description,
    "2 reschedule requests marked as completed.",
  );
});

test("completion preserves a different selected schedule", async () => {
  const ui = setup();
  ui.cards()[1].props.onClick();
  ui.select();
  await ui.complete();
  assert.equal(ui.selectedId(), second.id);
});

test("changing the selected schedule during completion does not clear the new selection", async () => {
  let finish;
  const ui = setup({
    save: () => new Promise((resolve) => (finish = resolve)),
  });
  ui.cards()[0].props.onClick();
  ui.select();
  const pending = ui.complete();
  ui.cards()[1].props.onClick();
  finish(success([first.id]));
  await pending;
  assert.equal(ui.selectedId(), second.id);
});

test("while completing, show progress, disable selection and prevent rapid duplicate writes", async () => {
  let finish;
  const ui = setup({
    save: () => new Promise((resolve) => (finish = resolve)),
  });
  ui.select();
  const onClick = ui.buttons()[0].props.onClick;
  const pending = onClick();
  await onClick(); // Same render: the synchronous ref guard must stop this.
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.buttons()[0].props.disabled, true);
  assert.equal(ui.findButton("Cancel").props.disabled, true);
  ui.cancel(); // The synchronous guard also protects the in-flight batch.
  assert.ok(ui.findButton("Cancel"));
  assert.equal(ui.selectedCount(), 1);
  assert.ok(ui.checkboxes().every((checkbox) => checkbox.props.disabled));
  assert.ok(
    nodes(ui.buttons()[0]).some((node) =>
      node.props?.children?.includes?.("Completing..."),
    ),
  );
  finish(success([first.id]));
  await pending;
  assert.ok(
    ui.requestCheckboxes().every((checkbox) => !checkbox.props.disabled),
  );
});

test("existing schedule creation blocks entering selection mode", async () => {
  const ui = setup({ schedulePending: true });
  assert.equal(ui.findButton("Select").props.disabled, true);
  assert.equal(ui.checkboxes().length, 0);
  assert.equal(ui.buttons().length, 0);
  await ui.complete();
  assert.equal(ui.writes.length, 0);
});

test("backend errors and empty updates retain selected requests for retry", async () => {
  for (const result of [
    { data: null, error: new Error("Update failed") },
    { data: null, error: { message: "Permission denied" } },
    { data: [], error: null },
    { data: [{ id: first.id, status: "pending" }], error: null },
    success(["unrelated-request"]),
  ]) {
    const ui = setup({ save: async () => result });
    ui.cards()[0].props.onClick();
    ui.selectAll();
    await ui.complete();
    assert.equal(ui.cards().length, 2);
    assert.equal(ui.selectedId(), first.id);
    assert.equal(ui.selectedCount(), 2);
    assert.equal(ui.toasts.length, 1);
    assert.equal(ui.toasts[0].variant, "destructive");
    assert.equal(ui.buttons()[0].props.disabled, false);
  }
});

test("partial success clears only confirmed requests and retries only the remaining selection", async () => {
  let attempts = 0;
  const ui = setup({
    save: async (ids) => success(++attempts === 1 ? [first.id] : ids),
  });
  ui.selectAll();
  await ui.complete();
  assert.equal(ui.selectedCount(), 1);
  assert.equal(ui.requestCheckboxes()[0].props.checked, true);
  assert.deepEqual(
    ui.cards().map((card) => card.props.learner.id),
    [second.learner_id],
  );
  assert.equal(ui.toasts[0].variant, "destructive");
  assert.match(ui.toasts[0].description, /1 of 2 requests completed/);
  await ui.complete();
  assert.deepEqual(ui.writes[1].filters[0], ["id", "in", [second.id]]);
  assert.equal(ui.selectedCount(), 0);
  assert.equal(ui.cards().length, 0);
});

test("a failed completion can be retried with the same selection", async () => {
  let attempts = 0;
  const ui = setup({
    save: async (ids) =>
      ++attempts === 1
        ? { data: null, error: new Error("Network unavailable") }
        : success(ids),
  });
  ui.select();
  await ui.complete();
  await ui.complete();
  assert.equal(attempts, 2);
  assert.equal(ui.cards().length, 1);
  assert.equal(ui.selectedCount(), 0);
  assert.equal(ui.toasts[1].title, "Requests completed");
});

test("requests completed elsewhere no longer count towards the bulk action", async () => {
  const ui = setup();
  ui.select();
  ui.client.setQueryData(queryKey, (current) => ({
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      data: page.data.filter((row) => row.id !== first.id),
    })),
  }));
  assert.equal(ui.selectedCount(), 0);
  assert.equal(ui.buttons()[0].props.disabled, true);
  await ui.complete();
  assert.equal(ui.writes.length, 0);
});

test("empty queues disable Select and keep selection controls hidden", () => {
  const ui = setup({ requests: [] });
  assert.equal(ui.findButton("Select").props.disabled, true);
  assert.equal(ui.buttons().length, 0);
  assert.equal(ui.checkboxes().length, 0);
});

test("the original single-request completion API remains unchanged", async () => {
  const ui = setup();
  const result = await ui.mutate({ requestId: newRequest.id });
  assert.deepEqual(result, success([newRequest.id]).data);
  assert.deepEqual(ui.writes, [
    {
      table: "reschedule_requests",
      values: { status: "completed" },
      filters: [["id", "eq", newRequest.id]],
    },
  ]);
});

test("an empty bulk mutation never sends an unfiltered update", async () => {
  const ui = setup();
  assert.deepEqual(await ui.mutate({ requestIds: [] }), []);
  assert.equal(ui.writes.length, 0);
});
