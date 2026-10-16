export type LearnerServiceCaseType =
  | "classes_only"
  | "rto_only"
  | "lessons_with_rto";

type ServiceEnrollment = {
  case_type: string | null;
  created_at: string;
  status: string;
};

const SERVICE_CASE_TYPES = new Set<LearnerServiceCaseType>([
  "classes_only",
  "rto_only",
  "lessons_with_rto",
]);

export function learnerHomeExperience(
  caseType: string | null | undefined,
): "classes" | "rto" | "legacy" {
  if (caseType === "classes_only") return "classes";
  if (caseType === "rto_only" || caseType === "lessons_with_rto") return "rto";
  if (caseType === null || caseType === undefined) return "legacy";

  // Unknown explicit values must not fall back to licence status. The database
  // constraint prevents these today; defaulting to Classes is fail-safe because
  // it cannot incorrectly force a learner into an LL application journey.
  return "classes";
}

export function shouldRenderLearnerLLFlow(
  caseType: string | null | undefined,
  llReceived: boolean | null | undefined,
  isDemo: boolean,
): boolean {
  const experience = learnerHomeExperience(caseType);

  if (experience === "rto") return true;
  if (experience === "classes") return false;

  return !llReceived && !isDemo;
}

/**
 * Returns the latest open enrollment created from the admin's selected service.
 * Enrollment status is deliberately not ranked: RTO-only rows remain pending,
 * while a paid Classes-only row becomes active.
 */
export function selectLatestLearnerServiceEnrollment<
  T extends ServiceEnrollment,
>(enrollments: readonly T[]): T | null {
  return (
    [...enrollments]
      .filter(
        (enrollment) =>
          (enrollment.status === "active" || enrollment.status === "pending") &&
          SERVICE_CASE_TYPES.has(
            enrollment.case_type as LearnerServiceCaseType,
          ),
      )
      .sort(
        (first, second) =>
          new Date(second.created_at).getTime() -
          new Date(first.created_at).getTime(),
      )[0] ?? null
  );
}
