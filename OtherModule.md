# Changes Outside the Sales Dashboard Module

This file tracks code changes made to modules **other than** the Sales
Dashboard (`src/routes/admin/SalesDashboard.tsx`, `src/hooks/useSalesData.ts`,
`src/components/admin/sales-dashboard/*`) while working on Sales Dashboard
tasks. Sales Dashboard's own changes are documented in `CLAUDE.md` instead —
nothing from there is repeated here.

## Instructor Management — tentative slots now always write `status: "hold"`

**Files changed:**

- `src/routes/admin/instructors.tsx`
- `src/components/admin/TentativeScheduleCard.tsx`

**Why:** Every tentative-slot write path in Instructor Management's "View
Schedule" calendar (`WeeklyScheduleView`) created/updated `Schedule` rows with
`isTentative: true` but never set the `status` column. Left unset, `status`
silently took the table's column default, which is `"booked"` — not `"hold"`.
Instructor Management's own display logic only ever checks `isTentative`
(ignores `status`), so this was invisible there — the slot correctly showed
yellow/tentative in Instructor Management. But the Sales Dashboard's grid
(elsewhere in the app) requires `status === "hold" && isTentative === true`
to classify a slot as tentative — the same convention `TentativeBookingModal`
already used for Sales-created bookings — so the exact same row showed up
there as a real booked class (purple) instead of tentative (yellow).

**What changed:** Added `status: "hold"` to every insert/update payload in
these two files that also sets `isTentative: true`:

- `src/routes/admin/instructors.tsx`
  - `WeeklyScheduleView`'s `tentativeScheduleMutation` — both the "add" insert
    and the "edit" update branch
  - `copyTentativeMutation`'s insert (the "copy to another day/instructor"
    flow)
  - `AddTentativeScheduleMutation`'s bulk multi-row insert (adding several
    tentative lessons for a course package at once)
- `src/components/admin/TentativeScheduleCard.tsx`
  - `mapToScheduleTableSchema()`, used by `addTentativeScheduleMutation`

No behavior in Instructor Management's own UI changes — it never read
`status` for tentative rows in the first place. This only makes the data
consistent for other modules (like Sales Dashboard) that do check it.

**Known pre-existing data impact (not fixed, by explicit decision):** A live
query against the database at the time of this fix found **1,411** existing
`Schedule` rows with `isTentative: true` but `status` other than `"hold"`
(mostly `"booked"`, some `"cancelled"`) — created by this bug before it was
fixed. **836** of those are dated today or later, meaning they were actively
displaying as booked/purple on the Sales Dashboard instead of tentative/
yellow. None of the affected rows have a `learner_id` set, and there's no
code path anywhere that flips `isTentative` back to `false` on confirmation,
so these all appear to be genuinely mislabeled tentative holds rather than
real bookings that happened to match the query. Per explicit user decision,
this existing data was **left untouched** — only the write paths going
forward were fixed. If a bulk correction is wanted later, the safe filter is:

```sql
-- Preview first:
select count(*) from "Schedule"
where "isTentative" = true and status <> 'hold' and learner_id is null;

-- Then, if desired:
update "Schedule"
set status = 'hold'
where "isTentative" = true and status <> 'hold' and learner_id is null;
```

## Instructor Management — now picks up Schedule changes made elsewhere (reverse sync)

**File changed:** `src/routes/admin/instructors.tsx`

**Why:** E2E testing of the Sales Dashboard's booking flow found that
Instructor Management had no way to reflect a `Schedule` change made in
another module (e.g. a tentative slot booked from the Sales Dashboard)
without a manual page reload — the app's global `QueryClient` has
`refetchOnWindowFocus: false`, and neither of Instructor Management's two
schedule views had any other auto-refresh mechanism. The Sales Dashboard
side of this (reacting to changes made elsewhere) was already built in an
earlier pass — this closes the gap in the other direction.

**What changed:** Added a `postgres_changes` subscription on the `Schedule`
table in both places Instructor Management displays a schedule:

- `InstructorsManagement` (the list page component that powers the "View
  Schedule" dialog / `WeeklyScheduleView`): subscribes broadly to any
  `Schedule` change and calls `queryClient.invalidateQueries({queryKey:
  ["instructors"]})` — the same invalidation this component already
  performs after its own tentative-schedule mutations succeed. Broad
  (not filtered to one instructor) because this list can have many
  instructors' schedules loaded — and displayed inline via each row's own
  embedded `schedules` field — at once.
- `InstructorSchedulePage` (the full per-instructor schedule route):
  subscribes with a server-side filter (`instructor_id=eq.<id>`) scoped to
  just that page's instructor, invalidating `["instructor-full", id]`.

**Still required:** the same manual step already noted for the Sales
Dashboard's own realtime subscription — Supabase Realtime replication must
be enabled for the `Schedule` table (`alter publication supabase_realtime
add table "Schedule";` in the SQL editor, or Database → Replication in the
dashboard). Confirmed via a live probe subscription that this has **not**
been enabled yet — until it is, both of these subscriptions connect
successfully but never actually receive an event, so reverse sync stays
inert (falls back to requiring a manual reload, same as before this
change).

**Update:** replication has since been enabled and verified live. Also
found and fixed a follow-up gap: Postgres's default `REPLICA IDENTITY`
means a DELETE event's payload only ever carries the deleted row's primary
key, not `instructor_id` — so deletions were silently not triggering any
refresh at all on either page. `InstructorSchedulePage`'s subscription now
uses a separate unfiltered handler for DELETE specifically (its filtered
INSERT/UPDATE handlers are unaffected). The full fix (`REPLICA IDENTITY
FULL` on `Schedule`) is proposed in `REALTIME_DELETE_REPLICA_IDENTITY.md`.

## Instructor Management — fixed row compression/overlap on short viewports (no scroll)

**File changed:** `src/routes/admin/instructors.tsx` (`InstructorSchedulePage`)

**Why:** Testing team reported "no scrolling option to easily navigate through
the times" on the full per-instructor schedule page. Verified via direct DOM
inspection (Playwright, 1280x500 viewport) before changing anything: the time
axis and grid-cells columns both used `gridTemplateRows: repeat(N, 1fr)`,
which compresses every row to whatever height evenly fits the container no
matter how short it is, instead of scrolling. At 500px tall, rows shrank to
~21px while a scheduled block's own absolutely-positioned content stayed at
its real height, so blocks visually overflowed into neighboring rows —
a real rendering bug, not just an inconvenience.

**What changed:**

- Added `timeAxisRef`/`gridCellsRef` and a `syncScroll(from)` handler that
  mirrors one panel's `scrollTop` onto the other, so the time labels and the
  grid cells scroll together (the "frozen column" pattern already used
  elsewhere in the app for horizontal scroll, applied here vertically).
- Wrapped the time-axis labels and the grid-cells panel each in their own
  `overflow-y-auto` container with `onScroll={syncScroll(...)}`.
- Changed both panels' `gridTemplateRows` from `repeat(N, 1fr)` to
  `repeat(N, minmax(44px, 1fr))` — rows now never compress below 44px;
  the container scrolls instead once content no longer fits.

Verified with the same DOM-inspection probe post-fix: at 500px height, rows
now stay at their real (43-44px) height with the containers reporting
`overflow-y: auto` and no clipped/overflowing block content, and a
scroll-sync check confirmed setting the grid panel's `scrollTop` moves the
time-axis panel's `scrollTop` to match. `npx tsc --noEmit` and `npx eslint`
before/after diffs confirmed zero new type errors and zero new lint errors
(one run of `eslint --fix` was needed to reformat the new JSX indentation
back to the project's Prettier style). No DB or other-module changes.

## Instructor Management — hover tooltips for unavailable slots

**Files changed:** `src/routes/admin/instructors.tsx`
(`WeeklyScheduleView` and `InstructorSchedulePage`)

Both calendar views already colored empty unavailable cells differently
from free ones, but gave no explanation on hover. Added a `title` attribute
to each. The underlying `unavailability` JSON has no free-text reason/note
field, so the tooltip text is necessarily generic ("Instructor unavailable
at this time") rather than naming a specific cause.
