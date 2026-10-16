# Onboarding → New Schedules queue repair

## Fix

The availability screen used to navigate away as soon as preferences saved,
while the `reschedule_requests` insert/update was still in flight. Insert
failures were logged without giving the learner a retry, leaving preferences
saved but no admin queue entry.

Save now awaits preferences **and** the queue request before navigating or
sending notifications. Failures stay on screen with a retry message. A retry
reuses an existing pending new request, preserves its payment link and keeps
virtual lesson IDs/hour counts intact. Flexible availability is saved as all
slots, rather than an empty preference list.

Request creation/completion invalidates both regular and infinite admin queue
queries, plus learner pending requests. Admin queues poll every 30 seconds
while visible and have a manual refresh/error state. Refresh does not clear an
in-progress instructor assignment. Both queue readers share a fulfillment
filter: cancelled/paused schedules and unrelated-course lessons (including a
recent demo) cannot hide a pending course request.

## Save works on Vercel but fails on localhost (phone-format RLS)

Localhost and Vercel can use the same Supabase project and frontend code but
have **different login sessions**. A Supabase-issued JWT commonly contains
`91XXXXXXXXXX`, while a Go-auth JWT or the `Learner.phone` row can contain
`XXXXXXXXXX` or `+91XXXXXXXXXX`. The original `reschedule_requests` learner
policies compared the raw strings. A learner visible through the app's
phone-format lookup could therefore save preferences but have their queue
insert rejected with PostgreSQL `42501`. Refreshing or redeploying the
frontend alone does not repair these database policies.

**Required database fix:** manually apply
`supabase/migrations/20261006010000_normalize_scheduling_learner_rls.sql` in the
SQL Editor of the Supabase project configured by `VITE_SUPABASE_URL`. When
localhost points to the hosted project, apply it there, not just to Docker's
local database. For a genuinely local Supabase project, apply it locally too.

The migration normalizes the trusted JWT phone and learner phone to the last
10 digits for scheduling-request SELECT/INSERT/UPDATE and preference
SELECT/INSERT/UPDATE/DELETE. Missing or short JWT phones grant no ownership.
The helper runs with the caller's privileges; admin policies, profile phones,
existing requests, payments and schedules are unchanged. Reapplying it is safe.
Do **not** bypass RLS with the service-role client in the learner save flow.

After applying it, retry Save. An existing pending new request is reused rather
than duplicated. The frontend also distinguishes an authorization rejection
from a generic network/save error and retains the selected timings.

### SQL Editor reports a connection timeout

A connection timeout is not proof that SQL was invalid or that the transaction
failed to commit. First run this **read-only** check in a new SQL Editor query:

```sql
SELECT now(), to_regprocedure('public.current_scheduling_learner_ids()') AS helper;
```

If even that times out, investigate the project's SQL Editor/database connection
before rerunning the migration; do not restart production or terminate arbitrary
queries. If `helper` is NULL, the function is absent. If it exists, verify the
seven learner policies in `pg_policies` reference the helper before assuming the
migration is complete (the REST schema cache alone is not a definitive check).

The migration sets a 5-second lock timeout and a 30-second per-statement timeout,
so busy tables fail promptly rather than waiting for a dashboard disconnect.
After the connection works, retry the **entire** script, including BEGIN/COMMIT.
It is idempotent and transactional; do not apply individual policy drops outside
the transaction. A persistent lock timeout needs investigation of the blocking
transaction, not a larger timeout or disabling RLS.

## Deployment and already-affected learners

1. Deploy the frontend changes.
2. Manually apply
   `supabase/migrations/20261006000000_recover_missing_new_scheduling_requests.sql`
   in the Supabase SQL Editor.
3. Refresh **Schedule Management → New Schedules**.

The migration only inserts missing requests for paid, active enrollments with
completed onboarding, pickup coordinates, availability and a start date (except
demos). It excludes RTO-only enrollments, existing pending/payment requests,
fulfilled requests and already/partly scheduled enrollments. It is transactional
and idempotent; existing documents, timings, requests and schedules are not
modified. Custom courses retain their full purchased hours minus credited demos,
including half-paid courses. Predefined lesson IDs are deduplicated by number.

This is deliberately a conservative repair, not a rebooking of completed
courses or arbitrary learners. Applying it is a separate manual deployment step;
frontend deployment alone does not recover older missing database rows.

## Offline verification (no production writes)

```bash
node --test tests/scheduling/onboarding-queue.test.mjs
```

For the migration test, install PGlite outside the project (no app dependency):

```bash
npm install --prefix /tmp/inlane-scheduling-sql-test --ignore-scripts @electric-sql/pglite
PGLITE_MODULE=/tmp/inlane-scheduling-sql-test/node_modules/@electric-sql/pglite/dist/index.js node --test tests/scheduling/recover-missing-requests.test.mjs tests/scheduling/scheduling-learner-rls.test.mjs
```

On Windows, set `PGLITE_MODULE` to the absolute Windows path of that installed
module. The test uses a disposable in-memory PostgreSQL database and tests
eligibility, existing/fulfilled requests, demo upgrades, custom hour counts,
duplicate lesson records and rerun safety. The RLS test reproduces the original
country-code rejection, then verifies Save across phone-format combinations,
virtual lesson IDs, cross-learner write denial, malformed/missing claims,
unauthenticated denial and preserved admin access.
