# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**InLane Web App** is a comprehensive driving school management platform built with React, TypeScript, and Vite. It supports multiple user roles (learners, instructors, admins) with role-based routing, real-time scheduling, payments via Razorpay, Google Calendar integration, and learning analytics.

### Tech Stack

- **Frontend**: React 18, TypeScript 5.5, Vite 5.2
- **Styling**: Tailwind CSS with custom Radix UI components
- **State Management**: React Context (auth, phone visibility), TanStack Query for server state
- **Backend**: Go service (via `/go-api` proxy), Supabase (PostgRES, edge functions)
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

## Architecture

### Project Structure

```
src/
  app/          # Feature-specific pages (instructor, learner flows)
  components/   # Reusable UI components (ui/, layout/, lesson/, etc.)
  routes/       # Route definitions for admin, learner, instructor paths
  pages/        # Legacy page components (being migrated)
  services/     # Feature flags via featureFlagService.ts
  context/      # React Context providers (auth, phone visibility)
  hooks/        # Custom React hooks
  queries/      # TanStack Query hooks (organized by domain)
  lib/          # Utilities (supabaseClient, calendarUtils, geoUtils, etc.)
  types/        # TypeScript type definitions
  constants/    # App-wide constants
  utils/        # Shared utility functions
  assets/       # Static images, icons
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
- **Direct Booking** (new): `get-booking-config`, `get-booking-slots`, `create-booking`, `change-booking-slot`, `confirm-booking`

Deployed manually: `supabase functions deploy <name>`

### Third-Party Integrations (24 services)

| Service                 | Purpose                                 | Auth Method                 |
| ----------------------- | --------------------------------------- | --------------------------- |
| **Razorpay**            | Payment gateway                         | API key + webhook signature |
| **ICICI Orange PG**     | Payment gateway (v2 HMAC-SHA256 signed) | MERCHANT_ID + SECRET_KEY    |
| **Heltar**              | WhatsApp messaging (40+ templates)      | Bearer token                |
| **Exotel**              | Learner↔Instructor masked calls        | Basic auth                  |
| **MSG91**               | Instructor↔KAM click-to-call           | authkey header              |
| **Google Calendar API** | Instructor calendar sync                | OAuth2 + bearer token       |
| **Google Maps**         | Address autocomplete + geocoding        | API key                     |
| **Google Analytics 4**  | Event tracking (signups)                | Measurement Protocol        |
| **OpenAI**              | Chatbot (gpt-4o-mini)                   | Bearer token                |
| **Cratio CRM**          | Lead ingestion                          | Webhook URLs                |
| **Cal.com**             | Booking appointments                    | Bearer token                |
| **Gmail SMTP**          | Transactional email                     | Username/password TLS       |

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

## Sales Requirement Dashboard (Incoming Feature)

**Status**: New feature repo at `D:\KodeLand\LANE\Lane-sales-requirement` — to be integrated into main app.

### Overview

A **read-only instructor availability dashboard** (React 19 + TypeScript + Vite) that displays real-time instructor free/busy slots in a Google Calendar-like grid interface. Fetches live `Schedule` + `Instructor` data from Supabase and renders 30-minute slot granularity with search, location filtering, and expandable full-schedule views.

**Tech Stack:**

- **Framework**: React 19, TypeScript 5.x, Vite 5.x
- **Styling**: CSS + theme variables (dark/light toggle, localStorage persistence)
- **Maps**: Google Maps JS API (Places autocomplete + geocoding, optional; location search degrades gracefully without it)
- **Geospatial**: KML polygon/point matching via ray-casting + Haversine distance
- **Build/Deploy**: GitHub Pages via `.github/workflows/deploy.yml` + Vercel variables

**Key Features:**

- **Live availability grid**: Color-coded free (green) / booked (other) slots in 30-min increments
- **Search & compare**: Multi-select instructor comparison mode; toggle "Add" / "Compare" buttons
- **Location-based filtering**: Manual lat/lng input or Google Places autocomplete; geospatial zone matching via KML
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

- Returns `SalesData` object: `phase` (loading/error/ready), `config`, `dates`, `timeStarts`, `allInstructors`, `instructors`, `loading` (skeleton rows), `errors`, `freeGrid`, `blocks`, `reload()`, `loadInstructors()`, `removeInstructor()`
- Computes `freeGrid: Map<instructorId, Map<date, number[]>>` of free minutes via `buildInstructorFreeGrid()`
- Paginated queries (1000-row chunks), chunked by instructor ID (60 per batch) to respect Supabase limits

**Slot computation: `src/lib/availability.ts`**

- `buildInstructorFreeGrid()`: intersects unavailability, Schedule statuses, booked classes, travel gaps
- `candidateStartMinutes()`: generates time grid (e.g., 06:00–22:00 in 30-min increments)
- `isTimeUnavailable()`: point-in-time query for instructor unavailability rules
- Excludes statuses in `excluded_schedule_statuses` from free-slot calc (e.g., `cancelled`, `rejected`)

**KML & geospatial: `src/lib/kml.ts`**

- `public/instructors.kml` is the single source of truth for service zones (polygons) + point markers
- `matchLocation(zones, point)`: point-in-polygon (ray-casting) for polygons, Haversine proximity (3 km) fallback for points
- Instructor names matched via `KML_ALIASES` + fuzzy normalization (DB has 120 instructors, KML may have spelling variants)
- **Quirk**: On-break instructors (`status: on_break/paused/disabled`) are normally excluded from default roster, but if matched by KML location, they appear with real free-slot counts and no break badge
- DB `Instructor.areas` field is **not used**; KML is the authoritative geo-filter

**Configuration: Supabase `app_settings`**

```json
{
  "key": "booking_flow",
  "value": {
    "booking_days_ahead": 14,
    "view_days_ahead": 400,
    "slotStart": "06:00",
    "slotEnd": "22:00",
    "gridMinutes": 30,
    "instructor_gap_minutes": 15,
    "excluded_schedule_statuses": ["cancelled", "rejected"]
  }
}
```

### Integration Points with Main App

**Data dependencies:**

- `Instructor` table: `id, name, areas, gender, status, enabled, unavailability` (JSON)
- `Schedule` table: `instructor_id, learner_id, course_id, lesson_id, date, start_time, end_time, status, isTentative, tentative_details`
- `Learner` table: `id, name, phone` (for slot detail popovers)
- `Courses` table: `id, name` (for slot detail popovers)
- `app_settings` table: row with `key = 'booking_flow'` (config JSON)

**UI/UX alignment:**

- Styling mirrors existing app theme (Tailwind-inspired, dark/light toggle)
- Phone masking uses same `maskPhoneNumber()` utility and respects `view_unmasked_phone_numbers` permission
- Location search uses same Google Maps integration pattern as main app

**Deployment:**

- Will be a separate route in the main app (e.g., `/sales-dashboard` or similar)
- Same Supabase project, same Vercel environment variables
- GitHub Pages deployment via same workflow pattern (inject `VITE_SUPABASE_*`, `VITE_GOOGLE_MAPS_API_KEY`)

### Key Implementation Details

**Grid rendering: `src/components/AvailabilityGrid.tsx`**

- Memoized component; header row (times), body rows per instructor
- Expandable rows (`.row`, `.row-selected`, `.row-loading`, `.row-gap`) → nested `.detail-row` with mini full-schedule grid
- Cell states: `.cell-free` (green), `.cell-band` (alternating bg), `.cell-selected` (popover open)
- Sticky `thead`, sticky `.instructor-cell` (left column) for horizontal scroll with popovers above

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

**Wiring into main app:**

1. Copy repo contents to a new directory (e.g., `src/routes/sales-dashboard/` or as a separate integrated module)
2. Update routing in `src/App.tsx` to mount the dashboard at a new path (likely protected via `ProtectedAdminRoute` or similar)
3. Ensure `.env` includes `VITE_GOOGLE_MAPS_API_KEY` if location search is enabled
4. Verify `app_settings` row exists in Supabase with `key = 'booking_flow'` and a populated JSON `value`
5. Test on-break instructor behavior with location search (should show real free slots, no break badge)

**Updating configuration at runtime:**

```sql
UPDATE app_settings
SET value = jsonb_set(value, '{gridMinutes}', to_jsonb(15))
WHERE key = 'booking_flow';
```

### Testing & Verification

**Manual E2E flow:**

1. Start dev server; load dashboard
2. Type instructor name → suggestions appear; click `＋ Add` → loads full instructor with real free counts
3. Click `＋ Compare` on another instructor; summary updates to "Comparing N instructors · X free slots"
4. Test location: enter lat/lng or use Places autocomplete; KML zones match and auto-load instructors
5. Expand instructor row; full timetable opens/closes
6. Toggle theme; dark theme persists to localStorage

**Performance baseline:**

- Startup should be ~450–900 ms (config + light index only, no Schedule queries)
- First instructor load should be ~1–2 s depending on Schedule volume
- Subsequent loads cached by TanStack Query (not currently used in sales-dashboard, but compatible)

## Supabase Tables (Core Schema)

| Table                            | Purpose                | Key Columns                                                                                                                                 |
| -------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Learner`                        | Student profile        | phone, name, email, address, lat/lng, LL status fields                                                                                      |
| `Instructor`                     | Driving instructor     | phone, DL_number, car_make/mode, experience, radius, service areas, unavailability JSON, Google Calendar sync                               |
| `Schedule`                       | Lessons                | instructor_id, learner_id, course_id, lesson_id, date, start/end times, status (booked/ongoing/completed/paused), otp, started_at, ended_at |
| `enrollment`                     | Course progress        | learner_id, course_id, progress (type: course/demo/topup/custom), payment_status, unlocked_lessons                                          |
| `payment`                        | Payment records        | learner_id, amount, payment_type (course/demo/topup/reschedule/custom), status, gateway (icici/razorpay), gateway_reference                 |
| `lesson_tracking`                | GPS tracking           | schedule_id, latitude, longitude, type (start/tracking/end)                                                                                 |
| `reschedule_requests`            | Reschedule bookings    | learner_id, lesson_ids, payment_id, type, status                                                                                            |
| `ll_applications`                | LL journey tracking    | learner_id, status (payment_received → ... → dl_delivered/closed), docs, RTO data                                                           |
| `no_show_fee` / `no_show_appeal` | No-show penalties      | learner_id, amount (₹300), fee_type, status, appeal_reason                                                                                  |
| `instructor_earning_adjustment`  | Bonuses/corrections    | instructor_id, type (adjustment/bonus/referral), amount (±), reason, effective_date                                                         |
| `app_settings`                   | Feature flags + config | key (booking_flow, payment_gateway_mode), value JSON                                                                                        |

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
5. **Phone visibility context**: Phone numbers have a shared visibility toggle via `PhoneVisibilityProvider` — check context if adding phone display
6. **pnpm strict mode**: Some deps won't build on Vercel unless explicitly allowed in `pnpm-workspace.yaml`
7. **Dual auth stack**: Auth flows support both Go and Supabase (feature-gated); new flows use Go, fallback to Supabase
8. **Completion logic duplication**: Payment completion pipeline exists in 3 places (`payment-callback`, `_shared/complete-payment.ts`, `src/constants/courses.ts`) — keep in sync
9. **Phone normalization inconsistency**: DB stores phones in 4 variants (raw 10-digit, `+91…`, etc.); queries match on all formats
10. **No-show fee policy**: ₹300 charged if rescheduling <10 hours before; appeals allow waiver/reversal by admin

## Testing

No test framework is currently set up. To add tests, consider:

- **Unit/Integration**: Vitest (lightweight, Vite-native)
- **Component**: React Testing Library (already in React ecosystem)
- **E2E**: Playwright or Cypress

## Debugging & Troubleshooting

- **Payment stuck**: Use `recover-razorpay-payment` edge function in admin LearnerIssueFixer page
- **Edge function not deployed**: Always run `supabase functions deploy` after `supabase/functions/*` changes
- **Feature flag not applying**: Check `isFeatureEnabled()` cache (2-min TTL) and backend flag config
- **Go auth failing**: Backend must be running locally (`http://localhost:8080`); check env `VITE_BACKEND_API`
- **Phone masking not working**: Verify `PhoneVisibilityProvider` is in app tree and permission `view_unmasked_phone_numbers` is set

## Sales Dashboard Slot Booking Feature

**Status**: ✅ IMPLEMENTED & PRODUCTION-READY

### Overview

The Sales Dashboard now includes integrated tentative slot booking functionality. Sales agents can search for instructors by location, view their availability calendar, and create provisional (tentative) lesson blocks directly from the dashboard.

### Key Components

- **TentativeBookingModal** (`src/components/admin/sales-dashboard/TentativeBookingModal.tsx`): Form for collecting customer and booking details
- **SlotCell Double-Click Handler** (`src/routes/admin/SalesDashboard.tsx`): Triggers tentative booking flow on double-click
- **1-Hour Block Validator** (`src/lib/sales-dashboard/availability.ts::validateOneHourBlock()`): Ensures full 1-hour slot availability before allowing booking

### How It Works

1. **Single-click** on a 30-minute slot → Shows slot info popup (existing behavior)
2. **Double-click** on a FREE 30-minute slot → Opens TentativeBookingModal
3. Modal validates 1-hour block availability and collects:
   - Customer name, phone (auto-normalized)
   - Sales agent name
   - Payment status (unpaid/half paid/full paid)
   - Customer address
   - Course selection (7 options: demo, 4-6-10-15-20 class courses)
4. On submit → Creates `Schedule` row with:
   - `isTentative = true`
   - `status = 'hold'`
   - `tentative_details` JSON with all customer info
5. Calendar refreshes; slot now shows as tentative/orange
6. Users can create multiple tentative blocks per customer

### Database Integration

- Uses existing `Schedule` table
- Leverages `isTentative` boolean flag and `tentative_details` JSON column
- No new tables required
- Reuses tentative_details schema for consistency with existing Admin Tentative Management flow

### Important Notes

- **Sales-only creation**: This dashboard creates TENTATIVE blocks only, never confirmed bookings
- **Operations approval required**: Tentative blocks become confirmed/booked only after Operations team verifies customer (LL/DL, location match, onboarding) via existing workflows
- **Multiple slots supported**: One customer can have 4-5+ tentative slots across different dates/instructors
- **Reuses existing patterns**: All validation, availability calculation, and database interactions follow established app conventions

### Architecture

```
Sales Dashboard Grid (30-min slots)
  ↓ double-click FREE slot
  → validateOneHourBlock() checks if [start, start+30] both free
  ↓ if available
  → TentativeBookingModal opens
  → User fills form + submits
  ↓
  → Creates Schedule{isTentative:true, tentative_details:{...}}
  ↓
  → Dashboard reloads via reload() callback
  → Slot displays as tentative (existing CSS)
```

### Performance Considerations

- Modal renders only when open
- Double-click handler uses useCallback to prevent re-renders
- Validator runs in O(1) via freeGrid Map lookup
- No new API calls or edge functions needed (uses existing Supabase insert)

### Files Involved

- `src/components/admin/sales-dashboard/TentativeBookingModal.tsx` (370 lines, new)
- `src/lib/sales-dashboard/availability.ts` (+30 lines, new validateOneHourBlock function)
- `src/routes/admin/SalesDashboard.tsx` (+60 lines, modal state + handler)
- All changes maintain backward compatibility with existing Sales Dashboard features

### Testing Notes

- Build succeeds with no new TypeScript errors
- ESLint passes (zero errors)
- Phone normalization uses existing `normalizePhone()` utility
- Form validation prevents empty/invalid submissions
- Success toast auto-closes after 1.5s
- Grid refresh ensures UI stays in sync with database

## Sales Dashboard Layout & Design

**Status**: ✅ FULLY OPTIMIZED & PRODUCTION-READY (Reference design implemented)

### Grid Layout Specifications

The instructor availability grid is built with precise column sizing and sticky positioning to match modern calendar UI patterns.

**Column Widths**:

- **Instructor Column**: 320px (sticky left)

  - Contains: checkbox/icon, "Schedule" button, instructor name, status badges
  - Sticky during horizontal scroll (z-index: 1)
  - Clear 2px right border separator

- **Time Columns**: 44px each (fixed width)
  - Each column represents one 30-minute time slot
  - Equal width ensures perfect alignment
  - Time labels centered within column
  - Consistent across all rows

**Row Heights**:

- **Header Row**: 44px (sticky top, z-index: 2)

  - Time labels aligned center
  - Light gray background (--gc-surface)
  - Font size: 10px, monospace (tabular-nums)

- **Instructor Rows**: 44px

  - Instructor cell: 320px width, left-sticky
  - Time slot cells: 44px width each
  - 1px border right between columns
  - 1px border bottom between rows

- **Row Gap**: 8px (visual separator between instructors)
  - Empty rows provide subtle spacing
  - Maintains visual hierarchy

**Grid Alignment**:

```
Header Row (44px height)
├─ Instructor Label (320px) ────────┬──────┬──────┬──────┐
│  06:00  06:30  07:00  07:30 ...  (44px each time slot)
├─────────────────────────────────────────────────────────┤
Instructor Row 1 (44px)
├─ Instr Name (320px) ────────┼─ Green ┼─ Green ┼ ... (free slots)
├─────────────────────────────────────────────────────────┤
Row Gap (8px)
├─────────────────────────────────────────────────────────┤
Instructor Row 2 (44px)
├─ Instr Name (320px) ────────┼─ Green ┼─ Empty ┼ ... (mixed)
└─────────────────────────────────────────────────────────┘
```

### CSS Layout Properties

**Key CSS Changes** (`src/components/admin/sales-dashboard/sales-dashboard.css`):

```css
/* Table base - perfect alignment */
.grid {
  border-collapse: separate;
  border-spacing: 0; /* No spacing between cells */
  table-layout: fixed; /* Fixed width columns */
}

/* All cells - consistent sizing */
.grid th,
.grid td {
  height: 44px; /* Square proportions */
  border-right: 1px solid var(--gc-border);
  border-bottom: 1px solid var(--gc-border);
  padding: 0; /* No padding - use full cell for content */
  box-sizing: border-box;
}

/* Instructor column header */
.col-instructor {
  width: 320px; /* Fixed wider column */
  position: sticky;
  left: 0;
  z-index: 3; /* Highest z-index */
  border-right: 2px solid var(--gc-border); /* Emphasized separator */
}

/* Time column header */
.col-time-h {
  width: 44px; /* Matches cell width */
  position: sticky;
  top: 0;
  z-index: 2;
  font-variant-numeric: tabular-nums; /* Monospace numbers */
}

/* Slot cells - 44x44 perfect squares */
.cell {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Sticky instructor cell */
.instructor-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  width: 320px;
  display: flex;
  gap: 10px;
  padding: 8px 12px;
  border-right: 2px solid var(--gc-border);
}

/* Row separator */
.row-gap {
  height: 8px;
}
```

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

**Backgrounds**:

- **Header**: `var(--gc-surface)` - light gray
- **Instructor Cell**: `var(--gc-bg)` - white/theme bg
- **Time Cells**:
  - Free: `var(--gc-green-fill)` - light green (#d3ebd9)
  - Hover: `var(--gc-green-hover)` - darker green (#c0ebce)
  - Busy: `var(--gc-bg)` - default background
  - Band: alternating subtle shade for visual rhythm

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

**Status**: ✅ FULLY IMPLEMENTED & PRODUCTION-READY (Fixed white screen issue)

### Feature Overview

Sales agents can now double-click on FREE instructor availability slots in the Sales Dashboard calendar to create tentative lesson bookings. The feature seamlessly integrates with the existing availability grid while maintaining all original single-click functionality.

### User Workflow

1. **View availability**: Sales Dashboard displays instructor schedule in 30-minute slots
2. **Single-click** (existing): Shows slot details popup (instructor name, learner, course, status)
3. **Double-click** (new): Opens TentativeBookingModal if slot is free and 1-hour block available
4. **Fill form**: Enter customer name, phone, sales agent, payment status, address, course
5. **Submit**: Creates Schedule row with `isTentative=true` and customer details in `tentative_details` JSON
6. **Confirmation**: Success toast displays for 1.5s, dashboard refreshes, slot shows as tentative/orange

### Component Architecture

**Component Tree & Prop Flow:**

```
SalesDashboard (defines handleSlotDoubleClick via useCallback)
  ↓ passes onDoubleClick={handleSlotDoubleClick}
  ├→ AvailabilityGrid (GridProps.onDoubleClick)
  │   ↓ extracts from props, passes to children
  │   ├→ InstructorRowGroup (InstructorRowGroupProps.onDoubleClick)
  │   │   ↓ extracts from props, passes to children
  │   │   ├→ SlotCell (renders main grid cells)
  │   │   │   ↓ calls onDoubleClick(instrId, date, minute) on double-click
  │   │   │
  │   │   └→ MiniRow (MiniRowProps.onDoubleClick, renders expanded schedule)
  │   │       ↓ extracts from props, passes to children
  │   │       └→ SlotCell (renders mini schedule cells)
  │   │           ↓ calls onDoubleClick(instrId, date, minute) on double-click
  │
  └→ TentativeBookingModal (isOpen, onClose, onSuccess, data props)
      ↓ accepts slot details passed from handler
      └→ renders form for customer & booking details
```

### Key Interfaces & Type Definitions

**GridProps** (`src/routes/admin/SalesDashboard.tsx:143`)

```typescript
interface GridProps {
  // ... existing props ...
  onDoubleClick?: (instrId: string, date: string, minute: number) => void;
  // Called when user double-clicks a slot cell
}
```

**InstructorRowGroupProps** (`src/routes/admin/SalesDashboard.tsx:315`)

```typescript
interface InstructorRowGroupProps {
  // ... existing props ...
  onDoubleClick?: (instrId: string, date: string, minute: number) => void;
  // Passed through from AvailabilityGrid to child SlotCell/MiniRow components
}
```

**MiniRowProps** (`src/routes/admin/SalesDashboard.tsx:239`)

```typescript
interface MiniRowProps {
  // ... existing props ...
  onDoubleClick?: (instrId: string, date: string, minute: number) => void;
  // Passed through from InstructorRowGroup to SlotCell in expanded schedule
}
```

**SlotCellProps** (`src/routes/admin/SalesDashboard.tsx:168`)

```typescript
interface SlotCellProps {
  // ... existing props ...
  onDoubleClick?: (instrId: string, date: string, minute: number) => void;
  // Called via: onDoubleClick?.({instrId}, {date}, {minute}) when double-click detected
}
```

### Handler Implementation

**handleSlotDoubleClick** (`src/routes/admin/SalesDashboard.tsx:786`)

```typescript
const handleSlotDoubleClick = useCallback(
  (instrId: string, date: string, minute: number) => {
    // 1. Validate 1-hour block availability
    const freeGrid = data?.freeGrid ?? null;
    if (!validateOneHourBlock(instrId, date, minute, freeGrid)) {
      alert(
        "This 1-hour slot is not fully available. Please select a different time.",
      );
      return;
    }

    // 2. Calculate start/end times
    const startTime = minutesToTime(minute);
    const endTime = minutesToTime(minute + 60);

    // 3. Set modal state with slot data
    setTentativeSlotData({ instructorId: instrId, date, startTime, endTime });
    setTentativeModalOpen(true);
  },
  [data?.freeGrid],
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

- **Props**:

  - `isOpen`: boolean — controls modal visibility
  - `onClose`: () => void — dismiss without saving
  - `onSuccess`: () => void — called after successful booking (triggers reload)
  - `data`: { instructorId, date, startTime, endTime } | null — slot details
  - `currentUserName`: string — pre-fills sales agent field

- **Form Fields**:

  - Customer Name (required, text input)
  - Phone Number (required, tel input, auto-normalized via `normalizePhone()`)
  - Sales Agent (required, text input, defaults to current user)
  - Payment Status (dropdown: unpaid / half_paid / full_paid)
  - Customer Address (required, textarea)
  - Course (required, dropdown: demo, 4-6-10-15-20 class courses)

- **Submission**:

  - Validates all required fields before submit
  - Creates Supabase Schedule row with:
    ```typescript
    {
      instructor_id: instrId,
      date: date,
      start_time: startTime,
      end_time: endTime,
      status: "hold",
      isTentative: true,
      tentative_details: {
        name: customerName,
        phone: normalizedPhone,
        sales_agent: salesAgent,
        payment_status: paymentStatus,
        address: customerAddress,
        course: courseId,
        created_at: ISO8601 timestamp
      }
    }
    ```
  - Shows success toast for 1.5s
  - Calls `onSuccess()` to reload dashboard
  - Closes modal automatically

- **Styling**:
  - Uses `.modal-backdrop` and `.modal` CSS classes from `sales-dashboard.css`
  - Proper dark mode support via `data-theme` attribute
  - Click-outside-to-dismiss functionality
  - Responsive sizing: `width: min(680px, 92vw); max-height: 84vh`

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
  course: string,         -- course ID (demo, course_4, course_5, etc.)
  created_at: ISO8601     -- timestamp of tentative booking creation
}
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

- **Modal rendering**: Only renders when `isOpen={true}` (zero cost when closed)
- **Double-click handler**: Memoized via `useCallback([data?.freeGrid])` to prevent re-renders
- **Validation**: O(1) lookup via Map.has() and array includes()
- **Form submission**: Single async mutation via TanStack Query
- **Grid refresh**: Calls dashboard `reload()` which fetches latest Schedule data

### Known Limitations & Future Enhancements

- **Modal only**: Bookings created via modal, not directly in grid (intentional UX design)
- **No batch creation**: One slot at a time (future: bulk import/copy across dates)
- **No drag-to-create**: Double-click only (future: click-and-drag time range)
- **Manual phone entry**: No phone book lookup (future: autocomplete from CRM)
- **No conflict detection**: Doesn't warn if customer already has competing tentative slots

### Bug Fixes Applied (Latest)

**Issue**: White screen appears when selecting instructor name or entering location
**Root Cause**: `ReferenceError: handleSlotDoubleClick is not defined` — handler not passed through component prop chain
**Solution**:

- Added `onDoubleClick` prop to all component interfaces (GridProps, InstructorRowGroupProps, MiniRowProps, SlotCellProps)
- Extracted `onDoubleClick` from props in each component
- Passed handler through full chain from SalesDashboard → AvailabilityGrid → InstructorRowGroup → MiniRow → SlotCell
- Fixed TypeScript type assertions for payment status union type
- Added null coalescing for optional freeGrid parameter
- Added error handling to LocationSearch Google Maps initialization

### Testing Checklist

- [x] Build succeeds with no new TypeScript errors
- [x] ESLint passes (zero errors)
- [x] Type checking passes
- [x] Modal renders only when isOpen={true}
- [x] Form validation prevents empty submissions
- [x] Phone normalization works correctly
- [x] Payment status dropdown accepts all three values
- [x] Success toast auto-closes after 1.5s
- [x] Dashboard reloads after successful booking
- [x] Slot displays as tentative after booking creation
- [x] Click-outside-to-dismiss works
- [x] Dark mode styling applied correctly
- [x] Double-click only works on free slots
- [x] 1-hour block validation prevents partial-hour bookings
- [x] White screen error fixed (prop chain complete)

## Sales Dashboard — Multi-Class Booking, Override, and Grid Accuracy Fixes

**Status**: ✅ IMPLEMENTED & PRODUCTION-READY. Supersedes/extends the "Tentative Slot Selection & Booking Feature" and "Sales Dashboard Layout & Design" sections above — those describe the original single-slot booking; this section covers everything added afterward.

### Grid color legend (current, authoritative)

| Color          | Meaning                                                                                                    | CSS class               |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| 🟢 Green       | Free — bookable                                                                                            | `.cell-free`            |
| 🟡 Yellow      | Tentative (any payment status — unpaid/half/full paid look the same)                                       | `.cell-tentative`       |
| 🟣 Purple      | Booked / completed / a real learner booking mid-payment (`pending_payment`) — never overridable from Sales | `.cell-booked`          |
| 🔵 Blue        | Already added to the in-progress multi-class batch, not yet submitted                                      | `.cell-pending`         |
| Grey / hatched | Free, but would overlap a class already in the in-progress batch — disabled, `cursor: not-allowed`         | `.cell-pending-blocked` |
| Plain/default  | Paused, unavailable, a travel-gap buffer, or outside configured business hours                             | (no color class)        |

### Multi-class booking (one customer, several classes in one flow)

A single customer form now carries a batch of 1..N slots instead of forcing Sales to restart the form for every class in a course package.

- **State lives in `SalesDashboard.tsx`, not the modal**: `pendingSlots: SlotPick[]` and `customerFormData: CustomerFormValues` (from `TentativeBookingModal.tsx`) are owned by the parent. This is required, not just tidier — the modal has to _hide_ (not unmount, not reset) while Sales double-clicks each additional class on the grid behind it, and state owned by the modal wouldn't survive that.
- **"+ Add another class"** (`handleAddAnotherSlot`) hides the modal, arms `addingSlotMode`, shows a persistent banner, scrolls the grid into view, and gives `.grid-wrap` a pulsing yellow border (`.grid-wrap-picking`) so it's obvious where to click next.
- The next double-clicked free slot is appended to `pendingSlots` (after an **overlap check** — not just exact-start-time dedup — against every slot already in the batch for the same instructor/date) and the modal reopens with the same form values intact.
- Already-selected classes show **blue** (`.cell-pending`) across their _full_ 1-hour span (both 30-min grid cells) — `resolveInfo` checks `pendingSlots` for a range match (`minute >= startTime && minute < endTime`), not just an exact-start match (an earlier bug only highlighted the first half-hour).
- Any free slot that would **overlap** an already-picked class shows **grey/hatched** (`.cell-pending-blocked`) and is rejected with a clear message if double-clicked anyway (`handleSlotDoubleClick`'s `addingSlotMode` branch does a real interval-overlap test: `minute < sEnd && sStart < newEnd`).
- Each slot row in the modal shows date/time/instructor with a × to remove it (hidden once only one slot remains — Cancel instead).
- **Submit is all-or-nothing**: every slot is re-validated fresh via `validateSlotFresh` (the grid may have changed since any slot was added, possibly minutes earlier); if any one fails, the error names exactly which class and **no insert is attempted at all**. On success, all slots are created via a **single multi-row `.insert([...])` call** — one Postgres statement, so a race-condition conflict on any row (caught by the `schedule_no_overlap_new_rows` exclusion constraint) atomically rolls back the whole batch. This gets true all-or-nothing behavior for free from the existing insert path — no new backend code needed for this one.
- Every row is still `isTentative: true` / `status: "hold"` — never booked, regardless of batch size.

### Override an unpaid tentative slot (hand it to a paying learner)

**Correct business rule** (an earlier implementation had this backwards — see git history around commit `ae9ac19` for the correction): override does **not** move an unpaid tentative customer to a different slot. It replaces the customer **at the same slot** — an unpaid tentative hold gets handed to a **new, paying** learner (half or full paid only, never unpaid).

- Hovering an unpaid 🟡 tentative slot shows **"🟡 Tentative (Unpaid)"** with an **Override Slot** button. Half/full-paid tentative slots show plain "Tentative" with no override option — once any payment is collected, that slot is protected.
- Clicking **Override Slot** (`handleOverrideClick`) opens the booking modal **immediately for that same instructor/date/time** — no grid picking needed, since there's no "new slot" to choose. The form starts **blank** (new learner, not the same one moving) with Payment Status defaulted to **Half Paid**; **"Unpaid" is not offered as an option at all** in this mode (removed from the `<select>`, not just rejected on submit).
- **Enforcement is server-side, not just frontend**: `sql/override_tentative_slot.sql` (must be run manually in the Supabase SQL editor — no DDL access via the app's anon key) defines `override_tentative_slot(p_old_schedule_id bigint, p_new_tentative_details jsonb)`. It re-reads the old row fresh (`FOR UPDATE`), re-checks it's still an unpaid tentative hold, re-checks the new `tentative_details` actually says `half_paid`/`full_paid`, then deletes the old row and inserts the replacement **at the old row's own instructor_id/date/start_time/end_time** (never anything the client passes in — a client can't redirect an override to a different slot even by tampering with the request) — all in one transaction, so any failure leaves the original untouched.
- After editing this function's signature, **you must run `NOTIFY pgrst, 'reload schema';`** (or wait ~30-60s) for Supabase's PostgREST layer to pick up the change — a stale schema cache produces `Could not find the function public.override_tentative_slot(...)` even after successfully creating it.
- Does **not** modify `schedule_no_overlap_new_rows` — that constraint is relied on as-is.

### Grid accuracy fixes (found via live tester bug reports, verified against real DB rows before fixing)

- **Adjacent-block priority**: `resolveInfo`'s status lookup used to take whichever DB row matched _first_ in array order when scanning for what covers a given minute, without distinguishing a genuine direct match (`minute` literally inside that block's own `[startMinute, endMinute)`) from a match only reached via gap-buffer extension from a **different**, earlier block. When one real block sits immediately before another (e.g. a paused class followed by a booked one with no gap), the first block's buffer reach could cover the second block's own actual start — showing it as "Buffer for [wrong thing]" instead of its real status. Fixed: a direct match always wins over a buffer-only match, regardless of iteration order.
- **Paused buffer labeling**: the "paused" status branch was the one status that never checked `isBuffer` (unlike booked/completed/hold, which already did) — always said plain "Paused" even for its own travel-gap buffer. Now says "Buffer for Paused class" when appropriate.
- **Display range vs. bookable range**: the grid's _visible_ time columns now span the full 24-hour day (00:00–23:30, set in `useSalesData.ts`'s `timeStartsRef`), independent of the shared `booking_flow` config's `slot_start`/`slot_end` (06:00–22:00 by default) — Sales needs to see whatever's actually scheduled, even outside business hours. This is **display-only**: the actual free/busy computation (`slotConfig` passed to `buildInstructorFreeGrid`/`buildDisplayFreeGrid`) still uses the real configured window, since that config is shared with the real learner-facing direct-booking engine — widening it would let real learners book at 2am too. Slots outside the _effectively bookable_ window show as **"Outside business hours"** (not misleadingly generic "Busy") whenever nothing is actually scheduled there. That effective cutoff is `slot_end - slot_duration_minutes`, not the raw `slot_end` — a candidate is only ever evaluated as free/busy if a full class (`slotDurationMinutes`, 60 by default) fits before closing (`candidateStartMinutes` requires `start + duration <= slotEnd`), so with `slot_end: 22:00` the true last-checked minute is 21:00, not 21:30 — using the raw `slot_end` as the boundary left 21:30–22:00 nominally "inside" business hours by a bounds check while still never actually evaluated, showing the same misleading generic "Busy" for a third, different reason.
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
- `DEPLOYMENT.md` — Deployment specifics and gotchas
- `ADMIN_FLOW_ANALYSIS.md` — Admin feature documentation
- `docs/Game_Analytics.md` — Learning analytics system
- `API_Documentation/` — API call map, edge function report, learner/instructor deep-dives
