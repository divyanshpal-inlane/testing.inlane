export const CASE_TYPES = [
  "classes_only",
  "rto_only",
  "lessons_with_rto",
] as const;

export const LICENCE_REQUIREMENTS = [
  "ll",
  "dl",
  "ll_and_dl",
  "not_required",
] as const;

export const VEHICLE_TYPES = ["two_wheeler", "four_wheeler"] as const;
export const COURSE_TYPES = ["predefined", "custom", "demo"] as const;

export type CaseType = (typeof CASE_TYPES)[number];
export type LicenceRequirement = (typeof LICENCE_REQUIREMENTS)[number];
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export type CourseType = (typeof COURSE_TYPES)[number];

export interface ValidatedCreateLearnerRequest {
  name: string;
  email: string;
  phone: string;
  caseType: CaseType;
  vehicleType: VehicleType | null;
  courseId: string | null;
  amount: number;
  installmentType: "full" | "installment" | null;
  installment1Amount: number;
  installment2Amount: number;
  unlockedLessons: number[];
  courseTypeSelection: CourseType | null;
  totalLessons: number;
  selectedModules: string[];
  modulePrices: Record<string, number>;
  has_a_DL: boolean;
  has_two_wheeler_license: boolean;
  address_change_required: boolean;
  LL_received: boolean;
  twoWheelerRequirement: LicenceRequirement | null;
  fourWheelerRequirement: LicenceRequirement | null;
  rtoFee: number;
  rtoAddressChangeRequired: boolean;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOneOf = <T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] =>
  typeof value === "string" && allowed.includes(value as T[number]);

const requiredString = (
  data: Record<string, unknown>,
  key: string,
  label: string,
): string => {
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${label} is required`);
  }
  return value.trim();
};

const finiteNumber = (value: unknown, label: string, minimum = 0): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new ValidationError(`${label} must be at least ${minimum}`);
  }
  return value;
};

const optionalBoolean = (value: unknown, label: string): boolean => {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new ValidationError(`${label} must be true or false`);
  }
  return value;
};

const stringArray = (value: unknown, label: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(`${label} must be a list of strings`);
  }
  return value;
};

const numberArray = (value: unknown, label: string): number[] => {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => !Number.isInteger(item) || (item as number) <= 0)
  ) {
    throw new ValidationError(`${label} must contain positive lesson numbers`);
  }
  return value as number[];
};

const numberRecord = (
  value: unknown,
  label: string,
): Record<string, number> => {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new ValidationError(`${label} must be an object`);
  }

  const result: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    result[key] = finiteNumber(rawValue, `${label}.${key}`);
  }
  return result;
};

const includesDl = (requirement: LicenceRequirement): boolean =>
  requirement === "dl" || requirement === "ll_and_dl";

export function validateCreateLearnerRequest(
  input: unknown,
): ValidatedCreateLearnerRequest {
  if (!isRecord(input)) {
    throw new ValidationError("Request body must be an object");
  }

  const name = requiredString(input, "name", "Name");
  const email = requiredString(input, "email", "Email");
  const phone = requiredString(input, "phone", "Phone");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("Invalid email address");
  }
  if (!/^\d{10}$/.test(phone)) {
    throw new ValidationError("Phone must contain exactly 10 digits");
  }

  const isLegacyClassesRequest = input.caseType === undefined;
  const rawCaseType = input.caseType ?? "classes_only";
  if (!isOneOf(rawCaseType, CASE_TYPES)) {
    throw new ValidationError("Invalid case type");
  }
  const caseType = rawCaseType;
  const hasCourse = caseType !== "rto_only";
  const hasRto = caseType !== "classes_only";

  let vehicleType: VehicleType | null = null;
  let courseId: string | null = null;
  let amount = 0;
  let installmentType: "full" | "installment" | null = null;
  let installment1Amount = 0;
  let installment2Amount = 0;
  let unlockedLessons: number[] = [];
  let courseTypeSelection: CourseType | null = null;
  let totalLessons = 0;
  let selectedModules: string[] = [];
  let modulePrices: Record<string, number> = {};

  if (hasCourse) {
    if (
      isLegacyClassesRequest &&
      (input.vehicleType === undefined || input.vehicleType === null)
    ) {
      vehicleType = null;
    } else if (!isOneOf(input.vehicleType, VEHICLE_TYPES)) {
      throw new ValidationError("Vehicle is required");
    } else {
      vehicleType = input.vehicleType;
    }

    if (!isOneOf(input.courseTypeSelection, COURSE_TYPES)) {
      throw new ValidationError("Invalid course type");
    }
    courseTypeSelection = input.courseTypeSelection;
    amount = finiteNumber(input.amount, "Course amount");
    totalLessons = finiteNumber(input.totalLessons, "Total lessons", 1);
    selectedModules = stringArray(input.selectedModules, "Selected modules");
    modulePrices = numberRecord(input.modulePrices, "Module prices");
    unlockedLessons = numberArray(input.unlockedLessons, "Unlocked lessons");

    if (
      input.installmentType !== "full" &&
      input.installmentType !== "installment"
    ) {
      throw new ValidationError("Invalid payment type");
    }
    installmentType = input.installmentType;
    installment1Amount = finiteNumber(
      input.installment1Amount,
      "First payment amount",
    );
    installment2Amount = finiteNumber(
      input.installment2Amount,
      "Second payment amount",
    );

    if (
      installmentType === "installment" &&
      Math.abs(installment1Amount + installment2Amount - amount) > 0.01
    ) {
      throw new ValidationError(
        "Installment amounts must equal the course amount",
      );
    }

    const rawCourseId = input.courseId;
    if (courseTypeSelection === "predefined") {
      if (typeof rawCourseId !== "string" || !rawCourseId.trim()) {
        throw new ValidationError("Course is required");
      }
      courseId = rawCourseId;
      if (selectedModules.length > 0 || Object.keys(modulePrices).length > 0) {
        throw new ValidationError(
          "Predefined courses cannot include custom modules",
        );
      }
    } else {
      if (
        rawCourseId !== null &&
        rawCourseId !== "" &&
        rawCourseId !== undefined
      ) {
        throw new ValidationError(
          "Custom and demo courses cannot include a course ID",
        );
      }
      if (courseTypeSelection === "custom") {
        if (selectedModules.length === 0) {
          throw new ValidationError("Select at least one custom module");
        }
        const moduleTotal = selectedModules.reduce(
          (sum, moduleId) => sum + (modulePrices[moduleId] ?? Number.NaN),
          0,
        );
        if (
          !Number.isFinite(moduleTotal) ||
          Math.abs(moduleTotal - amount) > 0.01
        ) {
          throw new ValidationError(
            "Custom module prices must equal the course amount",
          );
        }
      } else if (
        selectedModules.length > 0 ||
        Object.keys(modulePrices).length > 0
      ) {
        throw new ValidationError("Demo courses cannot include custom modules");
      }
    }
  } else {
    const hiddenCourseValuesPresent = [
      "vehicleType",
      "courseId",
      "amount",
      "installmentType",
      "installment1Amount",
      "installment2Amount",
      "selectedModules",
      "modulePrices",
      "unlockedLessons",
      "courseTypeSelection",
      "totalLessons",
    ].some((key) => input[key] !== undefined);

    if (hiddenCourseValuesPresent) {
      throw new ValidationError(
        "RTO-only cases cannot include hidden course or course-payment values",
      );
    }
  }

  let twoWheelerRequirement: LicenceRequirement | null = null;
  let fourWheelerRequirement: LicenceRequirement | null = null;
  let rtoFee = 0;
  let rtoAddressChangeRequired = false;

  if (hasRto) {
    if (
      input.has_a_DL !== undefined ||
      input.has_two_wheeler_license !== undefined ||
      input.address_change_required !== undefined ||
      input.LL_received !== undefined
    ) {
      throw new ValidationError(
        "RTO cases cannot include hidden legacy licence-state values",
      );
    }

    if (!isOneOf(input.twoWheelerRequirement, LICENCE_REQUIREMENTS)) {
      throw new ValidationError("Invalid 2-wheeler licence requirement");
    }
    if (!isOneOf(input.fourWheelerRequirement, LICENCE_REQUIREMENTS)) {
      throw new ValidationError("Invalid 4-wheeler licence requirement");
    }
    twoWheelerRequirement = input.twoWheelerRequirement;
    fourWheelerRequirement = input.fourWheelerRequirement;

    if (
      twoWheelerRequirement === "not_required" &&
      fourWheelerRequirement === "not_required"
    ) {
      throw new ValidationError(
        "Select at least one 2-wheeler or 4-wheeler RTO service",
      );
    }

    rtoFee = finiteNumber(input.rtoFee, "RTO fee");
    rtoAddressChangeRequired = optionalBoolean(
      input.rtoAddressChangeRequired,
      "RTO address change",
    );

    if (
      rtoAddressChangeRequired &&
      !includesDl(twoWheelerRequirement) &&
      !includesDl(fourWheelerRequirement)
    ) {
      throw new ValidationError(
        "Address change is only available when a DL service is required",
      );
    }
  } else {
    const hiddenRtoValuesPresent =
      input.twoWheelerRequirement !== undefined ||
      input.fourWheelerRequirement !== undefined ||
      input.rtoFee !== undefined ||
      input.rtoAddressChangeRequired !== undefined;
    if (hiddenRtoValuesPresent) {
      throw new ValidationError(
        "Classes-only cases cannot include hidden RTO values",
      );
    }
  }

  const includeLegacyLicenceState = caseType === "classes_only";

  return {
    name,
    email,
    phone,
    caseType,
    vehicleType,
    courseId,
    amount,
    installmentType,
    installment1Amount,
    installment2Amount,
    unlockedLessons,
    courseTypeSelection,
    totalLessons,
    selectedModules,
    modulePrices,
    has_a_DL: includeLegacyLicenceState
      ? optionalBoolean(input.has_a_DL, "4-wheeler licence state")
      : false,
    has_two_wheeler_license: includeLegacyLicenceState
      ? optionalBoolean(
          input.has_two_wheeler_license,
          "2-wheeler licence state",
        )
      : false,
    address_change_required: includeLegacyLicenceState
      ? optionalBoolean(input.address_change_required, "Legacy address change")
      : false,
    LL_received: includeLegacyLicenceState
      ? optionalBoolean(input.LL_received, "LL received")
      : false,
    twoWheelerRequirement,
    fourWheelerRequirement,
    rtoFee,
    rtoAddressChangeRequired,
  };
}
