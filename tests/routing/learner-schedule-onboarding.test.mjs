// Offline regressions; no credentials, network calls or production writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
globalThis.localStorage = { getItem: () => "true", setItem() {} };
function load(path, overrides = {}) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  );
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (id) => {
      if (id in overrides) return overrides[id];
      if (id.startsWith("@/")) return {};
      return require(id);
    },
    module,
    module.exports,
  );
  return module.exports;
}

const setup = load("src/lib/learner-schedule-onboarding.ts");
const service = load("src/lib/learner-service.ts");
const learner = {
  id: "new-learner",
  onboarding_completed: true,
  has_a_DL: true,
  LL_received: true,
  address_lat: 12.97,
  address_lng: 77.59,
  preferred_start_date: "2026-11-01",
};
const prefs = [{ day_of_week: 0, time_slot: "6-9" }];

function home({ changes = {}, type = "course", caseType = "classes_only", preferences = [], scheduled = [], loading = false, state = null } = {}) {
  const jsx = (type, props) => ({ type, props });
  const { default: Home } = load("src/routes/home.tsx", {
    react: { useState: (value) => [value, () => {}] },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-router-dom": { Navigate: "Navigate", Link: "Link", useNavigate: () => () => {}, useLocation: () => ({ state }) },
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "@/lib/learner-schedule-onboarding": setup,
    "@/lib/learner-service": service,
    "@/components/ll_flow": { __esModule: true, default: "LLFlow" },
    "@/queries/learner": {
      useLearner: () => ({ data: { ...learner, ...changes } }),
      useLearnerEnrollment: () => ({ data: { course_id: type === "course" ? "course" : null, payment_status: "full_paid", progress: { type } } }),
      useLearnerServiceEnrollment: () => ({ data: { case_type: caseType } }),
      useLearnerSchedule: () => ({ data: scheduled }),
      useLearnerUpdate: () => ({ mutate: () => {} }),
      useUpcomingLesson: () => ({ data: {} }),
      useLessonSchedule: () => ({ data: null }),
    },
    "@/queries/payment": { usePaymentsByLearner: () => ({ data: [] }) },
    "@/queries/preferences": {
      useSchedulePreferences: () => ({ data: preferences, isLoading: loading }),
      // Every scenario has a payment-created request: it must not skip setup.
      useLearnerRescheduleRequests: () => ({ data: [{ id: "payment-request", type: "new" }] }),
    },
    "@/queries/schedule-requests": { useCompletedRescheduleRequests: () => ({ data: [] }) },
  });
  return Home();
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

for (const type of ["course", "custom"]) {
  test(`${type}: payment-created request cannot skip location`, () => {
    const tree = home({ type, changes: { address_lat: null, address_lng: null } });
    assert.equal(tree.type, "Navigate");
    assert.equal(tree.props.to, "/createSchedule/details");
  });
  test(`${type}: saved location resumes start-date questions`, () => {
    assert.equal(home({ type, changes: { preferred_start_date: null } }).props.to, "/createSchedule/onboardingQuestions");
  });
  test(`${type}: start date without timings resumes licence upload`, () => {
    assert.equal(home({ type }).props.to, "/createSchedule/uploadLL");
  });
  test(`${type}: only completed setup shows schedule waiting state`, () => {
    const tree = home({ type, preferences: prefs });
    assert.notEqual(tree.type, "Navigate");
    assert.ok(nodes(tree).some((n) => n.props?.children === "Your Schedule is Being Created"));
  });
}

test("demo selects location then timings, without requiring a licence", () => {
  assert.equal(home({ type: "demo", changes: { address_lat: null } }).props.to, "/createSchedule/details?type=demo");
  assert.equal(home({ type: "demo", changes: { preferred_start_date: null } }).props.to, "/createSchedule/preferences?type=new");
});

test("combined RTO/classes learner can set up lessons after receiving LL", () => {
  assert.equal(home({ caseType: "lessons_with_rto", changes: { address_lat: null } }).props.to, "/createSchedule/details");
});

test("RTO-only and combined learners awaiting LL remain in the licence journey", () => {
  for (const options of [{ caseType: "rto_only" }, { caseType: "lessons_with_rto", changes: { LL_received: false } }]) {
    assert.ok(nodes(home(options)).some((n) => n.type === "LLFlow"));
  }
});

test("pickup Back returns to Home without auto-redirecting to pickup again", () => {
  const navigations = [];
  const updates = [];
  const jsx = (type, props) => ({ type, props });
  const { default: Details } = load("src/routes/createSchedule/details.tsx", {
    react: {
      useState: (value) => [value, () => {}],
      useRef: (value) => ({ current: value }),
      useCallback: (fn) => fn,
      useEffect() {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@vis.gl/react-google-maps": { useMapsLibrary: () => null },
    "react-router-dom": {
      useNavigate: () => (...args) => navigations.push(args),
      useSearchParams: () => [new URLSearchParams()],
    },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/use-toast": { useToast: () => ({ toast() {} }) },
    "@/lib/learner-schedule-onboarding": setup,
    "@/queries/learner": {
      useLearner: () => ({ data: learner }),
      useLearnerUpdate: () => ({ mutate: (data) => updates.push(data) }),
    },
  });
  const back = nodes(Details()).find((n) => n.props?.["aria-label"] === "Back to learner home");
  assert.equal(back.props.type, "button");
  back.props.onClick();
  assert.deepEqual(navigations, [["/home", { replace: true, state: { scheduleSetupReturnFor: learner.id } }]]);
  assert.deepEqual(updates, []);
  const tree = home({ changes: { address_lat: null }, state: navigations[0][1].state });
  assert.notEqual(tree.type, "Navigate");
  assert.ok(nodes(tree).some((n) => n.props?.children === "Continue setup" && n.props.to === "/createSchedule/details"));
  assert.ok(!nodes(tree).some((n) => n.props?.children === "Your Schedule is Being Created"));
});

test("availability Back also exits new setup without a redirect loop", () => {
  const jsx = (type, props) => ({ type, props });
  const { default: Preferences } = load("src/routes/preferences.tsx", {
    react: { useState: (value) => [value, () => {}] },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-router-dom": { Link: "Link", Navigate: "Navigate", useSearchParams: () => [new URLSearchParams("type=new")] },
    "@/lib/learner-schedule-onboarding": setup,
    "@/constants/courses": { demoLessonOffsetFor: () => 0 },
    "@/queries/payment": { useCompletedDemoCount: () => ({ data: 0 }) },
    "@/queries/learner": {
      useLearner: () => ({ data: learner }),
      useLearnerEnrollmentCourse: () => ({ data: [] }),
      useLearnerEnrollment: () => ({ data: { progress: { type: "custom", total_hours: 4 } } }),
      useLessons: () => ({ data: [] }),
    },
  });
  const back = nodes(Preferences()).find((n) => n.props?.["aria-label"] === "Back to learner home");
  assert.equal(back.props.to, "/home");
  assert.deepEqual(back.props.state, { scheduleSetupReturnFor: learner.id });
  assert.notEqual(home({ state: back.props.state }).type, "Navigate");
});

test("Back returns combined learners to the approved-LL journey", () => {
  const tree = home({ caseType: "lessons_with_rto", changes: { address_lat: null }, state: { scheduleSetupReturnFor: learner.id } });
  assert.notEqual(tree.type, "Navigate");
  assert.ok(nodes(tree).some((n) => n.type === "LLFlow"));
});

test("leaving setup preserves a resume action for every unfinished step", () => {
  for (const options of [
    { changes: { address_lat: null }, route: "/createSchedule/details" },
    { changes: { preferred_start_date: null }, route: "/createSchedule/onboardingQuestions" },
    { changes: {}, route: "/createSchedule/uploadLL" },
    { type: "demo", changes: { address_lat: null }, route: "/createSchedule/details?type=demo" },
    { type: "demo", route: "/createSchedule/preferences?type=new" },
  ]) {
    const tree = home({ ...options, state: { scheduleSetupReturnFor: learner.id } });
    assert.notEqual(tree.type, "Navigate");
    assert.ok(nodes(tree).some((n) => n.props?.children === "Continue setup" && n.props.to === options.route));
  }
});

test("Back state cannot skip setup for another learner or a fresh Home visit", () => {
  const options = { changes: { address_lat: null } };
  assert.equal(home({ ...options, state: { scheduleSetupReturnFor: "someone-else" } }).props.to, "/createSchedule/details");
  assert.equal(home(options).props.to, "/createSchedule/details");
});

test("loading preferences does not incorrectly redirect back to upload", () => {
  const tree = home({ loading: true });
  assert.equal(tree.type, "div");
  assert.equal(tree.props.children, "Loading...");
});

test("existing scheduled or completed courses do not restart setup", () => {
  assert.equal(setup.nextLearnerScheduleSetupRoute({}, { hasScheduledLessons: true }), null);
});

test("pickup validation accepts zero coordinates and rejects invalid points", () => {
  assert.equal(setup.hasLearnerPickupLocation({ address_lat: 0, address_lng: 0 }), true);
  for (const point of [{}, { address_lat: NaN, address_lng: 77 }, { address_lat: 91, address_lng: 77 }, { address_lat: 12, address_lng: 181 }]) {
    assert.equal(setup.hasLearnerPickupLocation(point), false);
  }
});

test("licence upload uses the signed-in phone and rejects invalid files before storage", async () => {
  const calls = [];
  const { useUploadLLMutation } = load("src/queries/learner.ts", {
    "@tanstack/react-query": { useMutation: (options) => options },
    "@/context/auth-context": { useUser: () => ({ phone: "+919876543210" }) },
    "@/lib/supabaseClient": { supabase: { storage: { from: (bucket) => ({
      upload: async (...args) => { calls.push([bucket, ...args]); return { data: { path: args[0] } }; },
    }) } } },
  });
  const mutation = useUploadLLMutation();
  await assert.rejects(mutation.mutationFn({ file: { type: "text/plain", size: 1 } }), /JPEG, PNG or PDF/);
  await assert.rejects(mutation.mutationFn({ file: { type: "application/pdf", size: 5 * 1024 * 1024 } }), /4 MB/);
  assert.equal(calls.length, 0);
  await mutation.mutationFn({ file: { type: "image/png", size: 100 } });
  assert.equal(calls[0][0], "LL");
  assert.equal(calls[0][1], "+919876543210/ll.png");
});

test("DL and LL uploads open slot selection only after a successful upload", () => {
  for (const hasDL of [true, false]) {
    const navigations = [];
    const uploads = [];
    let cursor = 0;
    const jsx = (type, props) => ({ type, props });
    const { default: Upload } = load("src/routes/createSchedule/uploadLL.tsx", {
      react: { useEffect() {}, useState: (value) => [cursor++ === 0 ? { type: "application/pdf", name: "licence.pdf" } : value, () => {}] },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-router-dom": { Link: "Link", useNavigate: () => (path) => navigations.push(path) },
      "@/queries/learner": {
        useLearner: () => ({ data: { has_a_DL: hasDL } }),
        useUploadLLMutation: () => ({ mutate: (args, callbacks) => uploads.push({ args, callbacks }), isPending: false, error: new Error("Upload failed") }),
      },
    });
    const tree = Upload();
    const header = nodes(tree).find((n) => n.type === "h1");
    assert.ok(header.props.children.includes(hasDL ? "Driving Licence (DL)" : "Learner's Licence (LL)"));
    assert.ok(nodes(tree).some((n) => n.props?.role === "alert"));
    nodes(tree).find((n) => n.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(uploads.length, 1);
    assert.deepEqual(navigations, []);
    uploads[0].callbacks.onSuccess();
    assert.deepEqual(navigations, ["/createSchedule/preferences?type=new"]);
  }
});

test("direct new-preference links collect missing pickup/start date", () => {
  assert.equal(setup.nextLearnerScheduleSetupRoute({}, { hasPreferences: true }), "/createSchedule/details");
  assert.equal(setup.nextLearnerScheduleSetupRoute({ ...learner, preferred_start_date: null }, { hasPreferences: true }), "/createSchedule/onboardingQuestions");
  assert.equal(setup.nextLearnerScheduleSetupRoute(learner, { hasPreferences: true }), null);
});
