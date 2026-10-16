/**
 * Offset-paginated results can overlap after a refresh or a roster change.
 * Keep one card per learner ID across all pages, preserving first-seen order
 * while using the most recently fetched profile for repeated IDs.
 * Never deduplicate by name/phone: different learner records own different
 * schedules and must remain independently accessible.
 */
export function uniqueAdminLearners<T extends { id: string }>(
  pages: readonly { learners: readonly T[] }[] | undefined,
): T[] {
  const learners = new Map<string, T>();
  for (const page of pages ?? []) {
    for (const learner of page.learners) {
      if (learner.id) learners.set(learner.id, learner);
    }
  }
  return [...learners.values()];
}
