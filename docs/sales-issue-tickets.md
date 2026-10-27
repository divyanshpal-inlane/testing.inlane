# Sales Issue Reporting & Tickets

Sales staff report an issue (customer phone + optional description). The ticket is
saved first, then `support@inlane.in` is e-mailed. Support works tickets on
**Admin → Escalate Issue Tracker**.

## Pieces

| Piece | Location |
| --- | --- |
| Table, RLS, helper | `supabase/migrations/20261025000000_create_sales_issue_tickets.sql` (**manual apply**) |
| Server logic (create / retry / status) | edge function `supabase/functions/sales-issue-tickets` + `_shared/sales-issue-tickets.ts` |
| Report form | `/admin/report-sales-issue` → `src/routes/admin/ReportSalesIssue.tsx` |
| Ticket dashboard | `/admin/sales-issue-tickets` → `src/routes/admin/SalesIssueTickets.tsx` |
| Queries / filters | `src/queries/salesIssueTickets.ts`, `src/lib/sales-issue-tickets/` |
| Tests | `node --test tests/sales-issue-tickets.test.mjs` |

## Permissions (Admin Management / User Management)

- **Escalate an Issue** needs NO permission: every logged-in staff account (Admin or team member) can raise tickets.
- **Escalate Issue Tracker** (`sales_issue_tickets`) is a normal, customisable permission: tick it for any
  admin or user in Admin Management / User Management. Holders see the list, counts, status changes and can retry
  e-mails; super admins always have it. Nobody is hardcoded by role. Phone numbers are masked unless the account also has
  "View Unmasked Customer Phone Numbers".

## Security model

- The browser has **SELECT only** (RLS: `current_staff_has_permission('sales_issue_tickets')`).
  There is no INSERT/UPDATE/DELETE policy or grant for `authenticated`.
- Creating, retrying and status changes go through the edge function (service role).
  It verifies the JWT, resolves the caller from `Admin` / `User`, checks the permission,
  and sets `raised_by` / `raised_by_email` / `raised_by_name` itself. Nothing about the
  creator is read from the request body.
- Phone and description are re-validated server-side; DB CHECK constraints back them up.

## Ticket IDs and duplicates

- `ticket_number` = `SIT-000001`… from a sequence (default on the column) with a UNIQUE constraint.
- The form sends a `requestId` (UUID) per distinct submission; `client_request_id` is UNIQUE, so
  a double click / network retry returns the existing ticket and never e-mails twice. The submit
  button is disabled while a request is in flight.

## E-mail

- Sent over the existing Gmail SMTP setup (same as `send-admin-email`), **from the configured
  verified sender** (`SMTP_FROM`). The raiser's e-mail is only ever `Reply-To` (never spoofed),
  and only when their account has one (phone-login team members usually don't).
- Subject: `[Sales Support Ticket] <ticket> — <phone>`; HTML body + plain-text fallback.
- Ticket is saved **before** sending. Result is stored in `notification_status`
  (`pending` → `sent` | `failed`) with a sanitised `notification_error` (secrets redacted, 300 chars).
- **Retry**: "Retry notification" (success screen, ticket details). Atomic claim: only a `failed`
  (or `pending` for > 2 min) ticket can be retried, so a `sent` ticket is never e-mailed again
  and concurrent retries can't double-send.

## Date presets (viewer's local calendar days; "today" is day 1)

| Preset | Range |
| --- | --- |
| Today / Last 1 Day | today |
| Last 15 Days | today + preceding 14 days |
| Last 30 Days | today + preceding 29 days |
| Last 1 Month | same calendar date one month ago → today (31 Mar → 28 Feb) |
| Custom | start..end, both days inclusive; start must be ≤ end |
| All Dates | no bound |

Filters (date, status, ticket-ID/phone search) run in the database query with `count: exact`
pagination (20 per page), newest first.

## Deploy checklist

1. Apply the migration in the Supabase SQL editor.
2. `supabase functions deploy sales-issue-tickets`.
3. Secrets (already set if other e-mail functions work): `MY_SUPABASE_URL`,
   `MY_SUPABASE_SERVICE_ROLE_KEY`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`.
   Optional: `SUPPORT_EMAIL` (default `support@inlane.in`).
4. Tick **Escalate Issue Tracker** for the people who should work the tickets (reporting is open to all).

## Not verified here

The migration was not run against a database, and the edge function was not deployed or
sent a real e-mail. Run the checklist above, then raise a test ticket and confirm: row created,
e-mail received at `support@inlane.in`, RLS blocks a user without the permission.

## Phone masking

Customer phone numbers follow the same rule as Learner Management, Instructor Management and the
Sales Dashboard: real number only for super admins and staff with
`view_unmasked_customer_phone_numbers`; everyone else sees `XXXXXXXXX` + last two digits.
Enforced server-side — the list reads `sales_issue_tickets_view` (migration
`20261025000100_sales_issue_tickets_phone_masking.sql`, which also revokes direct SELECT on the
table), and the edge function masks the ticket it returns. Phone search on the view only matches
what the viewer can see. The e-mail to Support still carries the full number (needed to act on it).

## Analytics (Escalate Issue Tracker page)

A row of live counts above the table, computed in Postgres by `sales_issue_ticket_stats()`
(migration `20261025000200_sales_issue_ticket_stats.sql`, manual apply) over the **same date range and
search** as the table. It refreshes after every status change / new ticket and re-polls every minute.
Cards: Total, To Do, In Progress, Resolved (with % resolved), Open (To Do + In Progress), Raised today,
Avg. time to resolve, Oldest open, E-mail not sent. Clicking Total / To Do / In Progress / Resolved filters the table.
Note: Supabase's API layer rejects `DELETE` without `WHERE` — keep that in mind when editing the function.
