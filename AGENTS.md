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
| **Calls**          | `masked-call` (Exotel learner↔instructor), `msg91-masked-call` (instructor↔KAM)                                                                              |
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
10. **LocationSearch lazy-loaded**: Separate chunk (~7kB); manual lat/lng inputs work via `Input.insertText` in automation (React 19 value tracker defeats programmatic `.value` sets).
11. **KML is geo source of truth**: `public/instructors.kml` parsed once (module cache); ray-casting + 3km Haversine fallback for points; `KML_ALIASES` maps KML names to DB `Instructor.name` (spelling variants). DB `Instructor.areas` unused.
12. **On-break instructors**: Excluded from default roster but appear with real slots if matched by KML location search — no break badge, free slots counted.
13. **Sticky grid z-index**: Don't break `position: sticky` on `.instructor-cell`/`.col-instructor` or collisions with slot popover z-index.
14. **Empty default grid**: Shows "No instructors loaded yet" — search by name or location to load on-demand.
15. **Mock HTML demo**: `mock.html` is standalone demo (no server/build deps) — update in parallel for core grid changes.

## Sales Dashboard (Admin Route: `/admin/sales-dashboard`)

- Live instructor availability grid (30-min slots, color-coded free/booked)
- **Double-click free slot** → `TentativeBookingModal` → creates `Schedule` row with `isTentative=true`, `status='hold'`, customer details in `tentative_details` JSON
- Validates 1-hour block via `validateOneHourBlock()` in `src/lib/sales-dashboard/availability.ts`
- Startup fetches only `app_settings` (key=`booking_flow`) + light instructor index — **no Schedule queries on load**
- KML geospatial filtering via `public/instructors.kml` (ray-casting + Haversine); DB `Instructor.areas` unused
- On-break instructors excluded by default but appear with real slots if matched by KML location
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
- KML zones from `public/instructors.kml` (polygons + points) — `matchLocation()` does ray-casting + 3km Haversine fallback
- `KML_ALIASES` maps KML names to DB `Instructor.name` (spelling variants)
- On-break instructors appear in location results with real free slots (no break badge)

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
