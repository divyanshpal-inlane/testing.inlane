// The Sales Dashboard only ever works with ACTIVE instructors. "On break" and
// "inactive" instructors are not shown anywhere on it: not in the grid, the
// instructor list, name search suggestions, the location map polygons, the
// "instructors near" chips, or a restored roster. (They stay visible in
// Instructor Management and on the Zone Map, which are separate screens.)
//
// One definition, used by the data loaders (so such a row never enters any
// dashboard state) and by the dashboard's own guards.
//
// Both columns are checked because they are only kept in sync by the admin UI:
// a row with enabled = false, or any status other than "active", is excluded.
// A missing status counts as active (rows older than the status column).

export interface InstructorStatusFields {
  status?: string | null;
  enabled?: boolean | null;
}

export function isActiveInstructor(row: InstructorStatusFields): boolean {
  if (row.enabled === false) return false;
  return (row.status ?? "active") === "active";
}
