// Run: node --test tests/routing/learner-service.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../../src/lib/learner-service.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const module = { exports: {} };
new Function("require", "module", "exports", outputText)(
  require,
  module,
  module.exports,
);

const {
  learnerHomeExperience,
  selectLatestLearnerServiceEnrollment,
  shouldRenderLearnerLLFlow,
} = module.exports;

const enrollment = (changes = {}) => ({
  case_type: "classes_only",
  created_at: "2026-09-26T10:00:00.000Z",
  id: "classes-enrollment",
  status: "active",
  ...changes,
});

test("Classes Only selection drives the Classes home experience", () => {
  const selected = selectLatestLearnerServiceEnrollment([enrollment()]);

  assert.equal(selected.case_type, "classes_only");
  assert.equal(learnerHomeExperience(selected.case_type), "classes");
});

test("pending RTO Only selection drives the RTO home experience", () => {
  const selected = selectLatestLearnerServiceEnrollment([
    enrollment({
      case_type: "rto_only",
      id: "rto-enrollment",
      status: "pending",
    }),
  ]);

  assert.equal(selected.case_type, "rto_only");
  assert.equal(learnerHomeExperience(selected.case_type), "rto");
});

test("Classes Only never renders LLFlow, regardless of LL_received", () => {
  assert.equal(shouldRenderLearnerLLFlow("classes_only", false, false), false);
  assert.equal(shouldRenderLearnerLLFlow("classes_only", true, false), false);
});

test("RTO Only always renders LLFlow, regardless of LL_received", () => {
  assert.equal(shouldRenderLearnerLLFlow("rto_only", false, false), true);
  assert.equal(shouldRenderLearnerLLFlow("rto_only", true, false), true);
});

test("only a learner without case_type uses the legacy LL_received fallback", () => {
  assert.equal(shouldRenderLearnerLLFlow(null, false, false), true);
  assert.equal(shouldRenderLearnerLLFlow(undefined, true, false), false);
  assert.equal(shouldRenderLearnerLLFlow(null, false, true), false);
});

test("RTO plus Classes is explicit RTO service and never uses the legacy fallback", () => {
  assert.equal(learnerHomeExperience("lessons_with_rto"), "rto");
  assert.equal(
    shouldRenderLearnerLLFlow("lessons_with_rto", true, false),
    true,
  );
});

test("new pending RTO selection wins over an older active Classes enrollment", () => {
  const selected = selectLatestLearnerServiceEnrollment([
    enrollment({
      case_type: "rto_only",
      created_at: "2026-09-27T10:00:00.000Z",
      id: "new-rto-enrollment",
      status: "pending",
    }),
    enrollment({ id: "old-active-classes-enrollment" }),
  ]);

  assert.equal(selected.id, "new-rto-enrollment");
  assert.equal(selected.case_type, "rto_only");
  assert.equal(learnerHomeExperience(selected.case_type), "rto");
});

test("the latest explicit selection wins without status precedence", () => {
  const selected = selectLatestLearnerServiceEnrollment([
    enrollment({
      case_type: "rto_only",
      id: "old-rto-enrollment",
      status: "pending",
    }),
    enrollment({
      created_at: "2026-09-27T10:00:00.000Z",
      id: "new-classes-enrollment",
    }),
  ]);

  assert.equal(selected.id, "new-classes-enrollment");
  assert.equal(selected.case_type, "classes_only");
});

test("rows without a current explicit service selection are ignored", () => {
  const selected = selectLatestLearnerServiceEnrollment([
    enrollment({ case_type: null, id: "legacy-enrollment" }),
    enrollment({ id: "cancelled-selection", status: "cancelled" }),
  ]);

  assert.equal(selected, null);
});

test("learner login and the protected learner index use only /home", () => {
  const loginSource = readFileSync(
    new URL("../../src/routes/login.tsx", import.meta.url),
    "utf8",
  );
  const appSource = readFileSync(
    new URL("../../src/App.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    loginSource,
    /user_metadata\.user_role === "learner"[\s\S]*?<Navigate to="\/home"/,
  );
  assert.match(appSource, /<Route path="home" element={<Home \/>} \/>/);
  assert.doesNotMatch(loginSource, /ll-application/);
  assert.doesNotMatch(appSource, /ll-application/);
});
