> TEMPORARY CODE — Remove this monitoring system before final production release.

# Sales Dashboard — temporary usage monitoring

This is a **temporary, self-contained instrumentation layer** for
`/admin/sales-dashboard`. It exists to answer "how is the Sales Dashboard
actually being used, by whom, for how long, and what breaks?" while the screen
is still being iterated on. It is not a product feature.

Everything it adds is marked in code with:

```
// TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
```

---

## 1. What is recorded

| Category      | Examples                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session`     | `session_start`, `dashboard_opened`, `dashboard_closed` (wall time, active time, idle time)                                                                                                                                                                                                                                                                                                                                                                                                             |
| `user_action` | `booking_started`, `booking_created`, `booking_cancelled`, `slot_double_clicked` (success **and** every rejection reason), `instructor_added`, `instructor_removed`, `instructor_schedule_toggled`, `booking_override_started`, `booking_submitted`, `booking_slot_removed`, `booking_add_another_class`, `bulk_add_opened`, `bulk_add_result`, `instructor_searched`, `sort_changed`, `date_changed`, `month_changed`, `location_searched`, `location_cleared`, `dashboard_reset`, `tentative_deleted` |
| `api`         | `app_settings.fetch_booking_flow`, `instructor.fetch_index`, `instructor.fetch_roster`, `schedule.fetch_window`, `schedule.insert_tentative`, `schedule.override_tentative_slot`, `schedule.delete_tentative`, `schedule.check_instructor_availability` — each with HTTP method, status and duration                                                                                                                                                                                                    |
| `error`       | `uncaught_error`, `unhandled_rejection`, `booking_failed`, `booking_validation_failed`, plus the error code/message of every failed API call                                                                                                                                                                                                                                                                                                                                                            |

Each row also carries: `session_id` (a browser tab), `user_id` /
`auth_user_id` / `user_name` / `user_role`, `instructor_id`, `slot_date`,
`slot_start`, `slot_end`, `booking_id`, `error_code`, `error_message`, and a
`device` object (browser, OS, mobile flag, screen size, language, IANA
timezone — never a user agent string, an IP, or a geolocation).

## 2. The customer name IS recorded — phone and address are not

Booking events carry the customer in **`props.customer_name`** (the existing
JSONB column — no schema change, no extra migration to apply), so a row answers
"which customer booked what, and which member of staff handled it":

| Event                                                                                 | `props.customer_name` is                                                                                                           |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `booking_started`, `booking_class_added`, `booking_slot_removed`                      | the customer already chosen for that batch — **null** for a brand-new customer, whose name does not exist until the form is filled |
| `booking_submitted`, `booking_written`, `booking_failed`, `booking_validation_failed` | whatever was typed at submit (a validation failure on the name field still records what was typed; empty is `null`)                |
| `booking_created`                                                                     | the booking's customer, repeated on every slot row of a multi-class booking so no join is needed                                   |
| `booking_cancelled`                                                                   | whatever was typed before the modal was closed                                                                                     |
| `booking_override_started`, `tentative_deleted`                                       | the name from the existing hold being overridden or deleted                                                                        |
| `bulk_add_opened`                                                                     | the customer the batch is being built for                                                                                          |

The redactor strips any key matching `customer|phone|address` from the event's
`details`, so the name is merged into `props` **after** redaction, in
`buildProps()` — a name passed inside `details` would never survive. It is
trimmed and capped at 80 characters, and absent (not `null`) on events with no
customer.

It is deliberately **not** a column. A column that exists only in a
manual-apply migration is a trap: PostgREST rejects a whole batch (`PGRST204`)
if one key has no column, the app swallows that error, and logging silently
stops for everyone. Keep every `LogRow` key a real column of the original
table, and put new per-event data in `props`.

Why the name is acceptable: it is already stored in `Schedule.tentative_details`
and `Learner`, and this table is **insert-only for the browser with no client
read policy** — the only readers are the service role and the SQL editor, i.e.
exactly the people who can already read the customer tables. Phone and address
are still excluded: they add nothing to a usage question, and they are the
fields most likely to end up in an exported CSV.

**Consequence:** these rows are customer data. Purge them when monitoring is
switched off (see §7) rather than leaving them behind.

## 3. What is deliberately NOT recorded

- Customer phone numbers, addresses, and any other learner detail.
- The text of an instructor search or a location/place label — a place label
  can literally be a customer's home address. Only its **length** and whether
  coordinates were returned are recorded.
- Passwords, tokens, API keys, cookies, OTPs, card numbers, auth headers.
- Request/response payloads for any call.
- User agent strings, IP addresses, GPS coordinates of the user.

`props` is passed through a redactor before it is written: any key matching
`pass|token|secret|auth|apikey|bearer|cookie|otp|pin|cvv|card` or
`phone|email|address|customer|learner|contact|note` is replaced with
`[redacted]`, strings are truncated to 120 characters, arrays to 20 items, and
nesting to 3 levels.

## 4. How it works

- **One module owns everything**: `src/lib/sales-dashboard/tempMonitoring.ts`.
  Components call `trackEvent` / `measureApi`; nothing else imports Supabase.
- **Non-blocking by construction.** Rows are queued in memory and written in
  batches (15 rows, or 4 seconds after the _first_ pending row — a max-wait,
  not a debounce, so a user clicking steadily cannot hold rows back) plus on
  tab-hide, page-hide and unmount. Every call site is fire-and-forget: no
  `await` on the booking path, no try/catch requirement at the call site, no
  error surfaced to the dashboard. `measureApi` wraps an **existing** promise
  and returns its result unchanged — it cannot change what a query does.
- **The last flush of a session survives navigation.** The browser cancels
  in-flight requests when a document unloads, which silently cost the tail of
  every session (including `dashboard_closed`, i.e. the wall/active time
  figures). The unload-path flush therefore sends with `keepalive: true`;
  postgrest-js does not expose that, so `fetch` is wrapped for that single call
  and restored immediately afterwards.
- **Fails quiet, and fails off.** If the table does not exist, two "relation
  does not exist" responses disable logging for the rest of the page load, so
  no dashboard request ever waits on monitoring.
- **Kill switch.** `localStorage.sales_dashboard_monitoring_off = "1"` disables
  everything immediately, in any live browser, with no redeploy.
- **Session identity** is `sessionStorage`-scoped: a reload continues the same
  session, a new tab starts a new one. Rows queued before identity resolves are
  stamped at flush time, so an early `session_start` is not left anonymous. If
  `useCurrentAdmin()`/`useCurrentUser()` never resolve (Go service down), the
  Supabase Auth uid is still recorded via `auth_user_id`.
- **Idle time is not counted as usage.** A gap longer than 5 minutes between
  events is excluded from `active_ms`, so a tab left open overnight does not
  read as a working session.

## 5. Reading the data

The table has **no client read policy on purpose**. Use the service role from
a machine, or the SQL editor:

```bash
node scripts/sales-dashboard-report.mjs                 # last 7 days
node scripts/sales-dashboard-report.mjs --days 30
node scripts/sales-dashboard-report.mjs --since 2026-10-01
node scripts/sales-dashboard-report.mjs --json report.json
node scripts/sales-dashboard-report.mjs --export report.csv
```

The report answers, in order: who used it and for how long; bookings and
classes per user with a failure rate; **customers booked (classes, submits,
failures, and which staff member handled each)**; most-booked instructors;
most-used time slots; API health (calls, failures, average and max duration,
status codes); grouped errors; the full event mix; activity by hour and by
weekday.

Useful raw SQL:

```sql
-- Which customer booked the most, and who handled it.
SELECT props->>'customer_name' AS customer_name,
       count(*) FILTER (WHERE event_name = 'booking_created') AS classes,
       count(DISTINCT user_name)                    AS staff_handling,
       count(DISTINCT session_id)                   AS sessions
FROM sales_dashboard_temporary_logs
WHERE props->>'customer_name' IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;

-- Everything one customer did, in order (phone/address never appear).
SELECT ts, event_name, slot_date, slot_start, user_name AS staff
FROM sales_dashboard_temporary_logs
WHERE props->>'customer_name' = 'Ravi Kumar'
ORDER BY ts;

-- Customers who tried repeatedly and failed -- needs a follow-up call.
SELECT props->>'customer_name' AS customer_name,
       count(*) FILTER (WHERE event_name = 'booking_failed') AS failures,
       count(*) FILTER (WHERE event_name = 'booking_created') AS classes
FROM sales_dashboard_temporary_logs
WHERE props->>'customer_name' IS NOT NULL
GROUP BY 1
HAVING count(*) FILTER (WHERE event_name = 'booking_failed') > 0
ORDER BY 2 DESC, 3 DESC;

-- Time actually spent on the screen, per user.
SELECT user_name, user_id,
       count(DISTINCT session_id)                       AS sessions,
       sum((props->>'wall_ms')::numeric) / 3600000.0    AS wall_hours,
       sum((props->>'active_ms')::numeric) / 3600000.0   AS active_hours
FROM sales_dashboard_temporary_logs
WHERE event_name = 'dashboard_closed'
GROUP BY 1, 2 ORDER BY active_hours DESC;

-- Why bookings were rejected (the "users are stuck here" list).
SELECT error_message AS reason, count(*) AS n
FROM sales_dashboard_temporary_logs
WHERE category = 'user_action' AND success = false
GROUP BY 1 ORDER BY n DESC;

-- Success rate of the booking funnel.
SELECT event_name, count(*) FILTER (WHERE success) AS ok,
       count(*) FILTER (WHERE success = false) AS failed
FROM sales_dashboard_temporary_logs
WHERE event_name IN ('booking_started', 'booking_submitted',
                     'booking_written', 'booking_created')
GROUP BY 1;

-- Slowest API calls.
SELECT api_name, count(*) AS calls, avg(duration_ms) AS avg_ms,
       max(duration_ms) AS max_ms
FROM sales_dashboard_temporary_logs
WHERE category = 'api'
GROUP BY 1 ORDER BY avg_ms DESC;
```

## 6. Retention and cleanup

Default retention is 90 days. To purge older rows:

```sql
SELECT public.purge_sales_dashboard_temporary_logs(30);   -- keep 30 days
```

## 7. Removing this system

1. Delete `src/lib/sales-dashboard/tempMonitoring.ts`.
2. In `src/routes/admin/SalesDashboard.tsx`,
   `src/components/admin/sales-dashboard/TentativeBookingModal.tsx` and
   `src/hooks/useSalesData.ts`, remove every import from `tempMonitoring` and
   every `trackEvent` / `measureApi` / `reportMonitoringError` /
   `setMonitorIdentity` / `startMonitoringSession` call, then unwrap any
   `measureApi(...)` call back to the plain `await query`.
3. Delete `scripts/sales-dashboard-report.mjs` and this file.
4. Drop the table:

```sql
DROP TABLE IF EXISTS public.sales_dashboard_temporary_logs;
DROP FUNCTION IF EXISTS public.purge_sales_dashboard_temporary_logs(integer);
```

5. Confirm nothing is left:

```bash
grep -rn "tempMonitoring\|sales_dashboard_temporary_logs\|sales_dashboard_monitoring_off" src scripts supabase
```

Expected: no hits.

`database.types.ts` was intentionally never given an entry for this table, so
there is nothing to remove there.

## 8. Verification performed

- `npx pnpm run build` — passes.
- `npx eslint` on every touched file — no errors.
- `tests/playwright/temp-monitoring.spec.ts` (runs against a production build
  with the real anon key, intercepting only the log POST):
  - rows are emitted, batched, and shaped exactly as the migration expects;
  - `session_start`, `dashboard_opened`, roster changes, date/month changes and
    API timings all appear;
  - every row is attributable to an authenticated user;
  - `props.customer_name` is present and populated on a booking event, no row
    has a top-level `customer_name` key (a non-column key makes PostgREST reject
    the whole batch), and **no phone or address ever reaches the payload**;
  - the dashboard renders and works normally while the log table does not
    exist, and again while the kill switch is on (zero writes);
  - no uncaught frontend errors.
- `node tests/bulk-add-schedules-e2e.mjs` — 21/21, unaffected.
- Applied `20261002_000000_sales_dashboard_temporary_logs.sql` by hand, then
  verified against the live table: an authenticated browser session's rows
  persist, `dashboard_closed` survives navigation (keepalive flush), the anon
  key reads 0 rows (no SELECT policy), and
  `purge_sales_dashboard_temporary_logs(0)` is rejected by the `>= 1` guard.
