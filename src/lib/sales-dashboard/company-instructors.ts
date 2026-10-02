import { normalizeName } from "./kml";

/**
 * Company instructors are in-house backups, not sales inventory.
 *
 * Ops assigns them to learners by hand, so they must never be returned by
 * automatic area matching — otherwise a general user can be auto-assigned a
 * company instructor they did not choose.
 *
 * Two rules keep that true:
 *   1. They are never matched by the sales-dashboard location search.
 *   2. They are never matched by the shared `instructorServesArea()` engine
 *      (learner booking / direct booking).
 *
 * Authoritative source: `Instructor.is_company_instructor` (migration
 * 20260929_100000), read via `zones-db.fetchCompanyInstructorIds()`. That
 * survives a rename and covers backups added after this file was written.
 *
 * The name list below is the FALLBACK for when that column has not been
 * migrated yet, or when a caller only has a display name and no id. It is
 * normalized so casing and stray whitespace do not matter. Keep it in sync
 * with the `Instructor` table — a name that is not on the list will fall
 * through to the name check and be auto-matched until the migration is applied.
 */
export const COMPANY_INSTRUCTOR_NAMES: readonly string[] = [
  "Amanulla Khan",
  "Krupakar Daniel Dennish",
];

const COMPANY_INSTRUCTOR_KEYS: ReadonlySet<string> = new Set(
  COMPANY_INSTRUCTOR_NAMES.map(normalizeName),
);

/** Name-based check. Prefer `isCompanyInstructorId` when an id is available. */
export function isCompanyInstructor(name: string | null | undefined): boolean {
  if (!name) return false;
  return COMPANY_INSTRUCTOR_KEYS.has(normalizeName(name));
}

/** Id-based check against the `is_company_instructor` DB flag. */
export function isCompanyInstructorId(
  id: string | null | undefined,
  flaggedIds: ReadonlySet<string> | null | undefined,
): boolean {
  if (!id) return false;
  return flaggedIds?.has(id) === true;
}
