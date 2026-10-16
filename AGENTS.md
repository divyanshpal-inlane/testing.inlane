# AGENTS.md — InLane Web App

Compact reference for agents working in this repo. Only non-obvious, high-signal facts.

## Commands

| Task                                                 | Command                |
| ---------------------------------------------------- | ---------------------- |
| Install                                              | `pnpm install`         |
| Dev server (proxies `/go-api` → `localhost:8080/v1`) | `pnpm run dev`         |
| Build                                                | `pnpm run build`       |
| Preview build                                        | `pnpm run serve`       |
| Lint + format                                        | `pnpm run lint`        |
| Format only                                          | `pnpm run lint:format` |
| ESLint only                                          | `pnpm run lint:fix`    |
| Type check                                           | `pnpm run type-check`  |

**Required order**: `lint` → `type-check` → `build` (CI runs these)

## Environment

- `.env` from `.env.example` — needs `VITE_SUPABASE_KEY` (anon key)
- **Dev**: Vite proxy rewrites `/go-api` → `http://localhost:8080/v1` and `/go-api/internal` → `http://localhost:8080/internal` (see `vite.config.ts:14-32`)
- **Prod**: `VITE_BACKEND_API` sets real Go service URL (e.g., `https://api.inlane.in/v1`); no proxy
- Env vars baked at build time — redeploy to change

## Architecture Essentials

```
src/
  app/           # Feature pages (instructor, learner flows)
  components/    # Reusable UI (ui/, layout/, lesson/, admin/sales-dashboard/)
  routes/        # Route trees per role: admin/, instructor/, learner/
  context/       # AuthContext, PhoneVisibilityProvider
  hooks/         # Custom React hooks
  queries/       # TanStack Query hooks by domain (instructor.ts, learner.ts, etc.)
  lib/           # supabaseClient, calendarUtils, geoUtils, availability.ts (sales)
  services/      # featureFlagService.ts
  types/         # TypeScript types
  constants/     # App constants (courses.ts has payment completion logic)
  utils/         # Shared utils (normalizePhone, maskPhoneNumber, etc.)
```

**Path alias**: `@/*` → `./src/*` (tsconfig.json + vite.config.ts)

## Routing & Auth

- `<BrowserRouter>` with protected routes: `ProtectedLearnerRoute`, `ProtectedInstructorRoute`, `ProtectedAdminRoute` (in `src/context/auth-context.tsx`)
- Three separate role trees; auth context holds `role` and `user`
- **Dual auth stack**: migrating from Supabase → Go auth (feature-gated via `use_go_auth` flag)
- Go auth endpoints: `/auth/login`, `/auth/signup`, `/auth/otp/*`, `/auth/reset-password`, `/auth/change-password`

## Data Fetching

- TanStack Query v5 in `src/queries/*` (organized by domain)
- Go backend at `VITE_BACKEND_API || "/go-api"` (dev proxy to `http://localhost:8080/v1`)
- Internal endpoints at `/go-api/internal/*` (e.g., feature flags) bypass `/v1` rewrite
- Supabase client in `src/lib/supabaseClient.ts`

## Supabase Edge Functions (40+) — Manual Deploy Only

**No CI/CD** deploys edge functions. After changes:

```bash
supabase functions deploy              # all
supabase functions deploy <name>       # e.g., process-payment
```

Run from up-to-date `main` checkout (bundles from local working dir).

Key functions: `create-razorpay-order`, `verify-razorpay-payment`, `process-payment` (Orange PG), `payment-callback`, `send-message` (WhatsApp), `send-schedule-emails`, `masked-call` (Exotel), `fetch-calendar-events`, `sync-google-calendar`, direct booking (`get-booking-config`, `get-booking-slots`, `create-booking`, `change-booking-slot`, `confirm-booking`).

### Core Function Categories

| Category           | Functions                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Payments**       | `create-razorpay-order`, `verify-razorpay-payment`, `process-payment` (Orange PG v2 HMAC-SHA256), `payment-callback`, `recover-razorpay-payment`               |
| **Messaging**      | `send-message` (WhatsApp dispatcher, 40+ templates), `send-schedule-emails` (ICS), `send-payment-link-email`, `send-admin-email`, `send-course-feedback-email` |
| **Reminders**      | `learner-daily-schedule`, `instructor-daily-schedule`, `send-signup-reminders`, `ll-flow-reminders` (cron)                                                     |
| **User/Auth**      | `create-user`, `create-admin-user`, `delete-user`, `get-current-user`, `password-reset-otp`                                                                    |
| **Calls**          | `masked-call` (Exotel learner↔instructor), `msg91-masked-call` (instructor↔KAM)                                                                                |
| **Calendar**       | `fetch-calendar-events`, `sync-google-calendar`, `remove-google-calendar-sync`                                                                                 |
| **Direct Booking** | `get-booking-config`, `get-booking-slots`, `create-booking`, `change-booking-slot`, `confirm-booking`                                                          |

## Key Gotchas

1. **Vercel deploy author gate**: Only commits authored by Vercel team members trigger deploys. Fix: merge as authorized user, or click **Redeploy** in Vercel dashboard. Details in `DEPLOYMENT.md`.
2. **Go backend must run locally** for dev API calls (`http://localhost:8080`).
3. **Phone normalization inconsistency**: DB stores phones in 4 variants (raw 10-digit, `+91…`, etc.); queries match all formats. Use `normalizePhone()` utility.
4. **Phone visibility**: Masked via `PhoneVisibilityProvider` — check context if adding phone display. Permission: `view_unmasked_phone_numbers`.
5. **Payment completion logic exists in 3 places** — keep in sync: `payment-callback` edge function, `src/constants/courses.ts`, `_shared/complete-payment.ts`.
6. **pnpm strict mode**: New deps with build scripts need entry in `pnpm-workspace.yaml:allowBuilds` or Vercel fails with `ERR_PNPM_IGNORED_BUILDS`.
7. **No-show fee**: ₹300 if rescheduling <10h before; appeals allow waiver/reversal by admin.
8. **Env vars baked at build time**: `VITE_*` injected at build, not runtime — redeploy to change.
9. **Dual auth stack**: Migrating Supabase → Go auth (feature-gated via `use_go_auth`); new flows use Go, fallback to Supabase.
10. **Onboarding is now atomic across three tables** (auth.users → Instructor → instructor_service_zones). No FK exists between them, so atomicity is enforced by a compensating transaction in `OnboardingWizard.tsx`:
    - Auth created first (required for login); phone column pinned explicitly to fix the email-only `signUp` fallback leaving it empty.
    - Instructor insert second; on error → delete auth user.
    - Zone insert third (optional); on error → delete Instructor + auth user.
    - Unmount abort guard: closing the dialog mid-flight unwinds everything.
    - Previously: auth failure carried on (inverse orphan: Instructor with no auth); zone failure warned only (half-written set); phone column empty on email fallback; no unmount guard.
    - Rollback is all-or-nothing: one `unwind()` helper deletes in reverse order (zone via instructor FK cascade → Instructor → auth user).
11. **LocationSearch lazy-loaded**: Separate chunk (~7kB); manual lat/lng inputs work via `Input.insertText` in automation (React 19 value tracker defeats programmatic `.value` sets).
12. **`instructor_service_zones` polygons are the _only_ area source**: the Sales Availability location search loads polygons from Postgres via `src/lib/sales-dashboard/zones-db.ts` (module cache + in-flight dedupe, `invalidateDbZoneCache()` on zone write) and matches by `instructor_id`, not by name. `SalesDashboard.locMatch` ray-casts each polygon with `pointInPolygon()` and returns `via: "polygon" | "none"`. **Decided 2026-09-29: polygon-only, no proximity fallback** — the 3 km centroid fallback (`matchLocation`, `PROXIMITY_RADIUS_KM`) is intentionally dead; the dotted 3 km ring + its legend were deleted from `LocationSearch.tsx` because they told the user a proximity search happened when it never does. `public/instructors.kml` is **backfill input only**. `Instructor.areas`/`radius` are legacy and only read as a fallback in `availability.ts` (shared with out-of-repo edge functions — do not strip). See "Instructor Service-Area Polygons".
13. **Google Maps: one script, no legacy Loader**: `src/utils/googleMaps.ts` injects the Maps script itself and resolves by polling for real constructors. Do **not** reintroduce `@googlemaps/js-api-loader`'s `Loader` — its v1 `__onCallback` never fires on the `v=weekly` bootstrap, so it re-injects forever (we measured 18 script tags, "loaded multiple times", `Loader.provide not called by module 'poly'`). Also note `window.google.maps` exists as an _empty_ namespace before classes attach, so readiness must check `typeof gm.Map === "function"`. Components needing extra classes pass them: `loadMaps(["Polygon", "Circle"])`.
14. **On-break instructors**: Excluded from default roster but appear with real slots if matched by location search — no break badge, free slots counted.
15. **Sticky grid z-index**: Don't break `position: sticky` on `.instructor-cell`/`.col-instructor` or collisions with slot popover z-index.
16. **Empty default grid**: Shows "No instructors loaded yet" — search by name or location to load on-demand.
17. **Mock HTML demo**: `mock.html` is standalone demo (no server/build deps) — update in parallel for core grid changes.
18. **Company instructors are Ops-assigned backups, never auto-matched**: `Amanulla Khan` (`62610a49-fb31-4bcc-80bb-f61a78414008`) and `Krupakar Daniel Dennish` (`b3781798-a800-4ce1-9f57-1b97e62a228e`; spelling against the DB, not `Kruopakar`) must never come back from automatic area matching. **Authoritative**: `Instructor.is_company_instructor` (migration `supabase/migrations/20260929_100000_add_company_instructor_flag.sql`, manual apply only — the Raw SQL RPC is unavailable). `zones-db.fetchCompanyInstructorIds()` reads the flagged ids **tolerantly**: until the migration is applied PostgREST rejects the select, so it resolves to an empty set and callers fall back to the normalized-name list in `src/lib/sales-dashboard/company-instructors.ts`. That makes a pending migration safe to deploy ahead of the DB change. Two guards keep them out of automatic matching: (a) `SalesDashboard.locMatch` filters by company id **and** name before ray-casting — currently the only guard that executes in the web app — plus `warnOnCompanyInstructorZones()` developer warning if a backup ever gets a polygon, and (b) `availability.ts:instructorServesArea()` returns `false` up front for `isCompany`/`isCompanyInstructor()` — currently **unreached in this repo**; it guards `evaluateSlot`/`pickBestInstructor`/`computeAvailableSlots`/`computeCoursePlan`/`computeFeasibleFirstSlots`, none of which `useSalesData` or `SalesDashboard` import, and it is a _different file_ from the out-of-repo `supabase/functions/_shared/availability.ts`, so porting that edge function will NOT inherit it. Both still carry legacy `areas` + `radius` (`Amanulla` `["hsr"]`/7, `Krupakar` `["Indiranagar"]`/8), so the deprecated `hasArea()`/`withinRadius()` fallback would leak them into any path that passes a real learner area/lat-lng — the flag+id guard is the reliable barrier (survives renames; the name list covers pre-migration). Neither has a zone row today, so a total guard failure would cause zero wrong assignments; the risk becomes real only if someone draws a polygon for a backup, which `warnOnCompanyInstructorZones()` flags in dev. Flagged flags → regression test: `node scripts/test-company-instructors.mjs` (13/13, covers rename-proof id check + name fallback + empty-set safety). Note: `CreateLearnerSchedule.tsx` was deleted (unreferenced, queried nonexistent lowercase `learners`/`instructors` tables).
19. **Quote string-literal keys in object literals**: `edit` does fuzzy matching, so an `oldString` that differs only by quoting can silently rewrite the existing line. Editing `KML_ALIASES` with `bhanu sir: ...` instead of `"bhanu sir": ...` stripped the quotes and produced a syntax error. Always `git diff` after editing files with quoted keys, and run a build to confirm.

## Sales Dashboard (Admin Route: `/admin/sales-dashboard`)

- Live instructor availability grid (30-min slots, color-coded free/booked)
- **Double-click free slot** → `TentativeBookingModal` → creates `Schedule` row with `isTentative=true`, `status='hold'`, customer details in `tentative_details` JSON
- Validates 1-hour block via `validateOneHourBlock()` in `src/lib/sales-dashboard/availability.ts`
- Startup fetches only `app_settings` (key=`booking_flow`) + light instructor index — **no Schedule queries on load**
- Geospatial filtering via **Postgres polygons** (`instructor_service_zones`) — ray-casting against each instructor's ring, resolved by `instructor_id`. This is the live read path; `public/instructors.kml` is backfill input only
- On-break instructors excluded by default but appear with real slots if matched by location
- Config in `app_settings` table: `booking_days_ahead`, `view_days_ahead`, `slotStart`, `slotEnd`, `gridMinutes`, `instructor_gap_minutes`, `excluded_schedule_statuses`

### Tentative Slot Booking Feature (Production)

**Workflow**: Single-click → slot info popup; **Double-click FREE slot** → `TentativeBookingModal` with form (customer name, phone, sales agent, payment status, address, course). On submit: creates `Schedule{isTentative:true, status:'hold', tentative_details:{...}}` → toast 1.5s → grid reloads.

**Component prop chain**: `SalesDashboard.handleSlotDoubleClick` (useCallback) → `AvailabilityGrid.onDoubleClick` → `InstructorRowGroup.onDoubleClick` → `SlotCell.onDoubleClick` / `MiniRow.onDoubleClick` → `SlotCell.onDoubleClick`. Handler validates via `validateOneHourBlock()` (O(1) Map lookup) before opening modal.

**Modal**: `src/components/admin/sales-dashboard/TentativeBookingModal.tsx` — renders only when open; uses existing `normalizePhone()`, phone masking respects `view_unmasked_phone_numbers` permission. No new API/edge function — direct Supabase insert.

**Dual free grids** (buffer fix): `freeGrid` (60-min class starts for booking engine) + `displayGrid` (30-min slots for display). `useSalesData.ts` builds both; dashboard uses `displayGrid` for cells, totals, popovers. Buffer popover shows "Buffer for Booked/Completed class".

### Implementation Details (Slot Booking + Tentative Blocks)

**Data Layer** (`src/hooks/useSalesData.ts`):

- `useSalesData()` hook manages all dashboard state: config, dates, instructors, blocks, free grids
- Fast startup (~450-900ms): loads only `app_settings` (key=`booking_flow`) + light instructor index (`id, name, status, enabled`)
- On-demand `loadInstructors(ids)` fetches full `Instructor` rows + `Schedule` rows (paginated 1000-row chunks, 60 IDs per batch)
- `buildInstructorFreeGrid()` / `buildDisplayFreeGrid()` from `availability.ts` compute free slots per instructor per date
- `blockDetails` array built from Schedule rows with `tentative_details` for popovers
- `displayGrid` used for UI rendering (30-min granularity), `freeGrid` for booking validation (60-min)

**Availability Engine** (`src/lib/sales-dashboard/availability.ts`):

- Pure TypeScript port of Supabase edge function `_shared/availability.ts`
- `validateOneHourBlock(instructorId, date, startMinute, freeGrid)` — O(1) check that both 30-min slots are free
- `isTimeUnavailable()` handles instructor unavailability JSON (all-day, recurring, date-range, time-specific)
- `instructorServesArea()` matches instructors via `areas[]` or Haversine radius
- `blockCoversCandidate()` checks schedule conflicts with configurable `gapMinutes` travel buffer
- `candidateStartMinutes()` generates time grid from config

**Slot Interaction**:

- Single-click: hover → `SlotCell` shows `slot-pop` with `resolveInfo()` details (free/booked/unavailable/buffer)
- Double-click: `handleSlotDoubleClick` → validates 1-hour block → opens `TentativeBookingModal`

**Tentative Booking Modal** (`src/components/admin/sales-dashboard/TentativeBookingModal.tsx`):

- Form fields: customer name, phone (normalized), sales agent, payment status (unpaid/half_paid/full_paid), address, course
- Courses: demo, 4/5/6/10/15/20-class courses
- On submit: inserts into `Schedule` table with `isTentative=true`, `status='hold'`, `tentative_details` JSON
- `learner_id`, `course_id`, `lesson_id` set to `null` (sales creates hold only, Operations confirms later)
- Uses `normalizePhone()` from `validation.ts`
- TanStack Query `useMutation` for insert, auto-closes on success, triggers dashboard `reload()`

**Existing Tentative Schedule Reuse**:

- `Schedule.isTentative` boolean + `tentative_details` JSON already used by `TentativeManagement` (`src/routes/admin/TentativeManagement.tsx`)
- `TentativeScheduleCard` (`src/components/admin/TentativeScheduleCard.tsx`) handles add/update/delete
- Sales Dashboard creates blocks with same schema — Operations verifies LL/DL/location/course then confirms

**Location/Instructor Matching**:

- `LocationSearch` lazy-loaded (`React.lazy`) — Google Maps Places autocomplete + geocoding
- Zones come from `instructor_service_zones` via `zones-db.ts`; each match ray-casts the instructor's own ring, so **names are irrelevant** at runtime (this is what removed the need for `KML_ALIASES` on the read path)
- Legacy `Instructor.areas` / `radius` still act as a fallback for instructors with no polygon row
- On-break instructors appear in location results with real free slots (no break badge)

## Instructor Service-Area Polygons

Replaces legacy `Instructor.areas` (name list) + `radius` + lat/lng centroid coverage with one drawn polygon per instructor. A new `is_rough` flag marks provisional boundaries that are never used for sales/customer matching. The instructor's residence comes from `Instructor.latitude`/`longitude` and is only ever a marker; it is never used to derive the polygon or to centre matching.

**Schema** — `supabase/migrations/20260928_create_instructor_service_zones.sql`

- `instructor_service_zones`: `id` uuid PK, `instructor_id` uuid FK → `"Instructor"(id_instructor)` `ON DELETE CASCADE`, `kind` (`polygon` | `point`, default `polygon`), `coordinates` jsonb, `raw_name`, `description`, timestamps
- **One row per instructor**: `UNIQUE(instructor_id)` exists specifically so writes use `upsert(..., { onConflict: "instructor_id" })`
- `coordinates` is a closed ring (`[{lat,lng}]`, first point repeated last — KML convention), min 3 points, enforced by CHECK constraint
- RLS on; admin/ops get full CRUD, authenticated gets SELECT
- `updated_at` maintained by the shared `handle_updated_at()` trigger

**Component** — `src/components/instructor-zones/ZoneDrawingEditor.tsx` (onboarding + instructor edit dialog) and `src/routes/admin/InstructorZoneMap.tsx` (main map, inline)

- Single-polygon editor, no `DrawingManager` (the deprecated drawing library caused a white-screen crash). Draw = click the map, then **Finish**
- **No "Redraw" for an existing area, anywhere.** An Ops-drawn boundary is reshaped in place; a from-scratch redraw would replace real geometry with a hand-click approximation. The draw affordance (`zone-draw-toggle`) only renders when there is nothing to edit, so clearing the zone is the deliberate act that makes drawing available
- **The Zone Map edits on the main map, not in a dialog** (2026-09-30). The polygon under edit is a real `editable: true` `Polygon` on the same map as every other layer, so Google supplies the red vertex handles and the midpoint bulges; `insert_at` / `set_at` feed `useZoneHistory`. `editable: true` is also what gives the fresh-draw flow its handles — the old "hide the saved zone, show a draft" split is gone
- `draggable: false` everywhere: dragging the whole shape would move every point away from the streets Ops drew it along, and during a draw it would fight the click that placed a point
- **Below 3 points a polygon cannot enclose an area**, so both editors render progress `Circle` dots (`VERTEX_DOT_METERS` / `MARKER_RADIUS_METERS`) instead and stop drawing dots once the editable polygon takes over — otherwise the red handles would be double-marked. A first draw also registers a map `click` listener; it is removed as soon as the ring reaches 3 points so a stray click outside an existing shape cannot add a vertex to real coverage
- **Live preview while drawing**: the live ring _is_ the in-progress boundary (a second preview polygon would just double up). `VERTEX_DOT_METERS = 90` marks each clicked vertex
- **Undo/redo is a shared hook** — `src/components/instructor-zones/useZoneHistory.ts`. Both the map and the onboarding step use it, so every action (draw point, vertex drag, midpoint insert/delete, manual coordinates, clear) is undoable by construction. Draw points used to be separate `pending` state, which meant a half-drawn boundary had no undo at all
  - A vertex drag fires a path event per animation frame; pass `{ coalesce: "vertex-drag" }` so the whole drag is one undo slot
  - `apply` rejects no-op rings (so a drag that ended where it started costs no history) and anything over `MAX_VERTICES` (undo must never walk through states the DB CHECK constraint rejects)
  - The hook re-seeds on its `deps` subject key **and** on a late-arriving `initial` while the history is still pristine. Without the second case the editor opens permanently empty, because a zone loads from Postgres after first paint. The pristine guard matters: once anything is applied, a later `initial` is the parent echoing the admin's own edit, and re-seeding then would silently discard the undo stack
  - The seed is the **baseline, not an edit** — Undo cannot step back past it (that would read as "delete my zone"; the explicit **Delete** button is for that)
- **Viewport is never moved mid-edit**: `fitTo` reads `editingIdRef` and returns early, so a selection change or a re-render cannot yank the area out from under a drag in progress
- **Coordinate entry**: "Enter coordinates" textarea, one `lat, lng` per line. Accepts `lat, lng` or `lat lng`; range-checks lat [-90, 90] / lng [-180, 180]; reports the offending line numbers. "Load current" round-trips the existing zone
- `MAX_VERTICES = 200` — existing KML polygons run **7-30 vertices** (avg 16.9, max 30 across 66 polygons), so 200 is ~7x the worst real ring while bounding read-path payload (~30 B/point → ~6 KB/zone worst case)
- Ring helpers `closeRing()` / `openRing()`: store closed, strip the duplicate before rendering to avoid a zero-length edge artifact. They now live in `useZoneHistory.ts` and are shared — do not re-declare them per component
- `google.maps.MVCArray` (what `polygon.getPath()` returns) has **no `.map`**; use `.getArray().map(...)`
- **Vertex edits are raised by the path's `MVCArray`, not by the Polygon** (fixed 2026-09-30, after "Save area" silently wrote the original ring back). `polygon.addListener("set_at" | "insert_at" | "remove_at", …)` **never fires** — the `Polygon` is an `MVCObject` and only raises Maps events (`click`, `dragstart`, …). Register on `polygon.getPath()` instead, as `ZoneDrawingEditor.tsx:438-440` always has. The symptom is deceptive: the red handles still move on screen, but app state keeps the seeded ring, so every save is a no-op and the map appears to snap back
- **`polygon.setPath(...)` replaces the `MVCArray` wholesale**, dropping listeners bound to the old one. Any code path that reconciles the polygon to state (undo/redo, re-seed) must re-bind afterwards or editing dies for the rest of the session — `attachPathListeners()` in `InstructorZoneMap.tsx` is idempotent and does exactly this, and the path handler reads `editPolygonRef.current` / `draftRingRef` at call time so it outlives the effect run that created it
- **The Polygon has no per-vertex `dragstart`** (its own only covers a whole-shape drag, which is disabled). Drag coalescing is therefore time-bounded — `DRAG_BURST_MS = 250` — not event-delimited
- **`window.__zoneEditPolygon`** exposes the live editing polygon so tests can fire a real `set_at`/`insert_at`. Not DEV-gated, because the Playwright suite runs a **production build** where `import.meta.env.DEV` is false. A test must use `path.setAt(i, …)`, **not** `polygon.setPath(…)`: `setPath` fires its events before the editor can re-bind, so a change made that way never reaches app state — unlike a real handle drag. Using it made a restore silently no-op and compounded 0.01° of drift into `test_dp` on every run
- Needs an `APIProvider` (from `@vis.gl/react-google-maps`) in scope; uses `useMapsLibrary("maps")` only. Falls back to Bangalore if no `center`
- **The editor is rendered inside the instructor `<form>`**, so any keydown handler on a single-line input _must_ call `e.preventDefault()` on Enter. A bare `e.key === "Enter" && …` lets the form submit: the address-search box used to silently save the instructor and close the dialog when the admin only meant to pan the map (found 2026-09-29 by browser test — it re-upserted an identical ring, bumping `updated_at`). The same applies to any new input added to this editor or its onboarding step
- **A rough ring's dashed edge is a separate `Polyline`, tracked in `overlaysRef` as `dash`.** `Polygon` has no dash style, so the polygon's own `strokeOpacity` is set to `0` and a `Polyline` with a repeating tick `icons` entry draws the boundary instead — it re-closes the ring (`[...ring, ring[0]]`) because the stored ring is open. Both are `setMap(null)`-ed by `clearOverlays()`. Getting this wrong renders rough polygons **completely invisible** (zero fill _and_ zero stroke), which reads as "the toggle does nothing"

**Write paths**

- Onboarding: `OnboardingWizard.tsx` upserts the zone _after_ the `Instructor` insert (FK requires the parent first). Non-fatal — failure shows a warning toast, instructor is still created. Polygon is currently **optional**
- Edit existing: `instructors.tsx` loads it in `handleEditInstructor`, upserts on save, **deletes the row when the admin clears the area** (null serviceZone = delete)

**Read path / matching** — `src/lib/sales-dashboard/availability.ts`

- `InstructorLike` gained `zone?: GeoPoint[]`; `areas`/`radiusKm`/`lat`/`lng` are marked `@deprecated`
- `instructorServesArea()` and `pickBestInstructor()` ray-cast the polygon via `zoneContainsPoint()` → `pointInPolygon()` (reused from `kml.ts`, not duplicated). Polygon is checked **first** and wins; legacy `hasArea()`/`withinRadius()` remain as fallback so unmigrated instructors keep matching. `pickBestInstructor` sorts `zoneMatch` above `areaMatch`
- `stripClosure()` removes the duplicate closing vertex before the scan

**Legacy columns are still in the DB** (`Instructor.areas`, `radius`, `latitude`, `longitude`). Onboarding and the instructor edit dialog no longer write them — Supabase `.update()` only sets keys present in the object, so **existing legacy values are preserved, not wiped**. Dropping the columns is a separate later migration.

**Status, rough polygons, and residence (2026-10-01)**

- `Instructor.status` (`active` / `on_break` / `inactive`) is the canonical signal; `enabled === false` is the legacy fallback. Use `resolveInstructorStatus()` from `src/constants/instructorStatus.ts` — never re-derive this per screen
- **Inactive**: **listed in the Zone Map sidebar AND drawn by default**, gated by the `Show Inactive instructors` toggle. They are still excluded from sales/customer booking. Their rows and polygons are **kept** in the DB, so reactivating restores the area. The roster query is deliberately unfiltered — the sidebar needs everyone. `allRosterZones` is now just `rosterZoneRows` (it no longer drops inactive); the toggle filters both the drawn set and the sidebar lists
- **Sidebar "Mapped" must not be gated by the rough toggle.** `listedZones` is built from `rosterZoneRows` filtered only by `statusVisible` — mode-agnostic — while the map's `zones` is rough-exclusive. Gating both by rough mode was a real bug: an instructor whose polygon the mode hid left "Mapped" *and* left "Not mapped" (which skips anyone in `zoneByInstructor`), so they vanished from the sidebar entirely. With one rough row it dropped exactly one on_break instructor (sidebar showed 10 badges for 11), and switching rough mode ON emptied the sidebar of all ~67 verified owners. "N of M instructors mapped" reads `zoneByInstructor.size`, so the sidebar and the header agree
- **Status tags in the Zone Map sidebar** (`ZoneStatusTag` in `InstructorZoneMap.tsx`): `On Break` / `Inactive` only, never `Active` — a chip on ~120 rows would bury the two states that change behaviour. Tagged on **both** columns, since an inactive instructor lands in "Mapped" when they have a polygon and "Not mapped" when they don't. The tag renders **after the name**, inside the name button, so it reads as a qualification of that instructor rather than a separate control stacked beside them. Inactive rows keep the per-layer visibility checkbox, since their polygon IS a layer now
- **Sidebar status toggles** (`statusFilter`): three independent switches — `Show Active / On Break / Inactive instructors` — below the rough toggle, each with its own live count. All three default **on**. They gate the sidebar lists _and_ the drawn set, and are a **view filter only**: they never write to `Instructor`. Turning one off IS reversible — restoring the switch brings the rows and polygons straight back
- **Promoting/demoting a rough polygon** (`promoteZone` / `demoteZone` in `InstructorZoneMap.tsx`): the info card shows **Make normal polygon** for a rough zone and **Make rough polygon** for a verified one, each a single `UPDATE ... SET is_rough = …` on the existing row. Deliberately a flag flip, not a re-save: `UNIQUE(instructor_id)` means the row already exists, and restating `coordinates` would risk altering an Ops-drawn ring during what is only a verification. `updateZoneById` therefore takes `coordinates` as **optional** and omits the key entirely when it is not supplied — the one place that must not be "helpfully" filled back in
- **`instructor_service_zones` RLS blocks unauthenticated writes.** The Playwright suite runs against production with the anon key, so a test that writes here **cannot undo itself** (this already promoted the single live rough row once, and it had to be restored by hand with the service-role key). Both the promotion (`info-card-promote`) and demotion (`info-card-demote`) tests therefore **intercept** the PATCH via `page.route` and assert the outgoing body — `is_rough: false`/`true` present, `coordinates` absent, targeted at `id=eq.…`. Use the same interception trick for any future write test here; a `finally` restore is not a safety net, it is a hope
- **Two live rows are intentional Playwright fixtures** (keep them; the suite reads them and anon calls cannot restore them):
  - **Rough fixture** — zone `fddbf7bb-faa2-47da-86f4-60058db614dc`, instructor `1a490058-f31a-4598-b7e5-9f7ac2263242` (`Ankit_ins_test`, status `on_break`), `raw_name` `"Ankit_ins_test test rough"`. It is the only live rough row, so the rough-view, promote, and "Expected 11 / Received 10" sidebar-count tests depend on it; deleting it fails them (`no live rough polygon to promote`). Its `on_break` status is load-bearing: it exercises the on_break + rough + mapped interaction that the off-by-one bug dropped.
  - **Verified fixture** — zone `24840836-7e86-4566-9e6b-030bc97ddcd3`, instructor `34239456-159b-42a0-8184-a0e11954cfd0` (`test_dp`, status `active`), `raw_name` `"test_dp"`. Used by the save round-trip and demote tests; it must stay `is_rough = false` (see below).
- **Test helper split**: `zoneState(page)` waits for `zones.length > 0` and hangs on any state that legitimately empties the map; `rawZoneState(page)` does not. Use `rawZoneState` after a toggle click or when asserting an empty drawn set, or the failure reads as "the toggle is broken" rather than "the list is empty"
- **Sidebar counts** read from `zoneByInstructor.size` / `visibleWithoutZone`, never from `zones.length` / the unfiltered roster — `zones` is mode-, status- and toggle-dependent, so those counts used to change when Ops toggled rough polygons or marked someone inactive
- **On break**: outline-only (`fillOpacity: 0`), still listed and still badged. They keep their existing location-match behaviour but are not bookable
- **`is_rough`** (migration `20261001_100000_add_rough_polygon_flag.sql`): a provisional boundary. Hidden on the Zone Map unless "Show Rough Polygons" is on, drawn with a **dashed** `Polyline` because `Polygon` has no dash style, and never serviceable. Excluded at the source: `fetchDbZones()` defaults to `includeRough: false`, so the sales dashboard cannot see one. Belt-and-braces: `availability.ts:instructorServesArea()` returns `false` first thing for a rough instructor, before both the polygon and the legacy area/radius paths
- **Rough replaces verified, never coexists** — `UNIQUE(instructor_id)` is kept deliberately, so an instructor has one row that is either rough or verified. Promotion and demotion are flag flips on that single row, never a re-save or a second insert
- **Residence** (`Instructor.latitude/longitude`) is a marker only. It is routinely outside the polygon and is never used to derive or centre it; the Zone Map falls back to the centroid for display when no residence is registered
- **Migration tolerance**: reads retry without `is_rough` so the frontend can deploy ahead of the manual DDL. Writes degrade **asymmetrically** — a verified save retries without the column, a rough save throws `MISSING_ROUGH_COLUMN_MESSAGE`. Silently dropping `is_rough: true` would store an unverified boundary as a real service area, which is the exact harm the flag exists to prevent

**✅ Live read path — DONE (2026-09-29)**

- The sales dashboard now matches against **Postgres polygons**, not KML. `zones-db.ts` selects `instructor_id, coordinates, raw_name, Instructor(name)`, filters `kind='polygon'`, and validates each ring (≥3 finite points, lat [-90,90], lng [-180,180]) before it reaches the grid
- `SalesDashboard.tsx` builds `zoneIdByName` from the DB and passes `DbZone[]` to `LocationSearch`; matched instructors resolve **by `instructor_id`**, so name spelling no longer matters at runtime
- `KML_ALIASES` and `fetchKmlData()` are no longer on the read path. `pointInPolygon` remains in `kml.ts` and is the only geometry helper the dashboard calls; `haversineKm` is still imported by `scripts/compare-kml-vs-db-zones.mjs`. `matchLocation()`/`PROXIMITY_RADIUS_KM` are now fully dead and can be deleted once you no longer want the old fallback as a reference
- **Verified in-browser**: 66 rows returned from `instructor_service_zones`; Koramangala→Imran/SATHISH, Whitefield→Revanth/Abhishek, Electronic City→Jobin Thomas, Jayanagar→Bhanu/VIJAY/Santhosh; **0 requests to `instructors.kml`**
- No `kind='point'` rows exist, so the old centroid-proximity fallback no longer contributes matches — polygon-only behaviour
- `useSalesData.ts` deliberately does **not** fetch zones: the availability grid never filters by area (it gets an explicit eligible list), so that query was pure overhead
- The learner-facing direct-booking edge functions are **not in this repo** (`supabase/functions/_shared/` only has `complete-payment.ts`), so their read path can't be changed from here — the shared engine is polygon-ready for whenever they port this file

**Live data state** (2026-09-29)

- 130 `Instructor` rows; `instructor_service_zones` holds **67 rows**, all `kind='polygon'`, 67 unique `instructor_id`, 0 orphan FKs, 0 normalized `raw_name`/`Instructor.name` mismatches
- `public/instructors.kml` is the cleaned source: **130 placemarks (66 polygons, 64 points)**
- 1 row is a pre-existing mock: `test_dp` (current zone id `24840836-7e86-4566-9e6b-030bc97ddcd3`, instructor `34239456-159b-42a0-8184-a0e11954cfd0`; see the fixture bullet above) — the only **unclosed** ring. Safe to delete with Ops approval. It is also the fixture the Playwright zone suite edits (the save round-trip test) and reads for the demote test — so treat a `test_dp` mismatch as suspect before assuming a UI bug. **It must also stay `is_rough = false`**: the round-trip test reaches it through the default map view, and a rough polygon is hidden there by design, so setting the flag makes that test time out on `getByLabel("Edit test_dp service area")` instead of failing loudly. Flip it back, or enable the rough toggle in the test — do not "fix" the timeout by weakening the click
- 3 instructors share the name `Divyansh Pal` (2 of them own a polygon), which is why the verifier prints `NOT IN MIGRATION Divyansh Pal` three times for the same name. Pre-existing duplicate records, not zone drift; the verifier matches by name so it cannot disambiguate them
- A second row absent from every migration is a real polygon drawn through the UI for `Divyansh Pal` (2026-09-30). The verifier reports it as `NOT IN MIGRATION`; that is expected, not drift
- 4 descriptions are real SQL `NULL` (CSV renders these as the literal text `null`): Jawed, Jobin Thomas, Mohammed Imran A(HSR), Saveen Kumar. 2 carry pricing/sales text that probably shouldn't be in a service-area note: Prabhavathy Sadesh kumar, Mathi Manohar
- 8 `Instructor.name` values have leading/trailing whitespace; `zones-db.ts` trims on read
- `Ameen / Arokia` is **resolved** — see "KMZ re-import (2026-09-29)" below

**Data integrity check** — `scripts/verify-instructor-service-zones.mjs`

```bash
node scripts/verify-instructor-service-zones.mjs          # dry run, exit 1 on drift
node scripts/verify-instructor-service-zones.mjs --fix    # rewrite drifted rows from the migration
```

- Replays **every** migration that inserts polygons, in timestamp order, honouring each file's `ON CONFLICT` clause (a later `DO UPDATE` correctly supersedes the original backfill). Hardcoding a single file made every subsequent fix look like drift
- Diffs every live row against that replay, so an accidental polygon overwrite in the UI is caught. Use `exitCode`, not `process.exit()` — exiting with a live fetch handle trips a libuv assertion on Windows
- Currently **0 drift**; the only non-clean result is `test_dp` (unclosed ring, not in any migration), so a clean run still exits 1
- Worth running after any editor testing that saves: the instructor edit dialog **writes straight to `instructor_service_zones`**

**Backfill script** — `scripts/backfill-instructor-service-zones.mjs`

```bash
node scripts/backfill-instructor-service-zones.mjs --parse-only  # validate KML parsing, no DB
node scripts/backfill-instructor-service-zones.mjs             # emit SQL (does NOT write to DB)
node scripts/backfill-instructor-service-zones.mjs --overwrite # DO UPDATE instead of DO NOTHING
node scripts/backfill-instructor-service-zones.mjs "--only=A,B" out.sql  # just those rows, as DO UPDATE
```

- Follows the `scripts/generate-learning-catalog.mjs` pattern: bundles TS source through Vite's esbuild so it imports the **live** `normalizeName()` / `resolveInstructorName()` — `KML_ALIASES` is never duplicated
- Reads only `Instructor(id_instructor, name)`; needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_SERVICE_ROLE_KEY`
- Point-placemarks (64) are **skipped**: they are centroids, not coverage, and `UNIQUE(instructor_id)` allows only one row anyway
- Current state: **66/66 polygons resolved** to 66 distinct instructors, 0 unmatched, 0 name collisions. `KML_ALIASES` is down to 2 entries: `niteesh reddy` → `nitheesh reddy` and `mohan kumar k s` → `mohan kumar ks`
- `--only=<names>` emits a minimal, reviewable incremental migration for a source-KML change and forces `DO UPDATE` for those rows (a plain re-run would emit `DO NOTHING` and silently keep the stale ring). It aborts rather than writing an empty migration
- **Backfill correctness verified** against the real `instructorServesArea()`:
  - 0 duplicate `normalizeName()` values across the instructors, and 0 polygons resolving to the same instructor, so no row is silently lost to a `Map` overwrite
  - 44 of the 53 instructors that have **both** a polygon and a point placemark have their point inside their own polygon
  - The other 9 are **pre-existing `instructors.kml` inconsistencies**, not backfill bugs — e.g. `BABAJAN N`'s point is literally a shared _vertex_ of the `P Rama Mohan` polygon, and `Pratheesh sohan d souza` is 17 km from its own polygon. The backfill copies the same polygons the dashboard already trusted via `matchLocation`, so it neither introduced nor worsened this. Worth a KML cleanup pass, but not a blocker
- `MAX_VERTICES = 200` is empirically justified: `--parse-only` reports the KML vertex distribution (min 7, max 30, avg 16.9, 66/66 rings already closed)

**Backfill SQL status** (2026-09-29)

- `20260928_010000_backfill_instructor_service_zones.sql` (65 rows) and `20260929_000000_backfill_instructor_service_zones_add_mohan.sql` (+1, `Mohan kumar ks`) are **already applied** (DDL needed the SQL editor / `psql`; the raw SQL RPC is unavailable — `PGRST202`/404)
- `20260929_020000_update_instructor_service_zones_from_new_kml.sql` (3 rows, `DO UPDATE`) is **already applied** as a PostgREST upsert — DML does not need the SQL editor
- Live table is 67 rows = 66 KML polygons + `test_dp`, and matches the replayed migrations with 0 drift
- `psql`/SQL Editor only for DDL; do not attempt DDL from the app

**KMZ re-import (2026-09-29)** — a fresh `Copy of Lane instructor driving zones.kmz` superseded the 2026-09-28 import and **resolved the `Ameen / Arokia` ambiguity**

- Raw export: **148 placemarks** (82 polygons, 66 points). `scripts/clean-instructors-kml.mjs` drops **18 junk items** — `Point 126`/`Point 144`, `Polygon 148`/`Polygon 149`, and 14 `Non-demand area - interior gap N` / `Kodathi road trim part N` heatmap artefacts (editor scratch geometry, not coverage)
- Cleaned result: **130 placemarks (66 polygons, 64 points)**; all 66 polygons resolve to 66 distinct instructors, 0 unmatched
- **Cleaning is now scripted** (`node scripts/clean-instructors-kml.mjs <doc.kml> [--apply]`, dry-run by default) instead of a manual pass. Placemark bodies are copied verbatim with their surrounding whitespace, so the only diff against the raw export is the dropped set
- `Ameen / Arokia` (`b0f53106-…`): the new export contains **only the 23-vertex polygon** ("Timings: Ameen Sir: 6 AM - 10 AM, Vehicle: Hyundai i10, Service area: C V Raman Nagar") plus its centroid. The competing 18-vertex ring ("6pm to 4pm, monday off, i10") that the old export carried **is gone**, so the 23-vertex ring is authoritative and the DB row was updated 18 → 23 pts. No Ops decision needed any more
- Do **not** "fix" this by concatenating the two rings into one 41-point ring. They overlap by ~8.0 km² of a ~14.2 km² union, and `pointInPolygon` uses even-odd parity, so a self-intersecting concatenation computes **XOR** — learners in the overlap would match nothing
- Two other real geometry changes in the same export: `Salauddin` (16 pts, 11 coords rewritten) and `Narasimhareddy` (19 → 20 pts, description also lost its "4:00 PM to 7:00 PM" line). All 3 rows are in the `20260929_020000` migration
- Old export counts for reference: 131 placemarks (67 polygons, 64 points) — the extra polygon was the duplicate `Ameen / Arokia` ring

## Import Order

Enforced by `simple-import-sort` (ESLint):

1. External deps
2. Relative imports
3. Side-effect imports
   Auto-fixed by `pnpm lint:fix`

## Linting & Formatting

- ESLint: TypeScript + React + `simple-import-sort` + Prettier
- Prettier: 80-char, trailing commas, double quotes, Tailwind plugin for class sorting
- Pre-commit hooks enforce linting

## Testing

No test framework configured. To add: Vitest (unit/integration), React Testing Library (component), Playwright/Cypress (E2E).

## Supabase Schema (Core Tables)

| Table                            | Purpose                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `Learner`                        | Student profile (phone, name, address, LL status)                                            |
| `Instructor`                     | Instructor (DL, vehicle, unavailability JSON, Google Calendar sync)                          |
| `instructor_service_zones`       | Service-area polygons — one row per instructor, `UNIQUE(instructor_id)`, `coordinates` jsonb |
| `Schedule`                       | Lessons (instructor_id, learner_id, date, start/end, status, isTentative, tentative_details) |
| `enrollment`                     | Course progress                                                                              |
| `payment`                        | Payment records (gateway: icici/razorpay)                                                    |
| `ll_applications`                | LL journey tracking                                                                          |
| `no_show_fee` / `no_show_appeal` | Penalties & appeals                                                                          |
| `instructor_earning_adjustment`  | Bonuses/corrections                                                                          |
| `app_settings`                   | Feature flags + config (JSON)                                                                |

## Third-Party Integrations (24 services)

- **Payments**: Razorpay, ICICI Orange PG (v2 HMAC-SHA256)
- **Messaging**: Heltar (WhatsApp, 40+ templates)
- **Calls**: Exotel (learner↔instructor), MSG91 (instructor↔KAM)
- **Calendar**: Google Calendar API (OAuth2)
- **Maps**: Google Maps JS API (Places autocomplete + geocoding)
- **Analytics**: GA4 (Measurement Protocol)
- **AI**: OpenAI (gpt-4o-mini)
- **CRM**: Cratio (webhook), Cal.com, Gmail SMTP

## Sales Dashboard E2E flake (23P01 "already booked") — FIXED

Status: **fixed**. The root cause is now understood, so this section is kept as a
warning about the failure MODE rather than an open item. Do not "re-fix" it by
adding retries — the cause is understood and it was never test pollution.

**Symptom (historical).** `tests/playwright/sales-dashboard.spec.ts`, test
`"double-clicking a free slot, filling the form, and submitting creates a
tentative booking"`, failed roughly 1 in 5 repetitions. The modal showed the
app's optimistic-lock text `"This slot was just booked by another sales agent.
Please close this and pick a different time."`, i.e. `TentativeBookingModal` saw
Postgres `23P01` from `schedule_no_overlap_new_rows`
(`supabase/migrations/20260421_schedule_no_overlap_constraint.sql`).

**It was NOT shared-database pollution.** All of the following were checked
against the live DB and came back clean or empty:

- Service-role query: **0 rows** for `test_dp` on `2027-05-15`, and 0 rows for
  _any_ instructor on that date, before and after the failing runs.
- `clearSeededDay()` (anon-key `DELETE`) really does delete — confirmed by
  service-role read-back.
- The anon key used by the suite is valid and RLS permits its `INSERT`/`DELETE`.
- A deliberate duplicate-insert probe reproduces `23P01` correctly, so the
  constraint itself was fine.

**Actual cause: nested forms caused DOUBLE SUBMISSION.** The modal issues TWO
`POST /rest/v1/Schedule` inserts ~40–100 ms apart for one click. The bodies are
byte-identical apart from `tentative_details.created_at`
(`…11:41:21.617Z`, `…21.681Z`, `…21.717Z`). The first returns `201`, the rest
return `400 {"code":"23P01"}` — which is exactly the "conflicts with existing
key" message. One test run showed `3` inserts from a single click.

`mutationFn` only ever called `sb.from("Schedule").insert(rows)` **once**
(`TentativeBookingModal.tsx:241`), and `handleSubmit` called
`createTentativeMutation.mutate()` **once**. So the extra requests were never two
`mutationFn` invocations from one handler call — they were duplicate implicit
form submissions. The submit `<button type="submit">` sat inside a `<form>` that
was itself nested inside the onboarding/instructor `<form>` on the admin pages,
so the browser dispatched the submit to both ancestors (the same hazard already
documented under "Instructor Service-Area Polygons").

**The fix** keeps the modal's own `<form>` for Enter-to-submit, but stops the
implicit submission from reaching an outer form: a `submit` handler calls
`preventDefault()` and submits programmatically via an explicit
`onClick` path, so exactly one insert is issued per click regardless of how many
`<form>` ancestors exist.

Also note `clearSeededDay()` must run **before** `searchAndAdd()`: adding the
instructor is what triggers the grid's `Schedule` fetch for the date, so a wipe
issued after that fetch leaves the grid's `blocksIndex` holding a row the
database no longer has, and the modal then refuses the slot client-side
(`"Class 1 (…) is already booked. Remove or change it and try again."`). That
second message is a **third** rejection path and `fillAndSubmitTentative()` now
matches all three (success / `23P01` / client-side re-validation).

## Performance Baselines

| Metric                  | Target                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- |
| Dashboard startup       | ~450–900 ms (config + light instructor index only; **zero Schedule queries**) |
| First instructor load   | ~1–2 s (depends on Schedule volume)                                           |
| Double-click validation | O(1) via `freeGrid` Map lookup                                                |
| Modal render            | Zero cost when closed (conditional render)                                    |

Verification: `pnpm run lint` → `pnpm run type-check` → `pnpm run build`. No test framework configured.

## Deployment

- **Frontend (Vercel)**: Auto-deploy on `main` commits. Build: `pnpm install --frozen-lockfile` → `vite build`. **Gate**: Only Vercel team member commit authors trigger deploy — fix: merge as authorized user or click **Redeploy** in Vercel dashboard. Details in `DEPLOYMENT.md`.
- **Supabase Edge Functions**: Manual deploy only — no CI/CD. Run `supabase functions deploy` from up-to-date `main` checkout.
- **pnpm build-script gate**: New deps with build scripts need entry in `pnpm-workspace.yaml:allowBuilds` or Vercel fails with `ERR_PNPM_IGNORED_BUILDS`.
- **Git push (Windows)**: Use `git -c credential.useHttpPath=true push origin main` (Windows Credential Manager quirk).
