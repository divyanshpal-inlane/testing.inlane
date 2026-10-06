type ScheduleSetupLearner = {
  address_lat?: number | null;
  address_lng?: number | null;
  preferred_start_date?: string | null;
};

export function hasLearnerPickupLocation(learner: ScheduleSetupLearner) {
  return (
    typeof learner.address_lat === "number" &&
    Number.isFinite(learner.address_lat) &&
    Math.abs(learner.address_lat) <= 90 &&
    typeof learner.address_lng === "number" &&
    Number.isFinite(learner.address_lng) &&
    Math.abs(learner.address_lng) <= 180
  );
}

/** A payment-created request is not evidence that the learner finished setup. */
export function nextLearnerScheduleSetupRoute(
  learner: ScheduleSetupLearner,
  {
    isDemo = false,
    hasPreferences = false,
    hasScheduledLessons = false,
  }: {
    isDemo?: boolean;
    hasPreferences?: boolean;
    hasScheduledLessons?: boolean;
  } = {},
): string | null {
  // Existing/finished courses must not be sent through first-time setup again.
  if (hasScheduledLessons) return null;
  if (!hasLearnerPickupLocation(learner)) {
    return isDemo
      ? "/createSchedule/details?type=demo"
      : "/createSchedule/details";
  }
  if (isDemo) {
    return hasPreferences ? null : "/createSchedule/preferences?type=new";
  }
  if (!learner.preferred_start_date) {
    return "/createSchedule/onboardingQuestions";
  }
  // The licence upload leads to availability. If the learner leaves midway,
  // resume here rather than treating a saved start date as completed setup.
  return hasPreferences ? null : "/createSchedule/uploadLL";
}
