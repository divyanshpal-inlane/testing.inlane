# Instructor / learner schedule visibility

## Confirmed failure

`LearnerInfoDialog` fetched Schedule rows, then looked up course and instructor
names using `.in()` with all foreign keys. Demo/custom/topup classes legitimately
have `course_id = null`; an unassigned class can have `instructor_id = null`.
PostgREST rejects `in.(null)` for UUID columns with `22P02`. The error was only
logged, leaving the dialog showing **No schedules found** despite existing rows.
A failed enrollment lookup also prevented the schedule fetch entirely.

## Fix

- `src/lib/admin-schedules.ts` is the shared reader for the learner info dialog,
  learner schedule manager and Instructor Management's View Schedule page.
- Reads Schedule directly by the exact learner/instructor ID with optional left
  joins; no nullable UUID lookup or active-enrollment prerequisite.
- Paginates all rows in stable date/time/id order instead of relying on a
  potentially truncated embedded relation (Supabase's default cap is 1000).
- Fetch errors show a retry/refresh action, not an empty-state message.
- Cancelled/late reads cannot replace the selected learner's classes.
- Learner manager refreshes on window focus and every 30 seconds while visible;
  instructor query polls while visible as a fallback for unavailable Realtime.
  The info dialog fetches on each open and supports retry.
- Dialog numbering accounts for two-hour classes, consistent with the manager.
- Active-list cache invalidation uses the actual `activeLearners-infinite` key;
  instructor deletion checks database errors and uses TanStack Query v5 filters.

## Verification

```bash
node --test tests/scheduling/admin-schedule-consistency.test.mjs
```

Offline tests cover null/mixed course IDs, unassigned classes, enrollment errors,
actual empty results vs failures, retry, late responses after learner changes,
2-hour numbering, deterministic pagination past 1000 rows and cancellation.
Read-only local snapshot checks additionally compare real schedule IDs between
learner/instructor readers and the largest instructor's database count.

**Deployment:** frontend changes only; this visibility fix requires no new SQL
migration. The earlier onboarding queue recovery migration is a separate fix.
