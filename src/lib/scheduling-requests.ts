type QueueRequest = {
  learner_id: string;
  type: string;
  lesson_ids: string[];
  created_at: string | null;
};

type ExistingSchedule = {
  learner_id: string | null;
  lesson_id: string | null;
  created_at: string | null;
  status: string | null;
};

// Keep the original one-day payment-webhook race allowance, but a schedule
// only fulfills a request for THAT lesson/course, never an unrelated demo.
const FULFILL_BACKDATE_MS = 24 * 60 * 60 * 1000;
const NON_FULFILLING_STATUSES = new Set(["paused", "cancelled", "canceled"]);

export function filterUnfulfilledSchedulingRequests<T extends QueueRequest>(
  requests: T[],
  schedules: ExistingSchedule[],
): T[] {
  const byLearner = new Map<string, ExistingSchedule[]>();
  for (const schedule of schedules) {
    if (
      !schedule.learner_id ||
      !schedule.created_at ||
      NON_FULFILLING_STATUSES.has((schedule.status ?? "").toLowerCase())
    ) {
      continue;
    }
    const rows = byLearner.get(schedule.learner_id) ?? [];
    rows.push(schedule);
    byLearner.set(schedule.learner_id, rows);
  }

  return requests.filter((request) => {
    // Reschedules and lesson10 deliberately refer to already scheduled lessons.
    if (request.type !== "new") return true;

    // Get all active schedules for this learner (statuses other than paused/cancelled)
    const learnerSchedules = byLearner.get(request.learner_id) ?? [];

    // For "new" type requests: If the learner has ANY active schedules, filter them out
    // "New Schedules" tab should only show learners who need schedules created for the FIRST time
    // If they already have schedules (booked/ongoing/completed), they're not "new" anymore
    if (learnerSchedules.length > 0) {
      return false; // Filter out - they already have schedules
    }

    // If no active schedules, keep them in "New Schedules" queue
    return true;
  });
}
