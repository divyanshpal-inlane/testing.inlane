import { validateCreateLearnerRequest, ValidationError } from "./validation.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertValidationError = (callback: () => unknown, message: string) => {
  try {
    callback();
  } catch (error) {
    assert(error instanceof ValidationError, "Expected a ValidationError");
    assert(
      (error as Error).message === message,
      `Expected "${message}", received "${(error as Error).message}"`,
    );
    return;
  }
  throw new Error("Expected validation to fail");
};

const basePayload = {
  name: "Test Learner",
  email: "learner@example.com",
  phone: "9876543210",
};

const coursePayload = {
  vehicleType: "four_wheeler",
  courseId: "e129f667-0510-4f07-9847-edb58356dc74",
  amount: 10000,
  installmentType: "installment",
  installment1Amount: 5000,
  installment2Amount: 5000,
  unlockedLessons: [1],
  courseTypeSelection: "predefined",
  totalLessons: 10,
  selectedModules: [],
  modulePrices: {},
};

const classesPayload = {
  ...basePayload,
  ...coursePayload,
  caseType: "classes_only",
  has_a_DL: false,
  has_two_wheeler_license: false,
  address_change_required: false,
  LL_received: false,
};

const rtoPayload = {
  ...basePayload,
  caseType: "rto_only",
  twoWheelerRequirement: "ll",
  fourWheelerRequirement: "not_required",
  rtoFee: 2500,
  rtoAddressChangeRequired: false,
};

Deno.test("validates and normalizes Classes Only", () => {
  const result = validateCreateLearnerRequest(classesPayload);
  assert(result.caseType === "classes_only", "Expected Classes Only");
  assert(result.courseId === classesPayload.courseId, "Expected course ID");
  assert(result.twoWheelerRequirement === null, "Expected no RTO values");
});

Deno.test("rejects hidden RTO values for Classes Only", () => {
  assertValidationError(
    () =>
      validateCreateLearnerRequest({
        ...classesPayload,
        rtoFee: 100,
      }),
    "Classes-only cases cannot include hidden RTO values",
  );
});

Deno.test("validates RTO Only without course values", () => {
  const result = validateCreateLearnerRequest(rtoPayload);

  assert(result.courseId === null, "Expected no course ID");
  assert(result.rtoFee === 2500, "Expected RTO fee");
});

Deno.test("rejects hidden course values for RTO Only", () => {
  assertValidationError(
    () =>
      validateCreateLearnerRequest({
        ...rtoPayload,
        amount: 0,
      }),
    "RTO-only cases cannot include hidden course or course-payment values",
  );
});

Deno.test("validates Lessons with RTO Services", () => {
  const result = validateCreateLearnerRequest({
    ...basePayload,
    ...coursePayload,
    caseType: "lessons_with_rto",
    twoWheelerRequirement: "not_required",
    fourWheelerRequirement: "ll_and_dl",
    rtoFee: 3500,
    rtoAddressChangeRequired: true,
  });

  assert(result.courseId === classesPayload.courseId, "Expected course ID");
  assert(result.rtoAddressChangeRequired, "Expected address change");
});

Deno.test("requires an RTO service and limits address change to DL", () => {
  const rtoPayload = {
    ...basePayload,
    caseType: "rto_only",
    twoWheelerRequirement: "not_required",
    fourWheelerRequirement: "not_required",
    rtoFee: 0,
    rtoAddressChangeRequired: false,
  };

  assertValidationError(
    () => validateCreateLearnerRequest(rtoPayload),
    "Select at least one 2-wheeler or 4-wheeler RTO service",
  );

  assertValidationError(
    () =>
      validateCreateLearnerRequest({
        ...rtoPayload,
        twoWheelerRequirement: "ll",
        rtoAddressChangeRequired: true,
      }),
    "Address change is only available when a DL service is required",
  );

  assertValidationError(
    () =>
      validateCreateLearnerRequest({
        ...rtoPayload,
        twoWheelerRequirement: "ll",
        has_a_DL: false,
      }),
    "RTO cases cannot include hidden legacy licence-state values",
  );
});
