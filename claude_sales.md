# claude_sales.md

Working context for the **Sales Availability Dashboard** (`/admin/sales-dashboard`).
Read this before touching any file listed under "Where things live". General
repo guidance is in `AGENTS.md` / `CLAUDE.md`; cross-module changes are logged
in `OtherModule.md`; the test checklist is `tests.md`.

Last updated: 2026-10-15.

## What it is

A live instructor availability grid (30-minute columns, one row per instructor).
Sales agents search instructors by name or location, read free/busy slots, and
create **tentative holds only**. Operations verifies the customer and converts
valid holds to confirmed bookings separately. The dashboard never creates a
confirmed class.

## Where things live

| Piece                                       | Path                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| Page, grid, popovers, help modal            | `src/routes/admin/SalesDashboard.tsx`                                     |
| Data/state hook                             | `src/hooks/useSalesData.ts`                                               |
| Availability engine (pure TS)               | `src/lib/sales-dashboard/availability.ts`                                 |
| Slot-conflict classifier                    | `src/lib/sales-dashboard/conflict.ts`                                     |
| Booking form (modal or side-panel variant)  | `src/components/admin/sales-dashboard/TentativeBookingModal.tsx`          |
| Location search (lazy) / address search     | `LocationSearch.tsx`, `AddressAutocomplete.tsx` (same folder)             |
| Zone reads, company-instructor guard        | `zones-db.ts`, `company-instructors.ts`                                   |
| Config, retry/cache, validation, hours      | `config.ts`, `resilience.ts`, `validation.ts`, `workingHours.ts`          |
| Bulk slot generation                        | `bulkSlots.ts` (`single` / `daily` / `hourly`)                            |
| Styles and color tokens                     | `src/components/admin/sales-dashboard/sales-dashboard.css`                |
| Standalone demo (update with grid changes)  | `mock.html`                                                               |
| Prod DB migration record                    | `SALES_DASHBOARD_DB_MIGRATION.md`                                         |

## Data layer

- **Startup** loads only the `app_settings` row (`key='booking_flow'`) and a
  light instructor index (`id, name, status, enabled`). No `Schedule` queries
  on load.
- `loadInstructors(ids)` fetches full `Instructor` rows plus `Schedule` rows on
  demand (1000-row pages, 60 ids per batch).
- **Two grids:** `freeGrid` (60-minute class starts, used to validate bookings)
  and `displayGrid` (30-minute cells, used for rendering).
- **Visible columns** come from `candidateStartMinutes()` over the configured
  `slot_start`..`slot_end` (live: 06:00-22:00, so the last column is 21:00).
  They are not a full 24-hour day. The weekly timetable (Schedule panel) shows
  hours 05:00-22:00 and labels the rest "Outside business hours".
- **Free/busy** is decided by `Instructor.unavailability` plus real `Schedule`
  rows via `buildInstructorFreeGrid` / `buildDisplayFreeGrid`, not by a separate
  business-hours rule.
- Realtime `postgres_changes` on `Schedule` (1.5 s debounce, catch-up after a
  tab was hidden 60 s), 20 s fetch timeout, retry + stale-cache fallback.
- Fails **closed** if `booking_flow` is missing or incomplete.

### `booking_flow` config (live values)

`slot_start 06:00`, `slot_end 22:00`, `slot_grid_minutes 30`,
`slot_duration_minutes 60`, `instructor_gap_minutes 15`, `view_days_ahead 400`,
`booking_days_ahead 14`, `excluded_schedule_statuses [cancelled, rejected]`.
This row is shared with the learner-facing direct-booking feature, so do not
widen the hours to change the display.

## Grid colors (authoritative)

| Cell                  | Meaning                                                                            | Class                   |
| --------------------- | ---------------------------------------------------------------------------------- | ----------------------- |
| White                 | **Free** and bookable. White means free and nothing else.                          | `.cell-free`            |
| Hatched               | Free but not bookable as a full hour (adjacent slot taken)                         | `.cell-half`            |
| Yellow                | Tentative hold (unpaid / half / full paid look the same)                           | `.cell-tentative`       |
| Purple                | Booked, completed, or a real learner booking mid-payment (`pending_payment`)       | `.cell-booked`          |
| Blue                  | Already added to the in-progress multi-class batch                                 | `.cell-pending`         |
| Grey hatched          | Free, but overlaps a class already in the batch; not selectable                    | `.cell-pending-blocked` |
| Grey                  | Everything else non-free: unavailable, paused, travel-gap buffer, outside hours    | `.cell-band`            |

The weekly timetable uses the same idea through `ttHalfFill()`: free is
transparent, every non-free half-hour is `#c0c0c1`.

## Booking flow (current behaviour)

- **Single click** selects a slot. A free slot opens the booking form in the
  right-hand slot panel; a taken slot shows its details there. This replaced
  the older double-click flow, and `validateOneHourBlock()` still checks that
  both 30-minute halves are free.
- **Multi-class batch:** state (`pendingSlots`, `customerFormData`) lives in
  `SalesDashboard`, not the modal, because the form must hide, not unmount,
  while the next class is picked. "+ Add another class" arms picking mode;
  overlaps are greyed out. Submit is all-or-nothing: every slot is re-validated
  fresh (`validateSlotFresh`), then one multi-row `.insert([...])` lets the
  `schedule_no_overlap_new_rows` exclusion constraint roll the batch back
  atomically.
- **Edit rules:** the creator can edit a tentative slot at any payment status;
  anyone can edit an unpaid one; only the creator can delete; paid slots made
  by someone else are protected. **Override Slot was removed** in commit
  `0ee5943` (2026-10-09), so the older override RPC notes in `CLAUDE.md` are
  historical.
- Every created row is `isTentative: true`, `status: "hold"`, with
  `learner_id/course_id/lesson_id` null and customer data in
  `tentative_details`.
- Phone display respects `view_unmasked_phone_numbers`; the form can autofill
  from the CRM (`CrmLeadAutofill`) and uses `normalizePhone()`.
- **Never rely on implicit form submission.** The modal can be nested in
  another `<form>`; submit goes through an explicit `onClick` path. Implicit
  submission once caused double inserts and the 23P01 "already booked" flake.

## Location matching

- Source is **polygon only**: `instructor_service_zones`, one row per
  instructor, matched by `instructor_id` via `zones-db.ts` and
  `SalesDashboard.locMatch` (`pointInPolygon`). The 3 km proximity fallback is
  intentionally dead. `public/instructors.kml` is backfill input only.
- `is_rough` polygons are provisional and excluded from all matching.
- **Company instructors** (Amanulla Khan, Krupakar Daniel Dennish) are
  Ops-assigned backups and are never auto-matched. Authoritative flag is
  `Instructor.is_company_instructor`, with a name-list fallback.
- On-break instructors are hidden from the default roster but appear with real
  slots when a location search matches them.
- Playwright fixtures that must stay: `Ankit_ins_test` (only live rough row)
  and `test_dp` (verified, must stay `is_rough = false`).

## Cross-module rules

- Any code that writes `isTentative: true` must also write `status: "hold"`.
  The column default is `"booked"`, which shows as purple here instead of
  yellow. About 1,411 older mislabeled rows were deliberately left alone
  (`OtherModule.md`).
- Instructor Management reverse-syncs `Schedule` changes via realtime
  (replication enabled; `REPLICA IDENTITY FULL` proposed in
  `REALTIME_DELETE_REPLICA_IDENTITY.md`).

## Terminology

**Slot states:** free, half-free (hatched), tentative, booked, pending (batch),
pending-blocked, buffer (travel gap), unavailable, paused, outside business
hours.

**Components:** `SalesDashboard` -> `InstructorRowGroup` -> `SlotCell` (main
grid cell); weekly timetable panel (`WeekTimetable`); right-hand slot panel;
`TentativeBookingModal` (`"modal"` or `"panel"` variant); `LocationSearch`;
`AddressAutocomplete`; topbar legend, footer legend, help modal.

**Data:** `freeGrid` vs `displayGrid`; `blocks` / `blockDetails` /
`blocksIndex`; `SlotPick` (one class in a batch); `CustomerFormValues`;
`SlotConflict` (`free` | `direct` | `buffer`; buffer is waivable only for the
same customer's sales-tentative holds); `BulkType`; `NO_COURSE`;
`addingSlotMode`.

**Zones:** verified vs rough polygon, company instructor, `locMatch`, KML
(legacy).

## Change log

### 2026-10-15 - unavailable cells rendered white on alternating hours

**Symptom:** For "Prabhavathy Sadesh kumar" (unavailable 00:00-18:00 daily,
00:01-19:00 from 2026-10-09, Sundays off), cells such as 16:00-17:00 showed
white, the same as a free slot.

**Cause:** `0ee5943` (2026-10-09) made free cells white and repurposed
`--gc-band-bg` as the grey busy tone, but the code still applied `cell-band`
only when `Math.floor(ti / 2) % 2 === 1` (a zebra stripe from 2026-09-18). With
columns starting at 06:00, even hours (06, 08, ... 18, 20) got no class. The
`cell-paused` / `cell-unavailable` styles never helped because the only
`expandedCalendar` call was removed in the same commit. The footer "Busy /
other" swatch was also white.

**Fix:** `SlotCellInner` now applies `cell-band` to every non-free cell that is
not tentative / booked / pending; the `band` prop and parity calculation are
gone; `.swatch.busy` uses `--gc-band-bg`; help text updated.

**Verified:** ran the real `availability.ts` on her live row for 2026-10-16..18:
40 of 81 non-free cells were white under the old rule, 0 under the new one.
Lint output is unchanged from baseline. Not yet checked visually in a browser.

**Known leftovers:** the `expandedCalendar` branch and `.cell-paused` /
`.cell-unavailable` / `.swatch.paused` / `.swatch.unavailable` styles are dead
code. In dark mode `--gc-slot-free-fill` is not overridden, so free cells stay
white there.

## Gotchas

- **Quote string-literal keys** in object literals. `edit` can match fuzzily and
  strip quotes (this broke `KML_ALIASES` once). Always `git diff` afterwards.
- `useSalesData` must not select `Instructor.gender`; production has no such
  column and PostgREST rejects the whole query (HTTP 400).
- Before assuming a display bug, re-query the actual `Schedule` row. Several
  tester reports turned out to be data that had changed.
- Write tests against `instructor_service_zones` must intercept the request;
  the anon key cannot undo its own writes.
- Verification order: `pnpm run lint` -> `pnpm run type-check` -> `pnpm run
  build`. `type-check` currently fails in unrelated files (`schedule.tsx`,
  `startLesson.tsx`, `types/schedule.ts`).
- Known security issue (pre-existing): the real `VITE_SUPABASE_SERVICE_ROLE_KEY`
  is read via `import.meta.env` in `auth-context.tsx`, so it is bundled into
  client JS.

## How to update this file

Add a dated entry under "Change log" for each fix or behaviour change (symptom,
cause, fix, how it was verified). Update "Booking flow", "Grid colors" and
"Terminology" in place when they change, so the top of the file always matches
the code.
