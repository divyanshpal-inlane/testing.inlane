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
  
  // If learner has completed setup (has preferences), no further steps needed
  if (hasPreferences) return null;
  
  // Demo learners skip details/questions and go straight to preferences
  if (isDemo) {
    return "/createSchedule/preferences?type=new";
  }
  
  // For first-time setup (no preferences yet):
  // ALWAYS start from step 1 (details page) regardless of what data exists.
  // This ensures the learner goes through all 4 steps properly:
  // Step 1: /createSchedule/details (pickup location)
  // Step 2: /createSchedule/onboardingQuestions (start date)
  // Step 3: /createSchedule/uploadLL (licence upload)
  // Step 4: /createSchedule/preferences (time slots)
  // The payment flow may pre-populate some fields, but we want the learner
  // to review and confirm everything in the proper sequence.
  return "/createSchedule/details";
}
