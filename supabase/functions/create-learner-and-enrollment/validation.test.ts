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
  vehicleType: "two_wheeler",
  amount: 2500,
  installmentType: "installment",
  installment1Amount: 1000,
  installment2Amount: 1500,
  twoWheelerRequirement: "ll",
  fourWheelerRequirement: "not_required",
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
        twoWheelerRequirement: "ll",
      }),
    "Classes-only cases cannot include hidden RTO values",
  );
});

Deno.test("validates RTO Only without course values", () => {
  const result = validateCreateLearnerRequest(rtoPayload);

  assert(result.courseId === null, "Expected no course ID");
  assert(result.amount === 2500, "Expected total amount");
  assert(result.vehicleType === "two_wheeler", "Expected vehicle type");
});

Deno.test("rejects hidden course values for RTO Only", () => {
  assertValidationError(
    () =>
      validateCreateLearnerRequest({
        ...rtoPayload,
        courseId: coursePayload.courseId,
      }),
    "RTO-only cases cannot include hidden course values",
  );
});

Deno.test("validates RTO + Classes", () => {
  const result = validateCreateLearnerRequest({
    ...basePayload,
    ...coursePayload,
    caseType: "lessons_with_rto",
    twoWheelerRequirement: "not_required",
    fourWheelerRequirement: "ll_and_dl",
    rtoAddressChangeRequired: true,
  });

  assert(result.courseId === classesPayload.courseId, "Expected course ID");
  assert(result.rtoAddressChangeRequired, "Expected address change");
});

Deno.test(
  "requires an RTO service and accepts either address-change option",
  () => {
    const rtoPayload = {
      ...basePayload,
      caseType: "rto_only",
      vehicleType: "four_wheeler",
      amount: 2500,
      installmentType: "full",
      installment1Amount: 2500,
      installment2Amount: 0,
      twoWheelerRequirement: "not_required",
      fourWheelerRequirement: "not_required",
      rtoAddressChangeRequired: false,
    };

    assertValidationError(
      () => validateCreateLearnerRequest(rtoPayload),
      "Select at least one 2-wheeler or 4-wheeler RTO service",
    );

    const addressChangeResult = validateCreateLearnerRequest({
      ...rtoPayload,
      twoWheelerRequirement: "ll",
      rtoAddressChangeRequired: true,
    });
    assert(
      addressChangeResult.rtoAddressChangeRequired,
      "Expected address change to be required",
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
  },
);

Deno.test("limits Classes Only to 4-Wheeler", () => {
  assertValidationError(
    () =>
      validateCreateLearnerRequest({
        ...classesPayload,
        vehicleType: "two_wheeler",
      }),
    "Classes Only supports 4-Wheeler only",
  );
});
