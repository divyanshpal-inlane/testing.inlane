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
PGLITE_MODULE=/tmp/inlane-scheduling-sql-test/node_modules/@electric-sql/pglite/dist/index.js node --test tests/scheduling/recover-missing-requests.test.mjs
```

On Windows, set `PGLITE_MODULE` to the absolute Windows path of that installed
module. The test uses a disposable in-memory PostgreSQL database and tests
eligibility, existing/fulfilled requests, demo upgrades, custom hour counts,
duplicate lesson records and rerun safety.
