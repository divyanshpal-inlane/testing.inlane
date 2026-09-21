# Sales Dashboard — Testing DB → Production DB

> **Status: migration complete.** `.env` points at production
> (`csnzgfzxnscumvjefpon`), the `booking_flow` row exists there, and the full
> E2E suite passes against it. This doc is kept as a record of what was done
> and as the rollback/reference procedure — see
> [Completed migration log](#completed-migration-log) at the bottom.

Context for the "Couldn't load availability: booking_flow configuration is
missing or incomplete" error, what was done about it, and the exact steps
taken to move this feature onto the real production database.

## Problem

The Sales Availability Dashboard (`/admin/sales-dashboard`) reads a config
row from `app_settings` (`key = 'booking_flow'`) on every page load. If that
row is missing or incomplete, the dashboard **fails closed** — it shows a
clear error instead of guessing or showing wrong data:

```
Couldn't load availability: booking_flow configuration is missing or
incomplete in app_settings (enabled:false).
```

Two separate Supabase projects are involved in this app's history:

|                | Project ref            | Used by                                                                            |
| -------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| **Production** | `csnzgfzxnscumvjefpon` | `inlane-web-app` has always pointed here (real learners, instructors, schedules)   |
| **Testing**    | `rcfztyzmokacinuhnuih` | Used while building/testing the standalone `Lane-sales-requirement` dashboard repo |

The `app_settings.booking_flow` row already exists (complete) in **Testing**,
because it was set up there during that dashboard's own development. It has
never existed in **Production** — nothing in the main app needed it before
this integration.

A second, related issue was found and fixed in code during integration: the
dashboard's engine originally queried `Instructor.gender` (for a
female-instructor-preference feature this dashboard doesn't even expose in
its UI). **Production's `Instructor` table has no `gender` column**, so that
query was rejected outright (HTTP 400), silently breaking every
"add instructor" action. Testing DB likely has this column (or the code
never hit the missing-column path there). This was fixed by dropping
`gender` from the query — see [Schema compatibility](#schema-compatibility-verified)
below; this is **not** something that needs a production DB change.

## Current state (as of this doc)

Local `.env` (`inlane-web-app/.env`, gitignored — never committed, never
deployed) is temporarily pointed at **Testing**:

```
VITE_SUPABASE_URL=https://rcfztyzmokacinuhnuih.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_u-ZtVTMV2FPmcxsdLzCxUg_Ry7UH7Yi
```

- This is **local-only**. It does not touch Vercel's production deployment
  (Vercel uses its own env vars set in its dashboard, not this file), and it
  doesn't affect any other developer's machine.
- Original production values are backed up at
  `/tmp/inlane-web-app.env.production-backup` (outside the repo, so it can
  never accidentally get committed).
- `VITE_SUPABASE_SERVICE_ROLE_KEY` in `.env` still holds the **production**
  service-role key — it has not been swapped, because the testing project's
  service-role key wasn't available. This means any feature that uses
  `supabaseAdmin` (e.g. some admin/user-creation flows in `auth-context.tsx`)
  will fail while `.env` points at Testing, since that key won't
  authenticate against a different project. This only matters for local dev
  right now — restore `.env` before doing anything that needs
  `supabaseAdmin`.
- Login worked with the same test credentials against both projects purely
  by coincidence (that phone/password happens to exist as a user in both
  Supabase projects' auth). This will not generally be true for other
  accounts.

## Schema compatibility (verified)

Every column the dashboard's Supabase queries select was checked
column-by-column against **Production**'s actual schema (via the service-role
key, read-only):

| Table                            | Columns the dashboard selects                                                                                                          | Present in Production?                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Instructor`                     | `id_instructor, name, areas, unavailability, status, enabled`                                                                          | ✅ all present                                                                    |
| `Instructor` (original, pre-fix) | ...`gender`                                                                                                                            | ❌ **not present** — removed from the query, see above                            |
| `Schedule`                       | `id, instructor_id, date, start_time, end_time, status, learner_id, course_id, leadName, tentative_details, pause_reason, pause_notes` | ✅ all present                                                                    |
| `Learner`                        | `id, name, area`                                                                                                                       | ✅ all present                                                                    |
| `Courses`                        | `id, name`                                                                                                                             | ✅ all present                                                                    |
| `app_settings`                   | `key, value`                                                                                                                           | ✅ table exists; the `booking_flow` **row** does not exist yet (data, not schema) |

**Conclusion: no production schema/migration is required.** The only gap is
a missing _data row_, not a missing _column or table_.

## Migration checklist: Testing → Production

Do these in order when it's time to make this feature live against the real
database:

### 1. Insert the `booking_flow` config row in Production

This is the row that was inserted and then deleted for E2E testing earlier
(deleted afterward so the shared flag wasn't left flipped for the sibling
direct-booking feature). Confirm with whoever owns the direct-booking
feature before inserting for real, since `enabled: true` also turns that
feature on:

```sql
INSERT INTO app_settings (key, value) VALUES (
  'booking_flow',
  '{
    "enabled": true,
    "gateway": "razorpay",
    "hold_minutes": 15,
    "max_slots_per_booking": 12,
    "booking_days_ahead": 14,
    "slot_start": "06:00",
    "slot_end": "22:00",
    "slot_grid_minutes": 30,
    "slot_duration_minutes": 60,
    "instructor_gap_minutes": 15,
    "view_days_ahead": 400,
    "excluded_schedule_statuses": ["cancelled", "rejected"],
    "female_instructor_mode": "off",
    "installment_modes": ["full"]
  }'::jsonb
);
```

Adjust `slot_start`/`slot_end`/`slot_grid_minutes`/`instructor_gap_minutes`
if the real desired working hours/grid differ — these are the only fields
this dashboard actually reads (see next section). `gateway`,
`hold_minutes`, `max_slots_per_booking`, `female_instructor_mode`,
`installment_modes` only matter to the _other_ (direct-booking) feature —
any valid placeholder value satisfies this dashboard's completeness check
without affecting it.

**Fields this dashboard actually uses:** `enabled`, `slot_start`, `slot_end`,
`slot_grid_minutes`, `slot_duration_minutes`, `instructor_gap_minutes`,
`view_days_ahead`, `excluded_schedule_statuses`.
**Fields it ignores** (only required to satisfy the shared validator):
`gateway`, `hold_minutes`, `max_slots_per_booking`, `female_instructor_mode`,
`installment_modes`.

### 2. Grant the `sales_dashboard` permission to real admin accounts

The card is permission-gated. Nobody in Production has this permission yet
(it's new). Either use the User Management UI to check the box for the
relevant admins/team members, or insert directly:

```sql
INSERT INTO user_permissions (user_id, permission)
VALUES ('<user-id>', 'sales_dashboard');
-- or for Admin-table accounts:
INSERT INTO admin_permissions (admin_id, permission)
VALUES ('<admin-id>', 'sales_dashboard');
```

### 3. Verify `public/instructors.kml` zone names resolve against Production instructor names

The KML file was copied as-is from the testing dashboard repo. Its
placemark names are matched against `Instructor.name` (with a small
`KML_ALIASES` map in `src/lib/sales-dashboard/kml.ts` for known spelling
variants). If Production's instructor roster differs from whatever roster
the KML was built against, location search may under-match. Spot-check a
few real Production instructor names against the KML placemarks; add
aliases in `KML_ALIASES` as needed.

### 4. Switch `.env` back to Production

```
VITE_SUPABASE_URL=https://csnzgfzxnscumvjefpon.supabase.co
VITE_SUPABASE_ANON_KEY=<see /tmp/inlane-web-app.env.production-backup>
```

Or just restore the whole file: copy
`/tmp/inlane-web-app.env.production-backup` back over `.env`.

### 5. Restart the dev server / rebuild

`.env` changes require a Vite restart (`pnpm dev`) or fresh build
(`pnpm build`) to take effect — they're baked in at build/start time, not
read live.

## Rollback (if something looks wrong after switching to Production)

Delete the `booking_flow` row to return to the fail-closed state instead of
serving possibly-wrong data:

```sql
DELETE FROM app_settings WHERE key = 'booking_flow';
```

This immediately disables both this dashboard and the direct-booking
feature again (same shared flag), with no other side effects — it's a pure
data row, not a migration.

## Completed migration log

What actually happened, for the record:

1. **`booking_flow` row inserted into production** — run manually via
   Supabase's SQL Editor (Claude Code's own safety system blocked doing this
   programmatically, correctly treating it as a hard-to-reverse production
   write). Verified present and complete via read-only check afterward.
2. **`sales_dashboard` permission** — was already granted to the test
   account (`user_id 2914b4fb-...`) during earlier testing; nothing further
   needed for that account. **Other admins/team members who should see this
   feature still need the permission granted** (User Management UI, or the
   `INSERT INTO user_permissions ...` pattern above) — this was only ever
   done for one test account.
3. **KML coverage check** — production currently has **30 active
   instructors**; the KML file has **84 placemark names**, of which only
   **~25 resolve** to a real active production instructor via
   `KML_ALIASES`/name normalization. Location search will under-match for
   instructors not covered by those 25. Not a blocker, but worth someone
   updating `public/instructors.kml` (or `KML_ALIASES` in
   `src/lib/sales-dashboard/kml.ts`) against the current live roster if
   better location-search coverage is wanted.
4. **`.env` restored to production** (`csnzgfzxnscumvjefpon`) from the
   backup taken before testing began. Dev server restarted with a clean Vite
   cache.
5. **Verified**: full E2E pass against production (login, permission-gated
   card, route load, search/add/compare, slot popovers with real production
   data, location search, help modal, date nav, refresh, no regression on
   `/admin/instructor-matrix`).

**Loose end**: the local production-env backup this migration used lives
outside the repo at `/tmp/inlane-web-app.env.production-backup` — safe to
delete once you're confident `.env` is correct.
