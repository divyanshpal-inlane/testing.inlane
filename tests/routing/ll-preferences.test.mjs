// Run: node --test tests/routing/ll-preferences.test.mjs
// Component regression tests with mocked queries; no live learner data is read
// or written.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadSource(path, overrides = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (id) => (Object.hasOwn(overrides, id) ? overrides[id] : require(id)),
    module,
    module.exports,
  );
  return module.exports;
}

const constants = loadSource("../../src/constants/llPipeline.ts");
function renderJourney({ isPending = false, llReceived = false } = {}) {
  const updates = [];
  const navigations = [];
  const errors = [];
  let button;
  const { default: LLJourney } = loadSource(
    "../../src/components/ll_flow/LLJourney.tsx",
    {
      "react-router-dom": {
        useNavigate: () => (path) => navigations.push(path),
      },
      sonner: { toast: { error: (message) => errors.push(message) } },
      "@/components/ui/badge": { Badge: () => null },
      "@/components/ui/button": {
        Button: (props) => {
          button = props;
          return createElement("button", props);
        },
      },
      "@/constants/llPipeline": constants,
      "@/constants/support": {},
      "@/queries/learner": {
        useLearner: () => ({
          data: {
            id: "test-learner",
            name: "Learner",
            LL_received: llReceived,
          },
        }),
        useLearnerUpdate: () => ({
          isPending,
          mutate: (data, callbacks) => updates.push({ data, callbacks }),
        }),
      },
      "@/queries/llApplications": {},
      "@/queries/llCustomer": {
        useMyLLApplication: () => ({
          data: {
            application: { id: "test-application", status: "ll_issued" },
            documents: [],
          },
        }),
        useFirstCoursePaymentDate: () => ({ data: null }),
        useCustomerLLStatusUpdate: () => ({}),
        useRequestLLHelp: () => ({}),
      },
      "./DLJourney": {},
      "./journeyShared": {
        JourneyCard: ({ title, children }) =>
          createElement("section", null, title, children),
      },
      "./LLApplicationForm": {},
      "./LLFillForm": {},
    },
  );
  const html = renderToStaticMarkup(createElement(LLJourney));
  return { button, html, updates, navigations, errors };
}

const expectedFlags = {
  LL_received: true,
  LL_result: true,
  LL_application_approved: true,
  LL_team_appointment_booked: true,
};

test("approved LL CTA saves licence flags, then opens new schedule preferences", () => {
  const view = renderJourney();
  assert.match(view.html, /Your LL Has Been Approved/);
  assert.equal(view.button.children, "Set Your Preferences");
  assert.equal(view.button.type, "button");
  assert.equal(view.button.disabled, false);

  view.button.onClick();
  assert.equal(view.updates.length, 1);
  assert.deepEqual(view.updates[0].data, expectedFlags);
  assert.deepEqual(view.navigations, []);

  view.updates[0].callbacks.onSuccess();
  assert.deepEqual(view.navigations, ["/createSchedule/preferences?type=new"]);
});

test("CTA still navigates when LL_received is already true", () => {
  const view = renderJourney({ llReceived: true });
  view.button.onClick();
  view.updates[0].callbacks.onSuccess();
  assert.deepEqual(view.navigations, ["/createSchedule/preferences?type=new"]);
});

test("pending update disables the CTA and prevents another update", () => {
  const view = renderJourney({ isPending: true });
  assert.equal(view.button.disabled, true);
  assert.equal(view.button.children, "Opening Preferences...");
  view.button.onClick();
  assert.deepEqual(view.updates, []);
  assert.deepEqual(view.navigations, []);
});

test("failed update shows actionable feedback without navigating", () => {
  const view = renderJourney();
  view.button.onClick();
  view.updates[0].callbacks.onError(new Error("Update failed"));
  assert.deepEqual(view.navigations, []);
  assert.deepEqual(view.errors, [
    "Unable to open your preferences. Please try again.",
  ]);
});
