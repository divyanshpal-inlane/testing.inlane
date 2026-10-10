// Offline tests, no credentials/network/database writes:
// node --test tests/scheduling/admin-schedule-consistency.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, imports) {
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
  new Function("require", "module", "exports", "console", outputText)(
    (name) => {
      assert.ok(name in imports, `Unexpected import ${name}`);
      return imports[name];
    },
    module,
    module.exports,
    { error() {}, log() {} },
  );
  return module.exports;
}

const row = (changes = {}) => ({
  id: 1,
  learner_id: "learner-a",
  instructor_id: "instructor-a",
  course_id: null,
  lesson_id: null,
  date: "2026-10-07",
  start_time: "10:00:00",
  end_time: "11:00:00",
  status: "booked",
  started_at: null,
  ended_at: null,
  Lesson: null,
  Courses: null,
  Instructor: { id_instructor: "instructor-a", name: "Instructor A" },
  learner: { id: "learner-a", name: "Learner A" },
  ...changes,
});

function scheduleDb(rows, { failPage, waitForLearner } = {}) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      const info = { table, orders: [], offset: 0, end: 999 };
      calls.push(info);
      const chain = {
        select(fields) {
          info.select = fields;
          return this;
        },
        eq(field, value) {
          info.field = field;
          info.id = value;
          return this;
        },
        order(field, options) {
          info.orders.push([field, options]);
          return this;
        },
        range(offset, end) {
          info.offset = offset;
          info.end = end;
          return this;
        },
        abortSignal(signal) {
          info.signal = signal;
          return this;
        },
        then(resolve, reject) {
          const result = async () => {
            if (info.offset === failPage)
              return { data: null, error: new Error("Schedule read failed") };
            if (waitForLearner?.[info.id]) await waitForLearner[info.id];
            return {
              data: rows
                .filter((r) => r[info.field] === info.id)
                .slice(info.offset, info.end + 1),
              error: null,
            };
          };
          return result().then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return db;
}
const reader = (db) =>
  load("src/lib/admin-schedules.ts", {
    "@/lib/supabaseClient": { supabase: db },
  });

test("learner and instructor readers return the same demo/custom class IDs", async () => {
  const rows = [
    row(),
    row({
      id: 2,
      course_id: "course-a",
      lesson_id: "lesson-a",
      Courses: { id: "course-a", name: "Course A" },
      Lesson: { id: "lesson-a", number: 1 },
    }),
  ];
  const db = scheduleDb(rows);
  const { fetchAdminSchedules } = reader(db);
  assert.deepEqual(await fetchAdminSchedules("learner_id", "learner-a"), rows);
  assert.deepEqual(
    await fetchAdminSchedules("instructor_id", "instructor-a"),
    rows,
  );
  assert.ok(db.calls.every((call) => !call.select.includes("!inner")));
});

test("unassigned and lesson-less classes survive optional joins", async () => {
  const rows = [row({ instructor_id: null, Instructor: null })];
  assert.deepEqual(
    await reader(scheduleDb(rows)).fetchAdminSchedules(
      "learner_id",
      "learner-a",
    ),
    rows,
  );
});

test("both readers paginate beyond Supabase's 1000-row limit with deterministic ordering", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => row({ id: i + 1 }));
  for (const column of ["learner_id", "instructor_id"]) {
    const db = scheduleDb(rows);
    const result = await reader(db).fetchAdminSchedules(
      column,
      column === "learner_id" ? "learner-a" : "instructor-a",
    );
    assert.equal(result.length, 1001);
    assert.deepEqual(
      db.calls.map(({ offset, end }) => [offset, end]),
      [
        [0, 999],
        [1000, 1999],
      ],
    );
    assert.deepEqual(
      db.calls[0].orders.map(([field]) => field),
      ["date", "start_time", "id"],
    );
  }
});

test("a failed later page throws rather than returning a misleading partial/empty list", async () => {
  const db = scheduleDb(
    Array.from({ length: 1001 }, (_, i) => row({ id: i + 1 })),
    { failPage: 1000 },
  );
  await assert.rejects(
    reader(db).fetchAdminSchedules("learner_id", "learner-a"),
    /Schedule read failed/,
  );
});

test("empty IDs never issue an unfiltered Schedule request", async () => {
  const db = scheduleDb([row()]);
  assert.deepEqual(await reader(db).fetchAdminSchedules("learner_id", ""), []);
  assert.equal(db.calls.length, 0);
});

test("aborted readers stop and forward cancellation to the database request", async () => {
  const db = scheduleDb([row()]);
  const controller = new AbortController();
  await reader(db).fetchAdminSchedules(
    "learner_id",
    "learner-a",
    controller.signal,
  );
  assert.equal(db.calls[0].signal, controller.signal);
  controller.abort();
  await assert.rejects(
    reader(db).fetchAdminSchedules(
      "learner_id",
      "learner-a",
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(db.calls.length, 1);
});

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree === null || tree === undefined || typeof tree === "boolean")
    return "";
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree !== "object")
    return typeof tree === "function" ? "" : String(tree);
  return text(tree.props?.children);
}

// Hooks/JSX harness executes the real learner-info dialog, including effects.
function dialog(
  rows,
  { failSchedules = false, failEnrollment = false, waitForLearner } = {},
) {
  const schedule = scheduleDb(rows, { waitForLearner });
  let failed = failSchedules;
  const supabase = {
    from(table) {
      if (table === "Schedule") {
        if (failed) return scheduleDb([], { failPage: 0 }).from(table);
        return schedule.from(table);
      }
      let fields;
      const response = () =>
        table === "enrollment"
          ? {
              data: null,
              error: failEnrollment
                ? new Error("Enrollment unavailable")
                : null,
            }
          : {
              data:
                table === "schedule_preferences"
                  ? []
                  : { id: "learner-a", name: "Learner A", comments: "" },
              error: null,
            };
      const chain = {
        select(value) {
          fields = value;
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
        abortSignal() {
          return this;
        },
        // Match the typed SDK boundary: apply abortSignal before single().
        single() {
          return { then: chain.then };
        },
        maybeSingle() {
          return { then: chain.then };
        },
        then(resolve, reject) {
          return Promise.resolve(response()).then(resolve, reject);
        },
        // Regression guard: nullable FK lookups caused 22P02 in the old dialog.
        in() {
          throw new Error(`Unexpected standalone ${table} lookup: ${fields}`);
        },
      };
      return chain;
    },
  };
  const slots = [];
  let cursor = 0;
  let pending = [];
  const cleanups = [];
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
        },
      ];
    },
    useCallback(fn) {
      return fn;
    },
    useEffect(effect, deps) {
      const i = cursor++;
      const previous = slots[i];
      if (!previous || deps.some((dep, n) => !Object.is(dep, previous[n]))) {
        slots[i] = deps;
        pending.push(() => {
          cleanups[i]?.();
          cleanups[i] = effect();
        });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const { LearnerInfoDialog } = load(
    "src/components/admin/LearnerInfoCard.tsx",
    {
      react: hooks,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "date-fns": require("date-fns"),
      "lucide-react": new Proxy({}, { get: (_, name) => String(name) }),
      "@/components/ui/avatar": {
        Avatar: "Avatar",
        AvatarFallback: "AvatarFallback",
      },
      "@/components/ui/badge": { Badge: "Badge" },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/dialog": {
        Dialog: "Dialog",
        DialogClose: "DialogClose",
        DialogContent: "DialogContent",
        DialogHeader: "DialogHeader",
        DialogTitle: "DialogTitle",
      },
      "@/components/ui/use-toast": { useToast: () => ({ toast() {} }) },
      "@/lib/supabaseClient": { supabase },
      "@/lib/admin-schedules": reader(supabase),
      "@/types/schedule": { TIME_SLOT_LABELS: {} },
      "./LearnerEditDialog": { LearnerEditDialog: "LearnerEditDialog" },
      "./LLDisplay": { LearnerLLDisplay: "LearnerLLDisplay" },
    },
  );
  let id = "learner-a";
  const render = () => {
    cursor = 0;
    const tree = LearnerInfoDialog({
      learner: {
        id,
        name: id,
        phone: "",
        email: "",
        area: "",
        DL_test_date: null,
      },
      open: true,
      onClose() {},
    });
    const effects = pending;
    pending = [];
    effects.forEach((effect) => effect());
    return tree;
  };
  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return render();
  };
  render();
  return {
    render,
    flush,
    select(value) {
      id = value;
      return render();
    },
    fail(value) {
      failed = value;
    },
    close() {
      cleanups.forEach((cleanup) => cleanup?.());
    },
  };
}

test("dialog displays null-course classes rather than 'No schedules found'", async () => {
  const ui = dialog([row()]);
  const tree = await ui.flush();
  assert.match(text(tree), /Instructor A/);
  assert.doesNotMatch(text(tree), /No schedules found for this learner/);
  ui.close();
});

test("mixed course/topup and unassigned schedules all remain visible", async () => {
  const ui = dialog([
    row({ end_time: "12:00:00" }),
    row({
      id: 2,
      instructor_id: null,
      Instructor: null,
      course_id: "course-a",
      start_time: "12:00:00",
      end_time: "13:00:00",
      Courses: { id: "course-a", name: "Course A" },
    }),
  ]);
  const tree = await ui.flush();
  assert.match(text(tree), /Instructor A/);
  assert.match(text(tree), /Unassigned/);
  assert.match(text(tree), /Lesson 1 & 2/);
  assert.match(text(tree), /Lesson 3/);
  ui.close();
});

test("legacy classes with missing time fields remain visible", async () => {
  const ui = dialog([row({ start_time: null, end_time: null })]);
  assert.match(text(await ui.flush()), /Instructor A/);
  ui.close();
});

test("enrollment metadata errors do not hide existing classes", async () => {
  const ui = dialog([row()], { failEnrollment: true });
  assert.match(text(await ui.flush()), /Instructor A/);
  ui.close();
});

test("schedule failures display a retryable error, not an empty-class message", async () => {
  const ui = dialog([row()], { failSchedules: true });
  const tree = await ui.flush();
  assert.ok(nodes(tree).some((n) => n.props?.role === "alert"));
  assert.doesNotMatch(text(tree), /No schedules found for this learner/);
  ui.fail(false);
  nodes(tree)
    .find((n) => n.type === "Button" && text(n) === "Retry schedules")
    .props.onClick();
  ui.render();
  assert.match(text(await ui.flush()), /Instructor A/);
  ui.close();
});

test("switching learners ignores a late response from the previous learner", async () => {
  let finish;
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  const ui = dialog(
    [
      row(),
      row({
        id: 2,
        learner_id: "learner-b",
        Instructor: { name: "Instructor B" },
      }),
    ],
    { waitForLearner: { "learner-a": waiting } },
  );
  ui.select("learner-b");
  assert.match(text(await ui.flush()), /Instructor B/);
  finish();
  const tree = await ui.flush();
  assert.match(text(tree), /Instructor B/);
  assert.doesNotMatch(text(tree), /Instructor A/);
  ui.close();
});

test("only genuinely empty Schedule results show the empty-state message", async () => {
  const ui = dialog([]);
  assert.match(text(await ui.flush()), /No schedules found for this learner/);
  ui.close();
});
