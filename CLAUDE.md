# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**InLane Web App** is a comprehensive driving school management platform built with React, TypeScript, and Vite. It supports multiple user roles (learners, instructors, admins) with role-based routing, real-time scheduling, payments via Razorpay, Google Calendar integration, and learning analytics.

### Tech Stack

- **Frontend**: React 18, TypeScript 5.5, Vite 5.2
- **Styling**: Tailwind CSS with custom Radix UI components
- **State Management**: React Context (auth, phone visibility), TanStack Query for server state
- **Backend**: Go service (via `/go-api` proxy), Supabase (Postgres, edge functions)
- **Payment**: Razorpay integration
- **Maps/Calendar**: Google Maps API, Google Calendar API integration
- **Package Manager**: pnpm 11.8.0, Node.js 22.x

## Development Setup

### Installation

```bash
pnpm install
```

### Environment

Create a `.env` file from `.env.example`:

```
VITE_SUPABASE_KEY="<anon_key>"
```

Environment variables are loaded as `import.meta.env.VITE_*` in the app.

### Common Commands

- **Dev server**: `pnpm run dev` (starts Vite with proxy to `http://localhost:8080` for Go backend)
- **Build**: `pnpm run build` (produces `dist/` directory)
- **Preview**: `pnpm run serve` (preview production build locally)
- **Linting**: `pnpm run lint` (formats and fixes both Prettier and ESLint)
  - `pnpm run lint:format` — Prettier only
  - `pnpm run lint:fix` — ESLint only
- **Type check**: `pnpm run type-check` (runs TypeScript compiler without emit)
- **E2E tests**: `npx playwright test` (builds + serves the production bundle on `:4173`)
- **Backend suite**: `node tests/backend-suite.mjs` (needs the anon key)
- **Unit tests**: `node --test <file>` per file (see Testing)

**Required order**: `lint` → `type-check` → `build`

## Architecture

### Project Structure

```
src/
  app/          # Feature-specific pages (instructor, learner flows)
  components/   # Reusable UI components (ui/, layout/, lesson/, admin/sales-dashboard/, instructor-zones/, admin/learner/, scheduling/)
  routes/       # Route definitions for admin, learner, instructor paths
  pages/        # Legacy page components (being migrated)
  services/     # Feature flags via featureFlagService.ts
  context/      # React Context providers (auth, phone visibility)
  hooks/        # Custom React hooks (useCanSeeCustomerPhone, useSalesData, …)
  queries/      # TanStack Query hooks (organized by domain: instructor.ts, learner.ts, userManagement.ts, adminPermissions.ts)
  lib/          # Utilities (supabaseClient, calendarUtils, geoUtils, admin-schedules, admin-learner-list, learner-service, scheduling-requests, learner-schedule-onboarding, sales-dashboard/*)
  types/        # TypeScript type definitions
  constants/    # App-wide constants
  utils/        # Shared utility functions (googleMaps.ts injects the Maps script itself)
  assets/       # Static images, icons

tests/          # playwright/, backend-suite.mjs, and */<name>.test.mjs unit suites
docs/           # admin-schedule-consistency.md, onboarding-scheduling-queue.md, Game_Analytics.md
scripts/        # verify/backfill/clean-instructor-service-zones.mjs, generate-learning-catalog.mjs
sql/            # Manual-install SQL (override_tentative_slot.sql)
```

### Key Patterns

**Routing & Auth**

- `<BrowserRouter>` with protected routes: `ProtectedLearnerRoute`, `ProtectedInstructorRoute`, `ProtectedAdminRoute` in `context/auth-context.tsx`
- Three separate role trees; auth context holds role and user state
- Role detection happens at app load; routing enforces access control

**Data Fetching**

- TanStack Query hooks in `src/queries/*` (organized by domain: `instructor.ts`, `learner.ts`, etc.)
- Go backend API at `http://localhost:8080/v1/*` (proxied as `/go-api` in dev, real URL set via `VITE_BACKEND_API` in prod)
- Internal endpoints at `/go-api/internal/*` (e.g., feature flags) bypass the `/v1` rewrite

**Supabase Integration**

- Client initialized in `src/lib/supabaseClient.ts`
- Anon key stored in `.env` as `VITE_SUPABASE_KEY`
- Edge functions deployed manually via `supabase functions deploy` (not CI/CD)

**Component Patterns**

- UI components use Radix primitives + Tailwind (no shadcn pre-built, custom components in `src/components/ui/`)
- Lesson flows, scheduling, and payment components modular and feature-specific
- Layout wrapper in `src/components/layout/main-layout.tsx`

**Styling**

- Tailwind CSS with Prettier plugin for class sorting
- Configured with safe-area insets and animation plugins
- Custom Radix UI component library in `src/components/ui/`

### Env Variables

- **Dev**: Vite proxy remaps `/go-api` → `http://localhost:8080/v1`, `/go-api/internal` → `http://localhost:8080/internal`
- **Prod**: `VITE_BACKEND_API` env var sets real Go service URL (e.g., `https://api.inlane.in/v1`); no proxy used
- Supabase key: `VITE_SUPABASE_KEY` (anon, safe to commit if scoped to frontend)

## Deployment

### Frontend (Vercel)

- **Auto-deploy** on commits to `main`
- Production: `inlane-web-app.vercel.app`
- Build: `pnpm install --frozen-lockfile` → `vite build`
- **⚠️ Important**: Vercel gates deploys on git commit author being a team member
  - If deploy fails with "Git author must have access," merge with an authorized account or use Vercel's **Redeploy** button
  - Details in `DEPLOYMENT.md`

### Supabase Edge Functions (Manual)

- **No CI/CD pipeline** deploys edge functions
- After changes to `supabase/functions/*`, manually run:
  ```bash
  supabase functions deploy        # all
  supabase functions deploy <name> # single function, e.g., process-payment
  ```
- Deploy from up-to-date `main` checkout (bundles from local working directory)

### pnpm Build Script Gate

- pnpm 10/11 blocks dependency build scripts by default
- `pnpm-workspace.yaml` → `allowBuilds` controls which deps build (only `esbuild` for Vite)
- Add new entries if a dependency with a build script is introduced (Vercel will error with `ERR_PNPM_IGNORED_BUILDS`)

## API Integration

### Go Backend Service

- **Base URL**: `VITE_BACKEND_API || "/go-api"` (dev proxy to `http://localhost:8080/v1`)
- **Auth endpoints**: `/auth/login`, `/auth/signup`, `/auth/otp/request`, `/auth/otp/verify`, `/auth/reset-password`, `/auth/change-password`
- **Feature flags**: `GET /internal/feature-flags` (gated by `x-internal-key`)
- **Migration**: App is mid-transition from Supabase auth to Go auth; gate: `use_go_auth` feature flag

### Supabase Edge Functions (40+ functions)

Core flows executed server-side:

- **Payments**: `create-razorpay-order`, `verify-razorpay-payment`, `process-payment` (Orange PG), `payment-callback`, `recover-razorpay-payment`
- **Messaging**: `send-message` (WhatsApp dispatcher), `send-schedule-emails` (ICS attachments), `send-payment-link-email`, `send-admin-email`, `send-course-feedback-email`
- **Reminders**: `learner-daily-schedule`, `instructor-daily-schedule`, `send-signup-reminders`, `ll-flow-reminders` (cron jobs)
- **User/Auth**: `create-user`, `create-admin-user`, `delete-user`, `get-current-user`, `password-reset-otp`
- **Calls**: `masked-call` (Exotel learner↔instructor), `msg91-masked-call` (instructor↔KAM)
- **Calendar**: `fetch-calendar-events`, `sync-google-calendar`, `remove-google-calendar-sync`
- **CRM / Learner**: `instructor-slot-booking` (Cratio lead lookup — `lookup` / `lookupLearner` actions), `create-learner-and-enrollment` (with `validation.ts` + `validation.test.ts`)

The **"Direct Booking" functions named in older notes** (`get-booking-config`, `get-booking-slots`, `create-booking`, `change-booking-slot`, `confirm-booking`) **do not exist in this repo** and have no git history here — they live outside version control. Do not assume you can change them from this checkout.

Deployed manually: `supabase functions deploy <name>`

### Third-Party Integrations (24 services)

| Service                 | Purpose                                  | Auth Method                                                            |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| **Razorpay**            | Payment gateway                          | API key + webhook signature                                            |
| **ICICI Orange PG**     | Payment gateway (v2 HMAC-SHA256 signed)  | MERCHANT_ID + SECRET_KEY                                               |
| **Heltar**              | WhatsApp messaging (40+ templates)       | Bearer token                                                           |
| **Exotel**              | Learner↔Instructor masked calls         | Basic auth                                                             |
| **MSG91**               | Instructor↔KAM click-to-call            | authkey header                                                         |
| **Google Calendar API** | Instructor calendar sync                 | OAuth2 + bearer token                                                  |
| **Google Maps**         | Address autocomplete + geocoding         | API key                                                                |
| **Google Analytics 4**  | Event tracking (signups)                 | Measurement Protocol                                                   |
| **OpenAI**              | Chatbot (gpt-4o-mini)                    | Bearer token                                                           |
| **Cratio CRM**          | Lead ingestion + server-side lead lookup | Webhook URLs + API token (`CRATIO_LEAD_LOOKUP_URL`/`CRATIO_API_TOKEN`) |
| **Cal.com**             | Booking appointments                     | Bearer token                                                           |
| **Gmail SMTP**          | Transactional email                      | Username/password TLS                                                  |

## Core Features & Flows

### Learner Journey

1. **Onboarding**: Birthday → Car intent → DL status → Address → Preferences → LL upload
2. **Scheduling**: Book demo/course via price comparison → Razorpay/Orange PG payment → Instructor assignment → Lesson prep
3. **Lessons**: View upcoming lessons → Receive OTP via WhatsApp → Instructor starts/ends lesson → Reschedule (₹300 fee if <10h notice)
4. **LL Flow**: App guides learner through licence application (doc upload → RTO submission → test → DL booking)
5. **Payments**: Two-gateway support (Razorpay or Orange PG); installment splits; demo credit application to course upgrade

### Instructor Journey

1. **Onboarding**: Name → DL/ID docs → Vehicle → Service area (with Google Maps) → Unavailability blocks → ICS import → Contract
2. **Daily**: Calendar (Day/Week/Month) → OTP verification for lesson start/end → GPS tracking → Lesson status updates
3. **Earnings**: Per-class rate (₹425 default) → Monthly target (30 classes) → Leaderboard bonus → KAM contact
4. **Management**: Leave requests → No-show reporting → Safety incidents (SOS) → Support tickets

### Admin Features

- Learner/instructor management + bulk operations
- Schedule creation and replacement (leave cover-ups)
- Payment recovery (Razorpay wedged payments)
- Earnings config and payout generation (Sat–Fri window)
- Notification management (30+ WhatsApp templates)
- No-show fee management + appeals
- LL/DL document verification + status transitions

## Sales Dashboard (`/admin/sales-dashboard`) — INTEGRATED

**Status**: Live in **this** repo at `/admin/sales-dashboard` (admin-protected). It was originally prototyped in the separate `Lane-sales-requirement` repo (React + TS + Vite) and has since been ported in — it is **no longer read-only**: Sales creates **tentative holds** from here (see "Sales Dashboard Slot Booking Feature" below).

### Overview

A real-time instructor availability grid (Google-Calendar-like). Fetches live `Schedule` + `Instructor` data from Supabase and renders 30-minute slots with search, **polygon**-based location filtering, and an expandable per-instructor timetable.

**Tech Stack:**

- **Framework**: React 19, TypeScript 5.x, Vite 5.x
- **Styling**: CSS + theme variables (dark/light toggle, localStorage persistence)
- **Maps**: Google Maps JS API (Places autocomplete + geocoding, optional; location search degrades gracefully without it)
- **Geospatial**: service-area **polygons** from Postgres (`instructor_service_zones`) matched by ray-casting (`pointInPolygon`). There is **no** Haversine proximity fallback — that path is intentionally dead. KML (`public/instructors.kml`) is backfill input only
- **Build/Deploy**: Vercel from this repo; a separate test-only GitHub Pages deploy exists (in another repo, via its own `.github/workflows/deploy.yml`)

**Key Features:**

- **Live availability grid**: 30-min slots where **white = free** (and nothing else), grey = unavailable/paused/buffer/outside-hours, yellow = tentative, purple = booked, blue = already in the in-progress batch
- **Search & compare**: Multi-select instructor comparison mode; toggle "Add" / "Compare" buttons
- **Location-based filtering**: Manual lat/lng input or Google Places autocomplete; matches the instructor's **service-area polygon** (ray-casting)
- **Expandable detail rows**: Click instructor name or "Schedule" button → full timetable across all dates
- **Month navigation**: Date tabs with free-slot count summaries
- **Configurable**: All grid settings (slot start/end, grid minutes, gap, excluded statuses) live in `app_settings` table
- **Responsive**: Sticky header, sticky instructor column, theme persistence

### Architecture & Data Flow

**Fast startup (~450–900 ms):**

- Page load fetches only `app_settings` config (key = `booking_flow`) + light instructor index (`id, name, status, enabled`)
- **No schedule queries on startup** — performance-first design
- Clicking a search suggestion or entering location coordinates triggers on-demand `loadInstructors(ids)` to fetch full Instructor rows + Schedule rows

**Core hook: `useSalesData()`** (`src/hooks/useSalesData.ts`)

- Returns a `SalesData` object: `phase` (loading/error/ready), `config`, `dates`, `timeStarts`, `allInstructors`, `instructors`, `loading` (skeleton rows), `errors`, **`freeGrid`** (60-min, for booking validation) + **`displayGrid`** (30-min, for rendering), `blocks`, `blockDetails` (feeds the slot panel), `reload()`, `loadInstructors()`, `removeInstructor()`
- `freeGrid` / `displayGrid` are `Map<instructorId, Map<date, number[]>>` of free minutes via `buildInstructorFreeGrid()` / `buildDisplayFreeGrid()`
- Paginated queries (1000-row chunks), chunked by instructor ID (60 per batch) to respect Supabase limits
- Fetches have a **20s abort/timeout** and surface a retryable error rather than a permanent skeleton; post-booking/realtime updates do a **silent refresh** (no skeleton flicker) and the realtime stream is debounced. Realtime events are classified locally (only a row the dashboard shows, or a new row inside the loaded window, triggers a fetch; a DELETE refreshes just that instructor)

**Slot computation: `src/lib/sales-dashboard/availability.ts`**

- `buildInstructorFreeGrid()` / `buildDisplayFreeGrid()`: intersect unavailability, Schedule statuses, booked classes, travel gaps
- `candidateStartMinutes()`: generates the time grid (06:00–22:00 in 30-min increments) — this **also sets the visible columns**
- `isTimeUnavailable()`: point-in-time query for instructor unavailability rules
- Excludes statuses in `excluded_schedule_statuses` from free-slot calc (e.g., `cancelled`, `rejected`)

**Geospatial: service-area polygons** (`src/lib/sales-dashboard/zones-db.ts` + `availability.ts`)

- `instructor_service_zones` (Postgres) is the **only** source of service areas; one polygon row per instructor, matched by `instructor_id` (names are irrelevant at runtime)
- `zones-db.fetchDbZones()` reads rows, filters `kind='polygon'` and (by default) `includeRough: false`, and validates each ring before it reaches the grid
- `SalesDashboard.locMatch` ray-casts each ring with `pointInPolygon()` (from `src/lib/sales-dashboard/kml.ts`) and returns `via: "polygon" | "none"`
- `public/instructors.kml` is **backfill input only**; `KML_ALIASES` and `fetchKmlData()` are no longer on the read path
- `matchLocation()` / `PROXIMITY_RADIUS_KM` (the 3 km centroid fallback) are **fully dead** — polygon-only was decided 2026-09-29
- **Quirk**: On-break instructors (`status: on_break`; legacy `enabled === false` fallback) are excluded from the default roster, but if a location search matches their polygon they appear with real free-slot counts and **no** break badge. Company instructors (`is_company_instructor`) are never auto-matched
- `Instructor.areas` / `radius` are **legacy** and only used as a fallback inside `availability.ts` (that file is shared with out-of-repo edge functions — do not strip the fallback)

**Configuration: Supabase `app_settings`**

```json
{
  "key": "booking_flow",
  "value": {
    "enabled": true,
    "gateway": "razorpay",
    "hold_minutes": 15,
    "payment_mode": "test",
    "booking_days_ahead": 14,
    "view_days_ahead": 400,
    "slot_start": "06:00",
    "slot_end": "22:00",
    "slot_grid_minutes": 30,
    "slot_duration_minutes": 60,
    "max_slots_per_booking": 12,
    "instructor_gap_minutes": 15,
    "female_instructor_mode": "off",
    "installment_modes": ["full"],
    "excluded_schedule_statuses": ["cancelled", "rejected"]
  }
}
```

`readBookingFlowConfig()` (`src/lib/sales-dashboard/config.ts`) parses this strictly and exposes camelCase names — `slot_start`→`slotStart`, `slot_end`→`slotEnd`, `slot_grid_minutes`→`gridMinutes`, `slot_duration_minutes`→`slotDurationMinutes`. **There are no hardcoded fallbacks**: a missing/invalid field makes the flow `enabled:false`, so booking **fails closed**. This same row is shared with the learner-facing direct-booking engine — do not widen the hours just to change the dashboard display.

### Integration Points with Main App

**Data dependencies:**

- `Instructor` table: `id, name, gender, status, enabled, is_company_instructor, unavailability` (JSON). `areas` / `radius` / `latitude` / `longitude` are **legacy** (see the Service-Area Polygons note)
- `instructor_service_zones` table: `instructor_id, coordinates` (jsonb), `kind`, `is_rough` — the geo source
- `Schedule` table: `instructor_id, learner_id, course_id, lesson_id, date, start_time, end_time, status, isTentative, tentative_details`
- `Learner` table: `id, name, phone` (for the slot panel's details)
- `Courses` table: `id, name` (the booking form's course list)
- `app_settings` table: row with `key = 'booking_flow'` (config JSON)

**UI/UX alignment:**

- Styling mirrors the app theme (`--gc-*` tokens, dark/light toggle)
- Customer phone masking uses `maskPhoneNumber()` and respects **`view_unmasked_customer_phone_numbers`** (via `useCanSeeCustomerPhone()`), **not** `view_unmasked_phone_numbers`
- Location search uses the app's shared Google Maps integration (`src/utils/googleMaps.ts`)

**Deployment:**

- Already a route in the main app: `/admin/sales-dashboard` (admin-protected)
- Same Supabase project, same Vercel environment variables as the rest of the app
- A separate **test-only** static deploy lives in another repo (`divyanshpal-inlane/sales-requirement-dashboard`, GitHub Pages) — see "Standalone GitHub Pages test deployment"

### Key Implementation Details

**Grid rendering: inline in `src/routes/admin/SalesDashboard.tsx`** (there is no `src/components/AvailabilityGrid.tsx`)

- Memoized; header row (times), one row per loaded instructor
- Expandable rows (`.row`, `.row-selected`, `.row-loading`, `.row-gap`) → nested detail row with a mini full-schedule grid
- Cell states: `.cell-free` (**white**), `.cell-band` (**grey, every non-free cell**), `.cell-tentative` (yellow), `.cell-booked` (purple), `.cell-pending` (blue), `.cell-pending-blocked` (grey/hatched)
- Sticky `thead`, sticky `.instructor-cell` (left column) for horizontal scroll

**Slot detail closure: `resolveInfo(instructorId, date, minute, isFree)`**

- Centralizes all slot-detail logic (free time label, booked classes, paused, unavailability reasons)
- O(1) lookups via `instructorsById`, `blocksIndex`, `config` closures

**Search & suggestions:**

- `.suggest-row` with two buttons: `.suggest-main` (toggle Add/Added/Loading) and `.suggest-compare` (toggle Compare)
- Compare mode shows "Comparing N instructors · X free slots · Clear selection" bar
- Pressing Enter on search adds top result

**Theme & localStorage:**

- `data-theme` attribute on `<html>` (`"light"` or `"dark"`)
- Theme persists to `localStorage["lane-theme"]`
- CSS variables swap under `:root[data-theme="dark"]`

### Common Integration Tasks

**Already wired in** (this is the integration that was pending in the original prototype):

1. Route mounted at `/admin/sales-dashboard` under `ProtectedAdminRoute` (`src/routes/admin/`)
2. `.env` needs `VITE_GOOGLE_MAPS_API_KEY` for location search
3. `app_settings` row `key = 'booking_flow'` must exist with a populated JSON `value` — the booking flow **fails closed** if it is missing/invalid
4. On-break instructor behavior: with a location match they show real free slots and **no** break badge

**Updating configuration at runtime:** the DB row uses **snake_case** keys, and `readBookingFlowConfig()` re-maps them (see the config note above).

```sql
UPDATE app_settings
SET value = jsonb_set(value, '{slot_grid_minutes}', to_jsonb(15))
WHERE key = 'booking_flow';
```

### Testing & Verification

**Manual E2E flow:**

1. Start dev server; load dashboard
2. Type instructor name → suggestions appear; click `＋ Add` → loads the full instructor with real free counts
3. Click `＋ Compare` on another instructor; summary updates to "Comparing N instructors · X free slots"
4. Test location: enter lat/lng or use Places autocomplete; **service-area polygons** match and auto-load instructors
5. Expand an instructor row; the full timetable opens/closes
6. Toggle theme; dark theme persists to localStorage

**Automated:** `tests/playwright/sales-dashboard*.spec.ts` (see Testing).

**Performance baseline:**

- Startup should be ~450–900 ms (config + light index only, no Schedule queries)
- First instructor load should be ~1–2 s depending on Schedule volume
- On-demand loads are cached (module-level caches + in-flight dedupe in `src/lib/sales-dashboard/resilience.ts`)

## Supabase Tables (Core Schema)

| Table                            | Purpose                | Key Columns                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Learner`                        | Student profile        | phone, name, email, address, lat/lng, LL status fields                                                                                                                                                                              |
| `Instructor`                     | Driving instructor     | phone, DL_number, car_make/mode, experience, radius, service areas, unavailability JSON, Google Calendar sync                                                                                                                       |
| `Schedule`                       | Lessons                | instructor*id, learner_id, course_id, lesson_id, date, start/end times, status (booked/ongoing/completed/paused/**hold**), `isTentative` (compat migration `20260918000450*…`), `tentative_details` JSON, otp, started_at, ended_at |
| `enrollment`                     | Course progress        | learner_id, course_id, progress (type: course/demo/topup/custom), payment_status, unlocked_lessons, `case_type`, `two_wheeler_requirement`/`four_wheeler_requirement`, `rto_fee`, `rto_address_change_required`, `vehicle_type`     |
| `payment`                        | Payment records        | learner_id, amount, payment_type (course/demo/topup/reschedule/custom), status, gateway (icici/razorpay), gateway_reference                                                                                                         |
| `lesson_tracking`                | GPS tracking           | schedule_id, latitude, longitude, type (start/tracking/end)                                                                                                                                                                         |
| `reschedule_requests`            | Reschedule bookings    | learner_id, lesson_ids, payment_id, type, status                                                                                                                                                                                    |
| `ll_applications`                | LL journey tracking    | learner_id, status (payment_received → ... → dl_delivered/closed), docs, RTO data                                                                                                                                                   |
| `no_show_fee` / `no_show_appeal` | No-show penalties      | learner_id, amount (₹300), fee_type, status, appeal_reason                                                                                                                                                                          |
| `instructor_earning_adjustment`  | Bonuses/corrections    | instructor_id, type (adjustment/bonus/referral), amount (±), reason, effective_date                                                                                                                                                 |
| `password_reset_challenges`      | OTP / reset tokens     | service-role only; tokens stored as hashes (`20260929000100_create_password_reset_challenges.sql`)                                                                                                                                  |
| `app_settings`                   | Feature flags + config | key (booking_flow, payment_gateway_mode), value JSON                                                                                                                                                                                |

## Code Quality

### Linting & Formatting

- ESLint: TypeScript + React rules (see `.eslintrc.js`), uses `simple-import-sort` for import ordering
- Prettier: 80-char print width, trailing commas, double quotes
- Pre-commit hooks enforce linting (run `pnpm lint` before committing)

### Import Order

- Enforced by `simple-import-sort` ESLint plugin
- External deps → relative imports → side-effect imports
- Violations auto-fixed by `pnpm lint:fix`

### Path Aliases

- `@/*` resolves to `./src/*` (configured in `tsconfig.json` and `vite.config.ts`)
- Use `@/` imports for all local code

## Important Gotchas

1. **Vercel deploy author gate**: See `DEPLOYMENT.md` — redeploy or merge with authorized account
2. **Edge function deploys are manual**: `supabase functions deploy` needed after changes; no CI pipeline
3. **Dev server proxy**: The Vite dev server proxies `/go-api` requests to `http://localhost:8080`. The Go backend must be running locally for API calls to work in dev
4. **Env vars are baked at build time**: `VITE_*` vars are injected at build, not runtime — redeploy to change them
5. **Phone visibility — two distinct permissions**: Ops/Instructor phone uses `PhoneVisibilityProvider` + `view_unmasked_phone_numbers`. **Customer/lead phone** (Learner Management, CRM autofill, Sales Dashboard booking form, Instructor Management timetable side panel) uses `view_unmasked_customer_phone_numbers` via `useCanSeeCustomerPhone()` (`src/hooks/useCanSeeCustomerPhone.ts`). Super admins bypass; the masked view still saves the real number
6. **pnpm strict mode**: Some deps won't build on Vercel unless explicitly allowed in `pnpm-workspace.yaml`
7. **Dual auth stack**: Auth flows support both Go and Supabase (feature-gated); new flows use Go, fallback to Supabase
8. **Completion logic duplication**: Payment completion pipeline exists in 3 places (`payment-callback`, `_shared/complete-payment.ts`, `src/constants/courses.ts`) — keep in sync
9. **Phone normalization inconsistency**: DB stores phones in 4 variants (raw 10-digit, `+91…`, etc.); queries match on all formats
10. **No-show fee policy**: ₹300 charged if rescheduling <10 hours before; appeals allow waiver/reversal by admin

## Testing

Three suites exist — do **not** re-add Vitest/Cypress.

- **E2E (Playwright)**: `npx playwright test`. `playwright.config.ts` sets `testDir: ./tests/playwright`, `baseURL: http://localhost:4173`, and `webServer: "pnpm run build && pnpm run serve"`, so the suite runs against the **production** bundle (where `import.meta.env.DEV` is false). Specs: `sales-dashboard.spec.ts`, `sales-dashboard-edit-highlight.spec.ts`, `sales-dashboard-resilience.spec.ts`, `instructor-management.spec.ts`, `instructor-zone-map.spec.ts`, `instructor-zone-drawing.spec.ts`, `bulk-add-schedules.spec.ts`, `change-slot.spec.ts`, `learner-management.spec.ts`
- **Backend suite**: `node tests/backend-suite.mjs` (plain Node + Supabase anon key)
- **Unit (`node:test`)**: `node --test <file>` per file (each file's header comment carries its own command); they transpile TS with the `typescript` package. Locations: `tests/*.test.mjs` (3) plus `tests/learning-analytics/` (2), `tests/routing/` (3), `tests/scheduling/` (5)
- `tests.md` is the manual/automated checklist for the sales tentative-booking system
- E2E talks to **production** Supabase with the anon key, so a spec that writes to `instructor_service_zones` cannot undo itself — intercept the request (`page.route`) instead

## Debugging & Troubleshooting

- **Payment stuck**: Use `recover-razorpay-payment` edge function in admin LearnerIssueFixer page
- **Edge function not deployed**: Always run `supabase functions deploy` after `supabase/functions/*` changes
- **Feature flag not applying**: Check `isFeatureEnabled()` cache (2-min TTL) and backend flag config
- **Go auth failing**: Backend must be running locally (`http://localhost:8080`); check env `VITE_BACKEND_API`
- **Phone masking not working**: For ops/instructor phone, verify `PhoneVisibilityProvider` is in the app tree and `view_unmasked_phone_numbers` is set. For **customer/lead** phone (Learner Management, CRM autofill, Sales Dashboard, Instructor timetable), the permission is `view_unmasked_customer_phone_numbers` and the hook is `useCanSeeCustomerPhone()`

## Sales Dashboard Slot Booking Feature

**Status**: ✅ IMPLEMENTED & PRODUCTION-READY — and no longer double-click based

### Overview

The Sales Dashboard includes integrated tentative slot booking. Sales agents search for instructors by location, view the availability grid, and create provisional (tentative) lesson blocks directly from the dashboard.

### Key Components

- **TentativeBookingModal** (`src/components/admin/sales-dashboard/TentativeBookingModal.tsx`): collects customer and booking details; renders in a `"modal"` or `"panel"` variant, only when open
- **Slot cell click handler** (`src/routes/admin/SalesDashboard.tsx` — `handleSlotClick`, inline `SlotCell`): a **single click** on any cell selects it
- **1-Hour Block Validator** (`src/lib/sales-dashboard/availability.ts::validateOneHourBlock()`): ensures the full 1-hour block is free before the booking form opens

### How It Works

1. **Single click** on a 30-minute cell → `setSelectedSlot(...)`:
   - a **taken** cell shows that booking's details in the left **slot panel** (nothing else happens — taken cells are inert)
   - a **free** cell opens the booking form in the panel, after `validateOneHourBlock()` passes
2. The form collects:
   - Customer name, phone (auto-normalized)
   - Sales agent (pre-filled with the current user)
   - Payment status (unpaid / half paid / full paid)
   - Customer address
   - Course — options are **loaded from the `Courses` table** (`"None"` + the `Mini Course - …` rows in a fixed order), not hardcoded
3. On submit → creates a `Schedule` row with:
   - `isTentative = true`
   - `status = 'hold'`
   - `tentative_details` JSON with all customer info
4. The dashboard silently refreshes (no skeleton flicker); the slot renders as tentative
5. One customer can hold several tentative blocks; **"+ Add another class"** batches them (see below)

> **There is no double-click anywhere in the grid any more**, and no hover `slot-pop` popover — both were replaced by the single-click slot panel (`6ade368`, `0ee5943`).

### Database Integration

- Uses existing `Schedule` table
- Leverages `isTentative` boolean flag and `tentative_details` JSON column
- No new tables required
- Reuses the `tentative_details` schema for consistency with the existing Admin Tentative Management flow
- `learner_id`, `course_id`, `lesson_id` stay `null` — Sales creates the hold only; Operations confirms later

### Important Notes

- **Sales-only creation**: this dashboard creates TENTATIVE holds only, never confirmed bookings
- **Operations approval required**: tentative blocks become confirmed/booked only after Operations verifies the customer (LL/DL, location match, onboarding)
- **Multiple slots supported**: one customer can hold 4–5+ tentative slots across dates/instructors
- **Auto-open schedule**: opening a booking auto-opens that instructor's Schedule view and hides every other instructor, so the first class and every later one are picked from the same timetable

### Architecture

```
Sales Dashboard Grid (30-min slots)
  ↓ single click a FREE cell
  → validateOneHourBlock() checks that [start, start+30] are both free
  ↓ if available
  → Slot panel shows the TentativeBookingModal (variant="panel")
  → User fills the form + submits
  ↓
  → Creates Schedule{isTentative:true, status:'hold', tentative_details:{...}}
  ↓
  → Dashboard silently refreshes (reload() / realtime)
  → Cell renders as tentative (yellow)
```

### Performance Considerations

- Modal renders only when open (panel/modal variant) — zero cost when closed
- Click handler is a `useCallback`; validator runs in O(1) via `freeGrid` Map lookup
- No new API calls or edge functions needed (direct Supabase insert)

### Files Involved

- `src/components/admin/sales-dashboard/TentativeBookingModal.tsx` — the form (also hosts `CrmLeadAutofill` for new bookings)
- `src/lib/sales-dashboard/availability.ts` — `validateOneHourBlock()`
- `src/routes/admin/SalesDashboard.tsx` — grid, rows, cells, slot panel, and the modal owner (all inline)

### Testing Notes

- Phone normalization uses the existing `normalizePhone()` utility
- Form validation prevents empty/invalid submissions
- Grid refresh keeps the UI in sync with the database
- **Nested-form double submission** is a fixed, load-bearing bug — see the AGENTS.md "Sales Dashboard E2E flake (23P01)" note: submit goes through an explicit `onClick` path so implicit submission can never reach an outer `<form>`

## Sales Dashboard Layout & Design

**Status**: ✅ FULLY OPTIMIZED & PRODUCTION-READY (Reference design implemented)

### Grid Layout Specifications

The instructor availability grid is built with precise column sizing and sticky positioning to match modern calendar UI patterns.

> **The exact pixel metrics below drift; `src/components/admin/sales-dashboard/sales-dashboard.css` is the source of truth.** The header/column/cell numbers in the older version of this doc (44px squares, a fixed 320px instructor column, green free cells) are **obsolete**.

**Column Widths**:

- **Instructor Column**: `min-width: var(--instr-col-width, 280px)` — **sticky left** (`z-index: 2` on the header, `1` on the body). The JS sets `--instr-col-width` to the measured widest `.instructor-cell`; 280px is only the pre-measurement fallback
  - The `<td>` is deliberately **not** `display: flex` (a flex `<td>` is laid out by flex, not the table, and misaligns the header vs body under `border-collapse: collapse`); the flex row lives on an inner wrapper
- **Time Columns**: `min-width: 48px` each
  - Each column is one 30-minute slot
  - The time label **straddles the column's left grid line** (Google-Calendar-style axis), not centered

**Row Heights**:

- **Header Row**: sticky top, `--gc-surface` background, tabular-nums labels
- **Slot Cells** (`.cell`): `min-width: 48px; height: 26px; padding: 0`
- **Row Gap**: `--gc-row-gap` separator between instructors

```text
Header Row (sticky top)
├─ Instructor Label (measured, fallback 280px) ─┬──────┬──────┬──────┐
│  06:00  06:30  07:00  07:30 ...  (48px each time slot)
├─────────────────────────────────────────────────────────┤
Instructor Row  (`.cell` = 48x26px, white = free)
├─ Instr Name (sticky) ────────┼─ White ┼─ Grey ┼ ... (mixed)
```

### CSS Layout Properties

**Key CSS** (`src/components/admin/sales-dashboard/sales-dashboard.css` — current values):

```css
.grid {
  border-collapse: collapse;
  min-width: 100%;
}

.grid th,
.grid td {
  border-right: 1px solid var(--gc-grid-line);
  border-bottom: 1px solid var(--gc-grid-line);
  padding: 6px 8px;
  height: 30px;
}

/* Hour boundaries: every 2nd time column gets the stronger line,
   excluding the sticky instructor column (also an odd nth-child). */
.grid thead th:nth-child(odd):not(.col-instructor),
.grid tr.row td:nth-child(odd):not(.instructor-cell) {
  border-right: 1px solid var(--gc-grid-line-strong);
}

.grid thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 40px;
  background: var(--gc-surface);
}

.col-time-h {
  position: relative;
  min-width: 48px;
  font-variant-numeric: tabular-nums;
}

.col-instructor {
  position: sticky;
  left: 0;
  z-index: 2;
  min-width: var(--instr-col-width, 280px);
  background: var(--gc-surface) !important;
}

.instructor-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: var(--instr-col-width, 280px);
  height: 100%;
  padding: 10px 12px !important;
}

.cell {
  position: relative;
  min-width: 48px;
  height: 26px; /* NOT a 44px square */
  padding: 0 !important;
  cursor: pointer;
}
```

Stacking order matters: `.col-instructor`/`thead th` are `z-index: 2`, `.instructor-cell` is `1`, and the hover popover `.slot-pop` is `60`. Do not break `position: sticky` on `.instructor-cell`/`.col-instructor`.

### Scrolling Behavior

**Horizontal Scroll**:

- Instructor column (320px) remains visible
- Time slots scroll left/right
- Sticky instructor column prevents text cutoff

**Vertical Scroll**:

- Header row stays visible (sticky top)
- Instructors scroll up/down
- Scrollbar appears on right side
- All rows maintain consistent height

**Nested Scroll** (expanded detail view):

- Expanded schedule row contains mini-grid
- Mini-grid scrolls independently
- Main grid scrolling unaffected

### Color & Visual Hierarchy

**Backgrounds** (light theme tokens; the dark theme overrides them):

- **Header** / sticky instructor column: `var(--gc-surface)`
- **Instructor Cell**: `var(--gc-bg)`
- **Time Cells**:
  - Free: `var(--gc-slot-free-fill)` = **`#ffffff`** (white — and nothing else is white)
  - Free hover: `var(--gc-slot-free-hover)` = `#e2e8f0`
  - Busy (`.cell-band`, applied to **every** non-free cell with no other state): `var(--gc-band-bg)` = `#c0c0c1` (dark theme → `var(--gc-detail)`)
  - Tentative (`.cell-tentative`): `var(--gc-slot-tentative-fill)` = `#fbbf24`
  - Booked (`.cell-booked`): `var(--gc-slot-booked-fill)` = `#6366f1`
  - Pending batch (`.cell-pending`): `var(--gc-blue-bg)` = `#dbeafe`

> **History:** free cells used to be green and the busy tone was applied only on **alternating** hours (a zebra "band"). Commit `0ee5943` (2026-10-09) made free white and turned `--gc-band-bg` into the grey busy tone, but left the old parity gate in place, so half the busy cells stayed white. The gate was removed — `.cell-band` now applies to all of them. `--gc-green-*` tokens still exist (the free-slot palette "for historical reasons") and are used by non-cell UI (free-count badge, etc.), **not** by `.cell-free`.

**Borders**:

- **Cell Borders**: 1px `var(--gc-border)` - light gray
- **Column Separator**: 2px `var(--gc-border)` - emphasized
- **Row Separator**: none (gap provides separation)

**Typography**:

- **Header Time**: 10px, weight 500, monospace, gray-600
- **Instructor Name**: 13px, weight 400-600, dark text
- **Free Count**: 12px, weight 600, green text
- **Status Badge**: 11px, weight 500, pill shape

### Performance Optimizations

**Rendering**:

- `table-layout: fixed` - predictable column widths (no layout shift)
- `border-collapse: separate` - cleaner borders without double-sizing
- Sticky positioning via native CSS (no JavaScript)
- Fixed cell dimensions prevent reflow

**Memory**:

- Single table for all instructors (no virtual scrolling needed for < 100 rows)
- CSS Grid cells reuse styles (minimal CSSOM)
- Memoized instructor rows prevent unnecessary re-renders

**UX**:

- Sticky header/column visible during scroll
- Column alignment prevents misalignment during horizontal scroll
- Consistent row height prevents layout jank
- Minimal borders reduce visual noise

### Browser Compatibility

**CSS Features Used**:

- `position: sticky` - IE11+ (with fallback to scroll)
- `table-layout: fixed` - all browsers
- `border-collapse: separate` - all browsers
- CSS Grid variables (`var(--gc-*)`) - fallback to default colors

**Testing Notes**:

- Tested in Chrome 120+, Firefox 121+, Safari 17+
- Horizontal scroll smooth on all browsers
- Sticky positioning works in dark mode
- Print layout breaks at 320px instructor column (acceptable)

---

## Tentative Slot Selection & Booking Feature

**Status**: ✅ IMPLEMENTED & PRODUCTION-READY — but the **interaction described here is superseded**: there is no double-click any more. This section is kept for the schema/validation details, which are still accurate.

> ⚠️ **Stale-claim warning.** Older notes (and an earlier version of this very section) documented `AvailabilityGrid.tsx`, `InstructorRowGroup`, `MiniRow`, `SlotCell` as **separate files** and a `handleSlotDoubleClick` / `onDoubleClick` prop chain. None of that exists. All four grid components are defined **inline in `src/routes/admin/SalesDashboard.tsx`**, and the only click is a **single click** (`handleSlotClick`). `src/components/admin/sales-dashboard/AvailabilityGrid.tsx` was never a real file.

### Feature Overview

Sales agents select an instructor's **free** cell in the Sales Dashboard grid and create a tentative lesson hold. The single click both selects the cell and opens the left slot panel, which shows either that booking's details (taken cell) or the booking form (free cell).

### User Workflow

1. **View availability**: the dashboard renders the instructor's schedule in 30-minute cells
2. **Single click** any cell → `setSelectedSlot(...)`. A taken cell is inert; a free cell opens the form after `validateOneHourBlock()` passes
3. **Fill form**: customer name, phone, sales agent, payment status, address, course
4. **Submit** → creates a `Schedule` row with `isTentative=true`, `status='hold'`, and the customer details in `tentative_details`
5. **Confirmation**: the dashboard silently refreshes and the cell renders tentative (yellow)

### Component Architecture

**Every grid component is defined inline in `src/routes/admin/SalesDashboard.tsx`** — there is no `AvailabilityGrid.tsx` module and no `MiniRow` / `InstructorRowGroup` / `SlotCell` file. Prop flow:

```text
SalesDashboard (owns handleSlotClick + selectedSlot state)
  ├→ inline grid (local AvailabilityGrid)
  │    ├→ per-instructor row group (local)
  │    │    └→ SlotCell (local) — onClick → onSelect(instrId, date, minute, free, info)
  │    └→ expanded timetable rows (local)
  └→ TentativeBookingModal (variant="panel" | "modal", rendered only when open)
       └→ the customer/booking form
```

There is **no `onDoubleClick` prop anywhere** in the current code.

### Handler Implementation

**handleSlotSelect** (inline in `src/routes/admin/SalesDashboard.tsx` — the current, real handler; the old `handleSlotDoubleClick` is gone)

```typescript
const handleSlotSelect = useCallback(
  (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
    info: SlotInfo,
  ) => {
    // Any single click selects the slot so the side panel can show it.
    setSelectedSlot({ instrId, date, minute, free, info });
    if (!free) return; // a taken cell just displays its details

    // ...one-instructor-per-booking lock, "still available?" re-check,
    // classifySlotConflict() (direct / buffer / free) with
    // bufferWaivedForCustomer(), then an unconditional
    // validateOneHourBlock() cross-check for instructor unavailability...

    const startTime = minutesToTime(minute);
    const endTime = minutesToTime(minute + 60);
    const newSlot: SlotPick = {
      instructorId: instrId,
      instructorName: instr.name,
      date,
      startTime,
      endTime,
    };

    if (addingSlotMode) {
      // append to the same in-progress batch (real interval-overlap check)
    } else {
      setPendingSlots([newSlot]);
      setTentativeModalOpen(true);
    }
  },
  [
    /* … deps incl. addingSlotMode, pendingSlots, data?.freeGrid … */
  ],
);
```

**Validation: validateOneHourBlock()** (`src/lib/sales-dashboard/availability.ts`)

```typescript
export function validateOneHourBlock(
  instructorId: string,
  date: string,
  startMinute: number,
  freeGrid: Map<string, Map<string, number[]>> | null,
): boolean {
  if (!freeGrid) return false;

  const instructorGrid = freeGrid.get(instructorId);
  if (!instructorGrid) return false;

  const dayFree = instructorGrid.get(date);
  if (!dayFree) return false;

  // Check if both 30-minute slots [start, start+30] are free
  return dayFree.includes(startMinute) && dayFree.includes(startMinute + 30);
}
```

### Modal Component

**TentativeBookingModal** (`src/components/admin/sales-dashboard/TentativeBookingModal.tsx:47`)

- **Props** (current shape — the modal renders only when open):

  - `isOpen`: boolean — controls visibility
  - `onClose`: () => void — dismiss without saving
  - `onSuccess`: () => void — called after a successful booking (triggers reload)
  - `data`: slot details (`instructorId`, `date`, `startTime`, `endTime`) or null
  - `currentUserName`: string — pre-fills the sales agent field
  - `variant`: `"modal" | "panel"` — the Sales Dashboard passes `"panel"`
  - `slots` / `onRemoveSlot` / `onAddAnotherSlot` — the multi-class batch (owned by `SalesDashboard`)
  - `customerFormData` / `onCustomerFormDataChange` — the batch's shared customer form

- **Form Fields**:

  - Customer Name (required)
  - Phone Number (required, auto-normalized via `normalizePhone()`); masked unless the user has `view_unmasked_customer_phone_numbers`
  - Sales Agent (required, defaults to the current user)
  - Payment Status (dropdown: unpaid / half_paid / full_paid)
  - Customer Address (required)
  - Course — options come from the **`Courses` table** (`"None"` + the `Mini Course - …` rows, fixed order), **not** a hardcoded list

- **CRM autofill** (`CrmLeadAutofill`, `target="sales"`): on **new** bookings only, a Cratio Lead ID / e-mail prefills name, phone, address and payment status via the `instructor-slot-booking` edge function. All fields stay editable. Edit mode has no autofill and hides the phone.

- **Submission**:

  - Validates all required fields before submit
  - Creates Supabase `Schedule` row(s) with:
    ```typescript
    {
      instructor_id: instrId,
      date: date,
      start_time: startTime,
      end_time: endTime,
      status: "hold",
      isTentative: true,
      learner_id: null, course_id: null, lesson_id: null,
      tentative_details: {
        name: customerName,
        phone: normalizedPhone,
        sales_agent: salesAgent,
        payment_status: paymentStatus,
        address: customerAddress,
        course: courseId,        // a Courses.id, or "none"
        course_name: courseLabel, // readable label kept alongside the id
        created_at: ISO8601 timestamp
      }
    }
    ```
  - Multi-class batches submit as a **single multi-row insert** (all-or-nothing; see below)
  - Calls `onSuccess()` to reload the dashboard (silent refresh)
  - Closes automatically

- **Styling**:
  - Uses the `TentativeBookingModal` / `sales-dashboard` CSS
  - Dark-mode support via the `data-theme` attribute
  - Click-outside-to-dismiss
  - Two layouts: `"modal"` (centered dialog) and `"panel"` (the dashboard's left slot panel)

### Database Schema

**Schedule Table (existing)**

```sql
-- New/modified columns for tentative bookings:
isTentative: boolean (default false)
tentative_details: JSON nullable = {
  name: string,           -- customer name
  phone: string,          -- normalized phone (10 digits or +91...)
  sales_agent: string,    -- admin/user who created booking
  payment_status: enum,   -- "unpaid" | "half_paid" | "full_paid"
  address: string,        -- customer delivery/location address
  course: string,         -- a Courses.id, or "none" (legacy: "demo", "course_4", …)
  course_name: string,    -- readable label for the above
  created_at: ISO8601     -- timestamp of tentative booking creation
}

-- Legacy note: bookings saved before 2026-10-13 may carry an old `course`
-- value ("demo", "course_4", …). Edit shows those as "(earlier option)";
-- new bookings default to "none".
```

### Integration Points

- **No new API endpoints**: Uses existing Supabase direct insert (client-side)
- **No new database tables**: Leverages existing Schedule table with isTentative flag
- **Reuses existing patterns**:
  - Phone normalization: `normalizePhone()` utility
  - Availability calculation: existing `buildInstructorFreeGrid()` and `freeGrid` Map
  - Form validation: field-level error messages
  - Toast notifications: success message pattern
  - Modal styling: consistent with dashboard help modal

### Performance Characteristics

- **Modal rendering**: Only renders when open (zero cost when closed)
- **Click handler**: `handleSlotSelect` is a `useCallback`; `validateOneHourBlock` is an O(1) Map lookup
- **Form submission**: single async mutation via TanStack Query
- **Grid refresh**: silent `reload()` (no skeleton flicker), plus realtime

### Known Limitations & Future Enhancements

Most of the original "future" items have since shipped:

- ~~No batch creation~~ → **shipped**: the multi-class batch ("+ Add another class")
- ~~Manual phone entry~~ → **shipped**: `CrmLeadAutofill` (Cratio)
- ~~No conflict detection~~ → **shipped**: `classifySlotConflict()` / `bufferWaivedForCustomer()` in `src/lib/sales-dashboard/conflict.ts`, plus the `schedule_no_overlap_new_rows` exclusion constraint (23P01) as the DB backstop
- Still open: **drag-to-create** (click-and-drag a time range) — selection is still one cell at a time

### Historical Bug Fix (obsolete architecture)

An early "white screen" bug was a `ReferenceError: handleSlotDoubleClick is not defined`, fixed by threading an `onDoubleClick` prop through `AvailabilityGrid → InstructorRowGroup → MiniRow → SlotCell`. **Both the bug and the fix are moot now**: none of those files exist as separate modules, and there is no `onDoubleClick` prop. Kept only so a web search for the old error doesn't send you hunting for files that aren't there.

### Testing Checklist

- [x] Modal renders only when open (variant `"panel"` on the dashboard)
- [x] Form validation prevents empty submissions
- [x] Phone normalization works correctly; masking respects `view_unmasked_customer_phone_numbers`
- [x] Payment status dropdown accepts all three values
- [x] Dashboard silently refreshes after a successful booking
- [x] Slot displays as tentative (yellow) after booking creation
- [x] Click-outside-to-dismiss works
- [x] Dark mode styling applied correctly
- [x] A single click on a free slot opens the form; a taken slot only shows details
- [x] 1-hour block validation prevents partial-hour bookings

## Sales Dashboard — Multi-Class Booking, Override, and Grid Accuracy Fixes

**Status**: ✅ IMPLEMENTED & PRODUCTION-READY. Supersedes/extends the "Tentative Slot Selection & Booking Feature" and "Sales Dashboard Layout & Design" sections above — those describe the original single-slot booking; this section covers everything added afterward.

### Grid color legend (current, authoritative)

| Color          | Meaning                                                                                                                 | CSS class               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| ⚪ White       | **Free — bookable. Nothing else is white.**                                                                             | `.cell-free`            |
| 🟡 Yellow      | Tentative (any payment status — unpaid/half/full paid look the same)                                                    | `.cell-tentative`       |
| 🟣 Purple      | Booked / completed / a real learner booking mid-payment (`pending_payment`) — never overridable from Sales              | `.cell-booked`          |
| 🔵 Blue        | Already added to the in-progress multi-class batch, not yet submitted                                                   | `.cell-pending`         |
| Grey / hatched | Free, but would overlap a class already in the in-progress batch — disabled, `cursor: not-allowed`                      | `.cell-pending-blocked` |
| ⚪ Grey        | Paused, unavailable, a travel-gap buffer, or outside configured business hours — **every** such cell, never alternating | `.cell-band`            |

`.cell-paused` and `.cell-unavailable` still exist in the stylesheet but are **dead** on the main grid: they are only applied in the expanded-calendar branch, and `expandedCalendar` is never passed. `.swatch.busy` (the legend's grey chip) now points at `--gc-band-bg`.

> The busy tone used to be a **zebra band** on alternating hours (`.cell-band` gated by `Math.floor(ti / 2) % 2 === 1`). Because free cells became white in `0ee5943`, half the busy cells read as bookable. The parity gate was removed (`SalesDashboard.tsx`) so `.cell-band` covers every non-free cell.

### Multi-class booking (one customer, several classes in one flow)

A single customer form now carries a batch of 1..N slots instead of forcing Sales to restart the form for every class in a course package.

- **State lives in `SalesDashboard.tsx`, not the modal**: `pendingSlots: SlotPick[]` and `customerFormData: CustomerFormValues` (from `TentativeBookingModal.tsx`) are owned by the parent. This is required, not just tidier — the modal has to _hide_ (not unmount, not reset) while Sales clicks each additional class on the grid behind it, and state owned by the modal wouldn't survive that.
- **"+ Add another class"** (`handleAddAnotherSlot`) hides the modal, arms `addingSlotMode`, shows a persistent banner, scrolls the grid into view, and gives `.grid-wrap` a pulsing yellow border (`.grid-wrap-picking`) so it's obvious where to click next.
- The next **single-clicked** free slot is appended to `pendingSlots` (after an **overlap check** — not just exact-start-time dedup — against every slot already in the batch for the same instructor/date) and the modal reopens with the same form values intact.
- Already-selected classes show **blue** (`.cell-pending`) across their _full_ 1-hour span (both 30-min grid cells) — `resolveInfo` checks `pendingSlots` for a range match (`minute >= startTime && minute < endTime`), not just an exact-start match (an earlier bug only highlighted the first half-hour).
- Any free slot that would **overlap** an already-picked class shows **grey/hatched** (`.cell-pending-blocked`) and is rejected with a clear message if clicked anyway (`handleSlotSelect`'s `addingSlotMode` branch does a real interval-overlap test: `minute < sEnd && sStart < newEnd`).
- **Discard guard**: with 2+ picked classes, clicking another free slot, editing another booking, or closing the form (X / Cancel / Esc / click-away) asks first ("Keep my classes" is a no-op). Editing an existing booking is exempt.
- Each slot row in the modal shows date/time/instructor with a × to remove it (hidden once only one slot remains — Cancel instead).
- **Submit is all-or-nothing**: every slot is re-validated fresh via `validateSlotFresh` (the grid may have changed since any slot was added, possibly minutes earlier); if any one fails, the error names exactly which class and **no insert is attempted at all**. On success, all slots are created via a **single multi-row `.insert([...])` call** — one Postgres statement, so a race-condition conflict on any row (caught by the `schedule_no_overlap_new_rows` exclusion constraint) atomically rolls back the whole batch. This gets true all-or-nothing behavior for free from the existing insert path — no new backend code needed for this one.
- Every row is still `isTentative: true` / `status: "hold"` — never booked, regardless of batch size.

### Editing an existing tentative booking (this **replaced** "Override Slot")

**Override Slot is gone from the Sales Dashboard** as of commit `0ee5943` (2026-10-09): the `override` flag, `handleOverrideClick`, the modal's override mode and its help text were all removed. The replacement is a plain **Edit Booking** on the selected slot.

- A selected tentative slot can be **edited** by:
  - its **creator**, at **any** payment status, or
  - **anyone**, if the slot is **unpaid** (that is how an unpaid hold gets handed to a learner who is now paying)
- **Delete is creator-only.** When another agent edits someone else's hold, the **original creator is preserved**.
- This is client-side plus the existing DB constraints — there is no separate override RPC in the dashboard flow.
- **The RPC still exists and is still in use elsewhere.** `sql/override_tentative_slot.sql` (manual install — DDL needs the Supabase SQL editor, the app's anon key has no DDL access) defines `override_tentative_slot(p_old_schedule_id bigint, p_new_tentative_details jsonb)`. It is used by **Instructor Management** (`src/routes/admin/instructors.tsx`), so **do not delete the file**.
  - It re-reads the old row fresh (`FOR UPDATE`), re-checks it is still an unpaid tentative hold and that the new `tentative_details` says `half_paid`/`full_paid`, then deletes the old row and inserts the replacement **at the old row's own instructor_id/date/start_time/end_time** — never a slot the client passes in — in one transaction.
  - After editing its signature, run `NOTIFY pgrst, 'reload schema';` (or wait ~30-60s) or PostgREST serves a stale cache and reports `Could not find the function public.override_tentative_slot(...)`.
  - It does **not** touch `schedule_no_overlap_new_rows` — that constraint is relied on as-is.

### Grid accuracy fixes (found via live tester bug reports, verified against real DB rows before fixing)

- **Adjacent-block priority**: `resolveInfo`'s status lookup used to take whichever DB row matched _first_ in array order when scanning for what covers a given minute, without distinguishing a genuine direct match (`minute` literally inside that block's own `[startMinute, endMinute)`) from a match only reached via gap-buffer extension from a **different**, earlier block. When one real block sits immediately before another (e.g. a paused class followed by a booked one with no gap), the first block's buffer reach could cover the second block's own actual start — showing it as "Buffer for [wrong thing]" instead of its real status. Fixed: a direct match always wins over a buffer-only match, regardless of iteration order.
- **Paused buffer labeling**: the "paused" status branch was the one status that never checked `isBuffer` (unlike booked/completed/hold, which already did) — always said plain "Paused" even for its own travel-gap buffer. Now says "Buffer for Paused class" when appropriate.
- **Display range == bookable range** (a 24-hour grid was tried and **reverted** the same day): `useSalesData.ts` sets `timeStartsRef.current = candidateStartMinutes(config)`, so the **visible** columns are exactly the configured `slot_start`…`slot_end` window (06:00–22:00 → columns 06:00…21:00). A commit that made the grid span 00:00–23:30 was rolled back by `03d73ca`; do **not** restore it. Because the window matches, no main-grid column is "outside business hours" — that label only fires in the expanded timetable (which shows wider hours). The effective last column is `slot_end - slot_duration_minutes`, not the raw `slot_end`, because `candidateStartMinutes` requires `start + duration <= slotEnd` (a full class must fit).
- Several tester-reported claims didn't match current DB data on re-verification (e.g. a status reported as "paused" was actually "booked" by the time it was checked) — always re-query the actual `Schedule` row before assuming a display bug; the underlying data may have changed between report and investigation.

### Standalone GitHub Pages test deployment

A separate, **test-only** static deploy of the full `inlane-web-app` (not just the dashboard) exists for external testers, pushed to `github.com/divyanshpal-inlane/sales-requirement-dashboard` and built via `.github/workflows/deploy.yml` in that repo → live at `https://divyanshpal-inlane.github.io/sales-requirement-dashboard/`.

- This is **not** the production deployment (that's still Vercel, auto-deployed from `main` — see `DEPLOYMENT.md`).
- `vite.config.ts`'s `base` reads `process.env.VITE_BASE_PATH` (only set in that repo's workflow); `src/App.tsx`'s `<BrowserRouter basename={import.meta.env.BASE_URL}>` follows it. Both are no-ops everywhere else (local dev, Vercel), since the env var is unset there.
- **GitHub Pages has no backend** — anything depending on the Go API (`/go-api/*`: most auth, payments, scheduling) will not work there. Only flows that talk to Supabase directly from the client have a chance of working.
- The workflow injects `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`/`VITE_GOOGLE_MAPS_API_KEY` from that repo's GitHub Actions **variables** (not secrets — none of these three are sensitive) plus a **placeholder** (never the real value) for `VITE_SUPABASE_SERVICE_ROLE_KEY`, purely so `src/context/auth-context.tsx`'s module-top-level `createClient(supabaseUrl, supabaseServiceKey)` doesn't throw and blank the whole app on load.
- ⚠️ **Separately discovered, unrelated to this deployment**: `VITE_SUPABASE_SERVICE_ROLE_KEY` (a real secret — full DB access, bypasses RLS) is read via `import.meta.env` in `auth-context.tsx`, meaning Vite bundles the **real** key into the client-side JS on **every** build, including the production Vercel one. This is a pre-existing vulnerability, not something introduced by the test deploy, and still needs its own fix (move whatever `supabaseAdmin` is used for behind a real backend call).

## Additional Resources

- `README.md` — Quick start
- `AGENTS.md` — the compact, high-signal agent reference (read this first)
- `DEPLOYMENT.md` — Deployment specifics and gotchas
- `ADMIN_FLOW_ANALYSIS.md` — Admin feature documentation
- `tests.md` — Manual/automated checklist for the sales tentative-booking system
- `docs/Game_Analytics.md` / `docs/Learning_Analytics.md` — Analytics systems
- `docs/admin-schedule-consistency.md`, `docs/onboarding-scheduling-queue.md` — Scheduling invariants
- `SALES_DASHBOARD_DB_MIGRATION.md`, `REALTIME_DELETE_REPLICA_IDENTITY.md` — Sales Dashboard DB/realtime notes

> `API_Documentation/` (previously linked here) **does not exist** in this repo.
