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
    const requestedLessons = new Set(request.lesson_ids);
    const requestedAt = Date.parse(request.created_at ?? "");
    // Missing metadata cannot prove fulfillment; don't silently hide a learner.
    if (requestedLessons.size === 0 || !Number.isFinite(requestedAt))
      return true;
    const isVirtual = request.lesson_ids.every((id) =>
      id.startsWith("virtual-lesson-"),
    );
    const fulfillingSchedules = (
      byLearner.get(request.learner_id) ?? []
    ).filter(
      (schedule) =>
        Date.parse(schedule.created_at!) >= requestedAt - FULFILL_BACKDATE_MS &&
        (isVirtual
          ? schedule.lesson_id === null
          : schedule.lesson_id !== null &&
            requestedLessons.has(schedule.lesson_id)),
    );
    // Duplicate rows for one lesson are not multiple fulfilled lessons.
    const fulfillingCount = isVirtual
      ? fulfillingSchedules.length
      : new Set(fulfillingSchedules.map((schedule) => schedule.lesson_id)).size;

    return fulfillingCount < requestedLessons.size;
  });
}
