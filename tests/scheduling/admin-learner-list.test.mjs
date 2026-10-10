// Offline regression tests: no production reads or writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
    {
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

const list = load("src/lib/admin-learner-list.ts");
const a = { id: "learner-a", name: "Learner A" };
const b = { id: "learner-b", name: "Learner B" };
const c = { id: "learner-c", name: "Learner C" };

test("repeated learner IDs appear once within and across pages", () => {
  const pages = [{ learners: [a, a, b] }, { learners: [b, c, a] }];
  assert.deepEqual(list.uniqueAdminLearners(pages), [a, b, c]);
});

test("duplicate-only pages do not remove learners from subsequent pages", () => {
  assert.deepEqual(
    list.uniqueAdminLearners([{ learners: [a] }, { learners: [a, a] }, { learners: [b] }]),
    [a, b],
  );
});

test("latest data wins without reordering or mutating cached pages", () => {
  const updated = { ...a, name: "Updated A" };
  const pages = Object.freeze([
    Object.freeze({ learners: Object.freeze([a, b]) }),
    Object.freeze({ learners: Object.freeze([updated, c]) }),
  ]);
  assert.deepEqual(list.uniqueAdminLearners(pages), [updated, b, c]);
  assert.deepEqual(pages[0].learners, [a, b]);
});

test("different learner IDs remain separate even with the same name or phone", () => {
  const first = { ...a, name: "Same Name", phone: "9876543210" };
  const second = { ...b, name: "Same Name", phone: "9876543210" };
  assert.deepEqual(list.uniqueAdminLearners([{ learners: [first, second] }]), [first, second]);
});

test("empty queries and filter changes have independent identity sets", () => {
  assert.deepEqual(list.uniqueAdminLearners(undefined), []);
  assert.deepEqual(list.uniqueAdminLearners([]), []);
  assert.deepEqual(list.uniqueAdminLearners([{ learners: [a] }]), [a]);
  assert.deepEqual(list.uniqueAdminLearners([{ learners: [a, b] }]), [a, b]);
});

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function renderList(pages, rpc = async () => ({ data: [] })) {
  const jsx = (type, props) => ({ type, props });
  let query;
  const { default: AdminSchedules } = load("src/routes/admin/schedules.tsx", {
    react: {
      useState: (value) => [value, () => {}],
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useRef: (value) => ({ current: value }),
      useEffect() {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-router-dom": { useNavigate: () => () => {} },
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: () => ({}),
      useQuery: () => ({ data: [] }),
      useInfiniteQuery: (options) => {
        query = options;
        return { data: { pages }, hasNextPage: true };
      },
    },
    "@/lib/admin-learner-list": list,
    "@/lib/supabaseClient": { supabase: { rpc } },
    "@/components/ui/use-toast": { useToast: () => ({ toast() {} }) },
    "@/components/admin/LearnerInfoCard": { LearnerInfoCard: "LearnerInfoCard" },
    "@/queries/learner": { useMutationCompleteRescheduleRequest: () => ({}) },
    "@/queries/preferences": {
      useInfiniteSchedulingRequests: () => ({ data: { pages: [] } }),
      useEnrollmentTypesByLearner: () => ({ data: new Map() }),
    },
  });
  return { tree: AdminSchedules(), query };
}

test("Active and Completed tabs render one card per ID and count unique visible learners", () => {
  const { tree } = renderList([
    { learners: [a, b], totalCount: 3 },
    { learners: [b, c], totalCount: 3 },
  ]);
  for (const value of ["active", "completed"]) {
    const tab = nodes(tree).find((n) => n.type === "TabsContent" && n.props.value === value);
    assert.ok(tab);
    const cards = nodes(tab).filter((n) => n.type === "LearnerInfoCard");
    assert.deepEqual(cards.map((n) => n.props.learner.id), [a.id, b.id, c.id]);
    assert.ok(nodes(tab).some((n) => n.props?.children === "Showing 3 of 3 learners"));
  }
});

test("raw RPC page size still drives pagination even when every row overlaps", async () => {
  const calls = [];
  const { query } = renderList([{ learners: [a], totalCount: 60 }], async (name, args) => {
    calls.push([name, args]);
    return { data: Array.from({ length: 20 }, () => ({ ...a, total_count: 60 })), error: null };
  });
  const page = await query.queryFn({ pageParam: 1 });
  assert.equal(page.nextPage, 2);
  assert.equal(query.getNextPageParam(page), 2);
  assert.equal(calls[0][1].page_offset, 20);
  assert.equal(calls[0][1].page_size, 20);
});
