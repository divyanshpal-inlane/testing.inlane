import "@/components/admin/sales-dashboard/sales-dashboard.css";

import { ArrowLeft } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import {
  Fragment,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useNavigate } from "react-router-dom";

import type { LocateStatus } from "@/components/admin/sales-dashboard/LocationSearch";
import type {
  CustomerFormValues,
  SlotPick,
} from "@/components/admin/sales-dashboard/TentativeBookingModal";
import {
  DEFAULT_CUSTOMER_FORM,
  TentativeBookingModal,
} from "@/components/admin/sales-dashboard/TentativeBookingModal";
import { Button } from "@/components/ui/button";
import type {
  BlockDetail,
  InstructorRow,
  LightInstructor,
} from "@/hooks/useSalesData";
import { useSalesData } from "@/hooks/useSalesData";
import {
  isTimeUnavailable,
  validateOneHourBlock,
} from "@/lib/sales-dashboard/availability";
import {
  bufferWaivedForCustomer,
  classifySlotConflict,
} from "@/lib/sales-dashboard/conflict";
import type { KmlZone } from "@/lib/sales-dashboard/kml";
import {
  fetchKmlData,
  matchLocation,
  normalizeName,
  resolveInstructorName,
} from "@/lib/sales-dashboard/kml";
import {
  dateToWeekdayLower,
  minutesToTime,
  timeToMinutes,
} from "@/lib/sales-dashboard/validation";
import type { InstructorWorkingHours } from "@/lib/sales-dashboard/workingHours";
import { inferInstructorWorkingHours } from "@/lib/sales-dashboard/workingHours";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentAdmin } from "@/queries/adminPermissions";
import { useCurrentUser } from "@/queries/userManagement";

const LocationSearch = lazy(
  () => import("@/components/admin/sales-dashboard/LocationSearch"),
);

interface SlotInfo {
  title: string;
  detail: string[];
  // Drives cell background color. "tentative" = yellow (any payment
  // status), "booked" = purple (booked/completed/pending_payment — i.e.
  // a real class, never overridable from Sales). "pending" = blue, a
  // slot already added to the in-progress multi-class batch (Task 19).
  // "pending-blocked" = grey/disabled, a free slot that would overlap a
  // class already in that same batch — can't be added on top of it.
  // Buffer zones and everything else stay "default" (existing plain
  // appearance).
  kind:
    | "free"
    | "tentative"
    | "booked"
    | "pending"
    | "pending-blocked"
    | "default";
  // Set only for a non-buffer, unpaid tentative slot — the one case Sales
  // is allowed to override. Carries what the override action needs
  // without a second lookup.
  override: {
    blockId: number;
    instrId: string;
    date: string;
    startMinute: number;
    endMinute: number;
    tentativeDetails: Record<string, unknown> | null;
  } | null;
  // Set for any non-buffer tentative slot regardless of payment status --
  // unlike override (unpaid only), a wrong entry can be deleted no matter
  // who's already paid something toward it.
  deleteAction: {
    blockId: number;
    instrId: string;
    customerName: string;
  } | null;
}

type SortKey = "freeDesc" | "freeAsc" | "alpha";

const LOCATION_COLORS = [
  "#1a73e8",
  "#e8710a",
  "#188038",
  "#a142f4",
  "#c52828",
  "#00897b",
  "#f4511e",
  "#0d47a1",
  "#6a1b9a",
  "#2e7d32",
  "#00695c",
  "#ad1457",
] as const;

function isBookable(
  instructor: Pick<InstructorRow, "status" | "enabled">,
): boolean {
  return (
    instructor.enabled !== false && (instructor.status ?? "active") === "active"
  );
}

// Distinct from isBookable: enabled === false means the instructor has been
// deactivated/removed and should never be searchable. status !== "active"
// (e.g. "on_break") is a *temporary* state — that instructor still exists
// and a sales rep searching for them by name should be able to find them,
// same as the existing behavior for location-matched on-break instructors
// (see workingOnMap below).
function isDisabled(instructor: Pick<InstructorRow, "enabled">): boolean {
  return instructor.enabled === false;
}

// Short label shown next to an instructor's name wherever they can appear
// (search suggestions, grid rows, location chips) when they're temporarily
// unavailable but still real/searchable — null for active or disabled
// instructors (disabled ones aren't shown in these lists at all).
function statusNote(
  instructor: Pick<InstructorRow, "status" | "enabled">,
): string | null {
  if (instructor.enabled === false) return null;
  const status = instructor.status ?? "active";
  if (status === "active") return null;
  if (status === "on_break") return "On break";
  if (status === "paused") return "Paused";
  return "Unavailable";
}

const EMPTY_LIGHT: LightInstructor[] = [];

// Persists which instructors are currently in the grid roster across a
// page reload — useSalesData's own state is purely in-memory and resets
// on every fresh mount, so without this Sales would have to re-search
// and re-add every instructor from scratch after any refresh.
const ROSTER_STORAGE_KEY = "lane-sales-dashboard-roster";
// Persists the search box text itself, so it's still there (not just the
// resulting grid rows) after a reload.
const SEARCH_STORAGE_KEY = "lane-sales-dashboard-search";
// Persists whether the location map is collapsed, so explicitly closing it
// sticks across a reload instead of reopening every time.
const MAP_COLLAPSED_STORAGE_KEY = "lane-sales-dashboard-map-collapsed";

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function monthLabel(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

function shortDate(iso: string): {
  weekday: string;
  date: string;
  day: string;
} {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString("en-GB", { weekday: "short" }),
    date: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    day: d.toLocaleDateString("en-GB", { day: "numeric" }),
  };
}

function initialTheme(): "light" | "dark" {
  const stored = localStorage.getItem("lane-sales-dashboard-theme");
  return stored === "light" || stored === "dark" ? stored : "light";
}

function showDetailTitle(
  instructor: InstructorRow,
  windowTotal: number,
  days: number,
  workingHours: InstructorWorkingHours,
): string {
  const areas =
    instructor.areas.length > 0 ? `Areas: ${instructor.areas.join(", ")}` : "";
  // Only worth stating when it's actually narrower than the shared
  // booking-flow window -- otherwise every instructor with no bracket in
  // their own unavailability data would repeat the same global hours.
  const hours = workingHours.isDerived
    ? `Hours: ${workingHours.start}–${workingHours.end}`
    : "";
  const daysOff =
    workingHours.daysOff.length > 0
      ? `Off: ${workingHours.daysOff.map((d) => d[0].toUpperCase() + d.slice(1)).join(", ")}`
      : "";
  return [
    areas,
    hours,
    daysOff,
    `${windowTotal} free slots across ${days} days`,
  ]
    .filter(Boolean)
    .join(" · ");
}

interface GridProps {
  instructors: InstructorRow[];
  freeGrid: Map<string, Map<string, number[]>>;
  freeSets: Map<string, Set<number>>;
  windowTotals: Map<string, number>;
  timeCols: string[];
  timeStarts: number[];
  dates: string[];
  selectedDate: string;
  gridMinutes: number;
  slotStart: string;
  slotEnd: string;
  expanded: Set<string>;
  // The one row (if any) whose expand/collapse toggle is still being
  // applied via startTransition -- see toggleExpand/isExpandPending.
  pendingExpandId: string | null;
  selectedRows: Set<string>;
  rowColors: ReadonlyMap<string, string>;
  loadingRows: LightInstructor[];
  onToggleExpand: (id: string) => void;
  onToggleSelectRow: (id: string) => void;
  onRemove?: (id: string) => void;
  onDoubleClick?: (instrId: string, date: string, minute: number) => void;
  onOverrideClick?: (override: NonNullable<SlotInfo["override"]>) => void;
  onDeleteTentative?: (action: NonNullable<SlotInfo["deleteAction"]>) => void;
  resolveInfo: (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
  ) => SlotInfo;
}

interface SlotCellProps {
  instrId: string;
  date: string;
  minute: number;
  free: boolean;
  band: boolean;
  timeLabel: string;
  canBook1Hour?: boolean;
  onDoubleClick?: (instrId: string, date: string, minute: number) => void;
  onOverrideClick?: (override: NonNullable<SlotInfo["override"]>) => void;
  onDeleteTentative?: (action: NonNullable<SlotInfo["deleteAction"]>) => void;
  resolveInfo: (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
  ) => SlotInfo;
}

function SlotCellInner({
  instrId,
  date,
  minute,
  free,
  band,
  timeLabel,
  canBook1Hour,
  onDoubleClick,
  onOverrideClick,
  onDeleteTentative,
  resolveInfo,
}: SlotCellProps) {
  const [isHovered, setIsHovered] = useState(false);
  // Computed on every render, not just while hovered — kind drives the
  // cell's background color (yellow tentative / purple booked), which
  // must be visible at a glance, not only on hover.
  const info = resolveInfo(instrId, date, minute, free);
  const cls = ["cell"];
  // info.kind's pending states take priority over the plain free/busy
  // look — they reflect the in-progress multi-class batch (Task 19),
  // which the DB-derived `free` flag has no way to know about.
  if (info.kind === "pending") {
    cls.push("cell-pending");
  } else if (info.kind === "pending-blocked") {
    cls.push("cell-pending-blocked");
  } else if (free) {
    cls.push("cell-free");
    if (canBook1Hour === false) cls.push("cell-half");
  } else if (info.kind === "tentative") {
    cls.push("cell-tentative");
  } else if (info.kind === "booked") {
    cls.push("cell-booked");
  } else if (band) {
    cls.push("cell-band");
  }
  if (isHovered) cls.push("cell-hovered");
  return (
    <td
      className={cls.join(" ")}
      title={
        info.kind === "pending"
          ? info.title
          : info.kind === "pending-blocked"
            ? "Overlaps a class already in this booking — can't be selected"
            : free
              ? canBook1Hour === false
                ? `Free ${timeLabel} — adjacent slot booked, can't book 1hr`
                : `Free ${timeLabel} — double-click to book 1hr`
              : "Hover for details"
      }
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={() => {
        if (free && onDoubleClick) {
          onDoubleClick(instrId, date, minute);
        }
      }}
    >
      {isHovered && (
        <div className="slot-pop">
          <div className={free ? "pop-title free" : "pop-title busy"}>
            {info.title}
          </div>
          {info.detail.map((line, i) => (
            <div key={i} className="pop-line">
              {line}
            </div>
          ))}
          {info.override && (
            <button
              type="button"
              className="slot-pop-override-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOverrideClick?.(info.override!);
              }}
            >
              Override Slot
            </button>
          )}
          {info.deleteAction && (
            <button
              type="button"
              className="slot-pop-delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteTentative?.(info.deleteAction!);
              }}
            >
              Delete Slot
            </button>
          )}
        </div>
      )}
    </td>
  );
}

// Memoized with stable props (see SlotCellProps) so that opening/closing one
// popover only re-renders the (at most two) cells whose isOpen actually
// changed, instead of every cell in the table — critical once several
// instructors with 400-day schedules are loaded/expanded at once.
const SlotCell = memo(SlotCellInner);

interface MiniRowProps {
  instrId: string;
  d: string;
  isCurrent: boolean;
  timeCols: string[];
  timeStarts: number[];
  gridMinutes: number;
  freeGrid: Map<string, Map<string, number[]>>;
  onDoubleClick?: (instrId: string, date: string, minute: number) => void;
  onOverrideClick?: (override: NonNullable<SlotInfo["override"]>) => void;
  onDeleteTentative?: (action: NonNullable<SlotInfo["deleteAction"]>) => void;
  resolveInfo: (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
  ) => SlotInfo;
}

function MiniRowInner({
  instrId,
  d,
  isCurrent,
  timeCols,
  timeStarts,
  gridMinutes,
  freeGrid,
  onDoubleClick,
  onOverrideClick,
  onDeleteTentative,
  resolveInfo,
}: MiniRowProps) {
  // Computed here (inside the memoized row), not in the parent's map loop —
  // so this Set only gets rebuilt when THIS row actually re-renders, not on
  // every popover click anywhere in the table.
  const dayFree = useMemo(
    () => new Set(freeGrid.get(instrId)?.get(d) ?? []),
    [freeGrid, instrId, d],
  );
  const { weekday, date } = shortDate(d);
  return (
    <tr className={isCurrent ? "mini-row current" : "mini-row"}>
      <td className="mini-date">
        {weekday} {date}
        <span className="mini-count">{dayFree.size}</span>
      </td>
      {timeCols.map((t, ti) => {
        const m = timeStarts[ti];
        const free = dayFree.has(m);
        const band = Math.floor(ti / 2) % 2 === 1;
        const canBook1Hour =
          free && validateOneHourBlock(instrId, d, m, freeGrid);
        return (
          <SlotCell
            key={t}
            instrId={instrId}
            date={d}
            free={free}
            band={band}
            minute={m}
            timeLabel={`${t}–${minutesToTime(m + gridMinutes)}`}
            canBook1Hour={canBook1Hour}
            onDoubleClick={onDoubleClick}
            onOverrideClick={onOverrideClick}
            onDeleteTentative={onDeleteTentative}
            resolveInfo={resolveInfo}
          />
        );
      })}
    </tr>
  );
}

// Memoized so that, within one instructor's expanded 400-day schedule, only
// the one date-row whose popover state actually changed re-renders — not all
// 400. Combined with InstructorRowGroup below, this is what makes clicking a
// slot cost O(1) instead of O(total cells on screen).
const MiniRow = memo(MiniRowInner);

interface InstructorRowGroupProps {
  instr: InstructorRow;
  freeSet: Set<number> | undefined;
  windowTotal: number;
  isExpanded: boolean;
  // True only while THIS row's own expand/collapse is the one still being
  // applied via startTransition (see toggleExpand) -- not a general
  // "something else is loading" flag for other rows.
  isExpandPending: boolean;
  isSelected: boolean;
  rowColor: string | undefined;
  timeCols: string[];
  timeStarts: number[];
  dates: string[];
  selectedDate: string;
  gridMinutes: number;
  slotStart: string;
  slotEnd: string;
  freeGrid: Map<string, Map<string, number[]>>;
  onToggleExpand: (id: string) => void;
  onToggleSelectRow: (id: string) => void;
  onRemove?: (id: string) => void;
  onDoubleClick?: (instrId: string, date: string, minute: number) => void;
  onOverrideClick?: (override: NonNullable<SlotInfo["override"]>) => void;
  onDeleteTentative?: (action: NonNullable<SlotInfo["deleteAction"]>) => void;
  resolveInfo: (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
  ) => SlotInfo;
}

function InstructorRowGroupInner(props: InstructorRowGroupProps) {
  const {
    instr,
    freeSet,
    windowTotal,
    isExpanded,
    isExpandPending,
    isSelected,
    rowColor,
    timeCols,
    timeStarts,
    dates,
    selectedDate,
    onDoubleClick,
    onOverrideClick,
    onDeleteTentative,
    gridMinutes,
    slotStart,
    slotEnd,
    freeGrid,
    onToggleExpand,
    onToggleSelectRow,
    onRemove,
    resolveInfo,
  } = props;
  const workingHours = inferInstructorWorkingHours(
    instr.unavailability,
    slotStart,
    slotEnd,
    dates[0] ?? new Date().toISOString().slice(0, 10),
  );
  const detailTitle = showDetailTitle(
    instr,
    windowTotal,
    dates.length,
    workingHours,
  );

  return (
    <Fragment>
      <tr className={isSelected ? "row row-selected" : "row"}>
        <td className="instructor-cell" title={detailTitle}>
          <button
            type="button"
            className="row-select"
            aria-label={
              isSelected
                ? `Un-highlight ${instr.name}'s row`
                : `Highlight ${instr.name}'s row`
            }
            title="Highlight this row"
            onClick={() => onToggleSelectRow(instr.id)}
          >
            {isSelected ? "●" : "○"}
          </button>
          {rowColor && (
            <span
              className="loc-swatch"
              style={{ background: rowColor }}
              title={`${instr.name}’s zone colour on the map`}
            />
          )}
          <button
            type="button"
            className={isExpanded ? "expand open" : "expand"}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? `Hide ${instr.name}'s full timetable`
                : `Show ${instr.name}'s full timetable`
            }
            title={
              isExpanded
                ? "Hide this instructor's full timetable"
                : "Show this instructor's full schedule across all dates"
            }
            onClick={() => onToggleExpand(instr.id)}
          >
            <span className="expand-chev" aria-hidden="true">
              {isExpanded ? "▲" : "▼"}
            </span>
            <span className="expand-label">
              {isExpanded ? "Hide schedule" : "Schedule"}
            </span>
          </button>
          <button
            type="button"
            className="instructor-name"
            title={detailTitle}
            onClick={() => onToggleExpand(instr.id)}
          >
            {instr.name}
            {statusNote(instr) && (
              <span className="break-badge">{statusNote(instr)}</span>
            )}
          </button>
          {onRemove && (
            <button
              type="button"
              className="remove-instr"
              title={`Remove ${instr.name} from the grid`}
              aria-label={`Remove ${instr.name} from the grid`}
              onClick={() => onRemove(instr.id)}
            >
              ×
            </button>
          )}
        </td>
        {timeCols.map((t, ti) => {
          const m = timeStarts[ti];
          const free = freeSet?.has(m) ?? false;
          const band = Math.floor(ti / 2) % 2 === 1;
          const canBook1Hour =
            free && validateOneHourBlock(instr.id, selectedDate, m, freeGrid);
          return (
            <SlotCell
              key={t}
              instrId={instr.id}
              date={selectedDate}
              free={free}
              band={band}
              minute={m}
              timeLabel={`${t}–${minutesToTime(m + gridMinutes)}`}
              canBook1Hour={canBook1Hour}
              onDoubleClick={onDoubleClick}
              onOverrideClick={onOverrideClick}
              onDeleteTentative={onDeleteTentative}
              resolveInfo={resolveInfo}
            />
          );
        })}
      </tr>
      {(isExpanded || isExpandPending) && (
        <tr className="detail-row">
          <td colSpan={timeCols.length + 1}>
            <div className="detail">
              <div className="detail-header">
                <span className="detail-title">
                  <span className="detail-chev" aria-hidden="true">
                    ▲
                  </span>
                  {instr.name}
                  <span className="detail-badge">full schedule</span>
                </span>
                <span className="detail-sub">
                  {dates.length} days · {windowTotal} free slots
                </span>
                {instr.areas.length > 0 && (
                  <span className="detail-areas">
                    Areas: {instr.areas.join(", ")}
                  </span>
                )}
                <button
                  type="button"
                  className="detail-close"
                  onClick={() => onToggleExpand(instr.id)}
                  aria-label={`Hide ${instr.name}'s full timetable`}
                >
                  Hide schedule ▲
                </button>
              </div>
              {isExpandPending ? (
                // Rendering all `dates.length` (up to 400) MiniRows is
                // genuinely expensive -- without this, clicking "Schedule"
                // visibly froze the page for a moment with no feedback,
                // reading as "nothing happened". toggleExpand wraps the
                // state update in startTransition so this heavy render
                // never blocks the browser from painting this loading row
                // first; isExpandPending is that transition's own pending
                // flag, so it's already true on the very next paint after
                // the click.
                <div className="detail-loading" role="status">
                  Loading {instr.name}&apos;s full schedule…
                </div>
              ) : (
                <table className="mini">
                  <thead>
                    <tr>
                      <th className="mini-date">Date</th>
                      {timeCols.map((t) => (
                        <th key={t} className="mini-time">
                          <span className="time-label">{t}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dates.map((d) => (
                      <MiniRow
                        key={d}
                        instrId={instr.id}
                        d={d}
                        isCurrent={d === selectedDate}
                        timeCols={timeCols}
                        timeStarts={timeStarts}
                        gridMinutes={gridMinutes}
                        freeGrid={freeGrid}
                        onDoubleClick={onDoubleClick}
                        onOverrideClick={onOverrideClick}
                        onDeleteTentative={onDeleteTentative}
                        resolveInfo={resolveInfo}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
      <tr className="row-gap" aria-hidden="true">
        <td colSpan={timeCols.length + 1} />
      </tr>
    </Fragment>
  );
}

// Memoized: since `openPop` is `null` (referentially stable) for every
// instructor except the one whose popover just changed, this bails out
// entirely for all other instructors on every click — including skipping
// their mini-table's 400-row map if expanded.
const InstructorRowGroup = memo(InstructorRowGroupInner);

function AvailabilityGridInner(props: GridProps) {
  const {
    instructors,
    freeGrid,
    freeSets,
    windowTotals,
    timeCols,
    timeStarts,
    dates,
    selectedDate,
    gridMinutes,
    slotStart,
    slotEnd,
    expanded,
    pendingExpandId,
    selectedRows,
    rowColors,
    loadingRows,
    onToggleExpand,
    onToggleSelectRow,
    onRemove,
    onDoubleClick,
    onOverrideClick,
    onDeleteTentative,
    resolveInfo,
  } = props;

  return (
    <table className="roster grid">
      <thead>
        <tr>
          <th className="col-instructor">Instructor</th>
          {timeCols.map((t) => (
            <th key={t} className="col-time-h">
              <span className="time-label">{t}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {instructors.map((instr) => (
          <InstructorRowGroup
            key={instr.id}
            slotStart={slotStart}
            slotEnd={slotEnd}
            instr={instr}
            freeSet={freeSets.get(instr.id)}
            windowTotal={windowTotals.get(instr.id) ?? 0}
            isExpanded={expanded.has(instr.id)}
            isExpandPending={pendingExpandId === instr.id}
            isSelected={selectedRows.has(instr.id)}
            rowColor={rowColors.get(instr.id)}
            timeCols={timeCols}
            timeStarts={timeStarts}
            dates={dates}
            selectedDate={selectedDate}
            gridMinutes={gridMinutes}
            freeGrid={freeGrid}
            onToggleExpand={onToggleExpand}
            onToggleSelectRow={onToggleSelectRow}
            onRemove={onRemove}
            onDoubleClick={onDoubleClick}
            onOverrideClick={onOverrideClick}
            onDeleteTentative={onDeleteTentative}
            resolveInfo={resolveInfo}
          />
        ))}
        {loadingRows.map((li) => (
          <tr key={li.id} className="row row-loading">
            <td className="instructor-cell">{li.name}</td>
            <td colSpan={timeCols.length}>
              <span className="row-loading-msg">Loading schedule…</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const AvailabilityGrid = memo(AvailabilityGridInner);

export default function SalesDashboard() {
  const navigate = useNavigate();
  const {
    phase,
    errorMsg,
    data,
    reload,
    loadInstructors,
    removeInstructor,
    loadInstructorIndex,
    refreshInstructors,
  } = useSalesData();
  // Real, authenticated identity for the "Sales Agent" field on a tentative
  // booking -- previously a free-text field nobody was required to fill in
  // accurately, so there was no reliable way to trace who actually created
  // a given slot. Prefers the admin record (direct query) and falls back
  // to the team-member "user" record (same pattern instructors.tsx uses),
  // since ProtectedAdminRoute allows both roles onto this page.
  const { data: currentAdmin } = useCurrentAdmin();
  const { data: currentUser } = useCurrentUser();
  const currentUserName = currentAdmin?.name || currentUser?.name || "";
  const [filter, setFilter] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [dateIndex, setDateIndex] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Expanding a row renders up to 400 MiniRows (one per visible date) --
  // genuinely expensive, and without this the click visibly froze the page
  // for a moment with no feedback. startTransition keeps that heavy render
  // from blocking the browser's next paint, and isPending (renamed here)
  // drives an immediate "Loading..." row instead (see InstructorRowGroup).
  const [isExpandTransitionPending, startExpandTransition] = useTransition();
  const [pendingExpandId, setPendingExpandId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("freeDesc");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [helpOpen, setHelpOpen] = useState(false);
  const [kmlZones, setKmlZones] = useState<KmlZone[] | null>(null);
  const [kmlError, setKmlError] = useState<string | null>(null);
  const [locSearch, setLocSearch] = useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);
  const [tentativeModalOpen, setTentativeModalOpen] = useState(false);
  // Task 19 (multiple-class booking): one customer form can carry N
  // slots. Both live here, not inside the modal, specifically so they
  // survive the modal hiding/reopening while Sales picks each additional
  // class on the grid (see handleAddAnotherSlot / addingSlotMode below).
  const [pendingSlots, setPendingSlots] = useState<SlotPick[]>([]);
  const [customerFormData, setCustomerFormData] = useState<CustomerFormValues>(
    () => DEFAULT_CUSTOMER_FORM(currentUserName),
  );
  // currentUserName resolves asynchronously (a real DB/edge-function call),
  // so it's almost always still empty at the lazy-init above -- keep
  // salesAgent synced to it as soon as it resolves, and again if it ever
  // changes (e.g. a different admin logs in without a full page reload).
  // Combined with the field being read-only in the modal, this is what
  // actually makes "Sales Agent" trustworthy for tracing who booked a
  // slot, instead of a free-text field nobody was required to fill in
  // accurately.
  useEffect(() => {
    if (!currentUserName) return;
    setCustomerFormData((prev) =>
      prev.salesAgent === currentUserName
        ? prev
        : { ...prev, salesAgent: currentUserName },
    );
  }, [currentUserName]);
  // True while Sales has clicked "+ Add another class" and is picking
  // the next slot for the SAME in-progress batch.
  const [addingSlotMode, setAddingSlotMode] = useState(false);
  // Set while an override is in progress. Unlike the multi-class flow,
  // overriding never needs Sales to pick a slot on the grid — it always
  // replaces the SAME slot the unpaid tentative hold already occupies,
  // for a different (paying) learner. tentativeDetails here is the OLD
  // customer's info, kept only for on-screen reference — the form itself
  // starts blank, since this is a new learner, not the same one moving.
  const [overrideContext, setOverrideContext] = useState<{
    blockId: number;
    tentativeDetails: Record<string, unknown> | null;
  } | null>(null);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);
  const slotNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const successNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const showSlotNotice = useCallback((message: string) => {
    if (slotNoticeTimerRef.current) clearTimeout(slotNoticeTimerRef.current);
    setSlotNotice(message);
    slotNoticeTimerRef.current = setTimeout(() => setSlotNotice(null), 4000);
  }, []);

  // Separate from showSlotNotice (which is styled as a warning) — this is
  // the "your booking actually went through" confirmation, shown on the
  // dashboard itself so it's visible after the modal (which shows its own
  // brief in-modal message before closing) is gone.
  const showSuccessNotice = useCallback((message: string) => {
    if (successNoticeTimerRef.current)
      clearTimeout(successNoticeTimerRef.current);
    setSuccessNotice(message);
    successNoticeTimerRef.current = setTimeout(
      () => setSuccessNotice(null),
      4000,
    );
  }, []);

  // Hides the modal (formData/pendingSlots stay exactly as they are —
  // both live in this component, not the modal) and arms "pick another
  // slot" mode. handleSlotDoubleClick appends the next double-clicked
  // free slot to pendingSlots and reopens the modal.
  const handleAddAnotherSlot = useCallback(() => {
    setTentativeModalOpen(false);
    setAddingSlotMode(true);
  }, []);

  const cancelAddingSlot = useCallback(() => {
    setAddingSlotMode(false);
    setTentativeModalOpen(true);
  }, []);

  const handleRemoveSlot = useCallback((index: number) => {
    setPendingSlots((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleCloseTentativeModal = useCallback(() => {
    setTentativeModalOpen(false);
    setPendingSlots([]);
    setCustomerFormData(DEFAULT_CUSTOMER_FORM(currentUserName));
    setOverrideContext(null);
    setAddingSlotMode(false);
  }, [currentUserName]);

  const handleTentativeSuccess = useCallback(() => {
    showSuccessNotice(
      overrideContext
        ? "✅ Slot handed to the new learner successfully."
        : pendingSlots.length > 1
          ? `✅ ${pendingSlots.length} tentative classes booked successfully.`
          : "✅ Tentative slot booked successfully.",
    );
    // Only the instructor(s) just booked actually changed -- a full
    // reload() would reset phase to "loading" and re-fetch every OTHER
    // instructor in the roster too, showing a disruptive full-page loading
    // screen (which would also hide the success toast above) for no
    // reason. Targeted refresh keeps this to a brief per-row skeleton on
    // just the affected instructor(s).
    const affectedIds = [...new Set(pendingSlots.map((s) => s.instructorId))];
    setTentativeModalOpen(false);
    setPendingSlots([]);
    setCustomerFormData(DEFAULT_CUSTOMER_FORM(currentUserName));
    setOverrideContext(null);
    setAddingSlotMode(false);
    refreshInstructors(affectedIds);
  }, [
    refreshInstructors,
    overrideContext,
    pendingSlots,
    showSuccessNotice,
    currentUserName,
  ]);

  useEffect(() => {
    if (!addingSlotMode) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setAddingSlotMode(false);
        setTentativeModalOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addingSlotMode]);

  useEffect(() => {
    return () => {
      if (slotNoticeTimerRef.current) clearTimeout(slotNoticeTimerRef.current);
    };
  }, []);
  const searchRef = useRef<HTMLDivElement>(null);

  const config = data?.config ?? null;
  const dates = useMemo(() => data?.dates ?? [], [data]);
  const displayGrid = useMemo(
    () => data?.displayGrid ?? new Map<string, Map<string, number[]>>(),
    [data],
  );
  const timeStarts = data?.timeStarts ?? [];

  const months = useMemo(() => {
    const out: string[] = [];
    for (const d of dates) {
      const m = d.slice(0, 7);
      if (out[out.length - 1] !== m) out.push(m);
    }
    return out;
  }, [dates]);
  const activeMonth = months.includes(selectedMonth)
    ? selectedMonth
    : (months[0] ?? "");
  const monthIdx = months.indexOf(activeMonth);
  const goPrev = () => {
    if (monthIdx > 0) {
      setSelectedMonth(months[monthIdx - 1]);
      setDateIndex(0);
    }
  };
  const goNext = () => {
    if (monthIdx < months.length - 1) {
      setSelectedMonth(months[monthIdx + 1]);
      setDateIndex(0);
    }
  };
  const visibleDates = useMemo(
    () => dates.filter((d) => d.startsWith(activeMonth)),
    [dates, activeMonth],
  );

  const safeDateIndex = Math.min(
    dateIndex,
    Math.max(0, visibleDates.length - 1),
  );
  const selectedDate = visibleDates[safeDateIndex] ?? null;

  useOutsideClick(searchRef, () => setSearchOpen(false));

  // Theme is scoped to this component's own wrapper (.sales-dashboard-root),
  // NOT document.documentElement — toggling it must never reskin the rest of
  // the admin app. The wrapper also gets a literal "dark" class (alongside
  // data-theme, which the --gc-* CSS variables key off) purely so
  // Tailwind's darkMode: ["class"] config activates the dark: variants
  // already used inside sales-dashboard components (e.g.
  // TentativeBookingModal) -- those never had a real trigger before, since
  // Tailwind's dark: only ever responds to an ancestor .dark class, not a
  // data-theme attribute.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.setAttribute("data-theme", theme);
    localStorage.setItem("lane-sales-dashboard-theme", theme);
  }, [theme]);

  // Entering "pick a slot on the grid" mode (add-another-class) is easy to
  // miss if the grid is scrolled out of view or the user doesn't notice the
  // modal closed — scroll the grid into view and give it a visible
  // highlighted border for as long as picking mode is active, so it's
  // unmistakable where to click next. (Override no longer needs this — it
  // always reuses the same slot the unpaid hold already occupies, so the
  // modal opens directly with no grid interaction required.)
  const gridWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (addingSlotMode) {
      gridWrapRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [addingSlotMode]);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchKmlData(), loadInstructorIndex()])
      .then(([zones]) => {
        if (active) {
          setKmlZones(zones);
          setKmlError(null);
        }
      })
      .catch((err: unknown) => {
        if (active)
          setKmlError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [loadInstructorIndex]);

  // Restore the instructor roster (and the search box text that found them)
  // from before a page reload, so Sales doesn't have to re-search and
  // re-add every instructor from scratch. useSalesData's own in-memory
  // state resets on every mount (a reload is a fresh page load), so
  // localStorage is the only thing that survives it.
  //
  // Gated on phase === "ready", not plain mount: useSalesData only
  // populates configRef/datesRef (via loadSession(), a network fetch) in
  // the same tick phase flips to "ready". loadInstructors() -> doLoad()
  // silently no-ops if config isn't loaded yet, so calling it unconditionally
  // on mount lost this race almost every time -- the restore looked like it
  // should work but never actually loaded anything.
  const rosterRestoredRef = useRef(false);
  // IDs from localStorage that a restore has asked loadInstructors() to
  // fetch, but that haven't yet shown up in data.instructors or
  // data.errors. Read by the roster-save-back effect below to avoid
  // wiping localStorage while the restore is still in flight -- see the
  // long comment on that effect for why a ref (not state) is required
  // here. null means "no restore is pending" (steady state).
  const pendingRestoreIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (phase !== "ready" || rosterRestoredRef.current) return;
    rosterRestoredRef.current = true;
    try {
      const savedFilter = localStorage.getItem(SEARCH_STORAGE_KEY);
      if (savedFilter) setFilter(savedFilter);

      const saved = localStorage.getItem(ROSTER_STORAGE_KEY);
      if (saved) {
        const ids: unknown = JSON.parse(saved);
        if (Array.isArray(ids)) {
          const validIds = ids.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          );
          if (validIds.length > 0) {
            pendingRestoreIdsRef.current = new Set(validIds);
            void loadInstructors(validIds);
          }
        }
      }
    } catch {
      // Corrupt/unavailable storage (e.g. private browsing) — non-fatal,
      // just means the roster won't restore this time.
    }
  }, [phase, loadInstructors]);

  // Keep the persisted roster in sync with whatever's actually loaded —
  // covers both additions (search/location) and removals (the × button).
  //
  // Guarded on pendingRestoreIdsRef, NOT just "is data.instructors empty":
  // the moment phase first flips to "ready", data becomes non-null with
  // instructors still empty (nothing has finished fetching yet) in the
  // very same React commit the restore effect above reads localStorage
  // and calls loadInstructors() for the saved roster. Because sibling
  // effects in one commit all close over that commit's OWN state
  // snapshot, even checking data.loading here doesn't help -- doLoad's
  // own internal commit() (marking those ids as loading) hasn't been
  // applied to a new render yet either, so data.loading also still reads
  // empty in this exact tick. A ref sidesteps that: pendingRestoreIdsRef
  // is mutated synchronously the moment the restore fires, so it's
  // already correct by the time this effect runs in the same flush.
  // Without this, this effect saw an empty instructors array, assumed
  // there was nothing to save, and immediately wiped the roster the
  // restore effect had just started fetching -- deleting it before it
  // ever got a chance to be re-saved once loaded.
  useEffect(() => {
    if (!data) return;
    const pending = pendingRestoreIdsRef.current;
    if (pending) {
      const stillPending = [...pending].some(
        (id) =>
          !data.instructors.some((i) => i.id === id) && !(id in data.errors),
      );
      if (stillPending) return;
      pendingRestoreIdsRef.current = null;
    }
    try {
      const ids = data.instructors.map((i) => i.id);
      if (ids.length > 0) {
        localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(ids));
      } else {
        localStorage.removeItem(ROSTER_STORAGE_KEY);
      }
    } catch {
      // Storage unavailable — persistence just won't work this session.
    }
  }, [data]);

  // Keep the persisted search text in sync with the search box, so a
  // reload restores what was typed, not just the resulting grid rows.
  // Skipped until the roster restore above has run once, so it doesn't
  // immediately overwrite the just-restored value with the still-empty
  // initial filter state from this same render pass.
  useEffect(() => {
    if (!rosterRestoredRef.current) return;
    try {
      if (filter) {
        localStorage.setItem(SEARCH_STORAGE_KEY, filter);
      } else {
        localStorage.removeItem(SEARCH_STORAGE_KEY);
      }
    } catch {
      // Storage unavailable — persistence just won't work this session.
    }
  }, [filter]);

  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [helpOpen]);

  const toggleExpand = useCallback((id: string) => {
    setPendingExpandId(id);
    startExpandTransition(() => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    });
  }, []);

  // Clears the stale row id once its transition actually settles, so a
  // later render can't misread a leftover pendingExpandId as "still
  // pending" for some other reason.
  useEffect(() => {
    if (!isExpandTransitionPending) setPendingExpandId(null);
  }, [isExpandTransitionPending]);

  const pendingExpandRowId = isExpandTransitionPending ? pendingExpandId : null;

  const addToCompare = (id: string) => {
    loadInstructors([id]);
    setCompareIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setSearchOpen(false);
  };

  const removeFromCompare = useCallback((id: string) => {
    setCompareIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const toggleRoster = (id: string) => {
    if (data?.instructors.some((i) => i.id === id)) removeInstructor(id);
    else loadInstructors([id]);
  };

  const clearLocation = () => {
    setLocSearch(null);
  };

  const allInstructors = data?.allInstructors ?? EMPTY_LIGHT;

  const dbNormNames = useMemo(() => {
    const set = new Set<string>();
    for (const i of allInstructors) set.add(normalizeName(i.name));
    return set;
  }, [allInstructors]);

  const dbByName = useMemo(() => {
    const map = new Map<string, LightInstructor>();
    for (const i of allInstructors) {
      const key = normalizeName(i.name);
      if (!map.has(key)) map.set(key, i);
    }
    return map;
  }, [allInstructors]);

  const instructorsById = useMemo(() => {
    const map = new Map<string, InstructorRow>();
    if (!data) return map;
    for (const i of data.instructors) map.set(i.id, i);
    return map;
  }, [data]);

  const locMatch = useMemo(() => {
    if (!locSearch || !kmlZones) return null;
    const res = matchLocation(kmlZones, {
      lat: locSearch.lat,
      lng: locSearch.lng,
    });
    const ids: string[] = [];
    const resolvedNames = new Map<string, string>();
    for (const name of res.names) {
      const resolved = resolveInstructorName(name, dbNormNames);
      if (!resolved) continue;
      const light = dbByName.get(resolved);
      if (light && !ids.includes(light.id)) {
        ids.push(light.id);
        resolvedNames.set(name, light.id);
      }
    }
    return { ids, zones: res.names, via: res.via, resolvedNames };
  }, [locSearch, kmlZones, dbNormNames, dbByName]);

  useEffect(() => {
    if (locMatch && locMatch.ids.length > 0) loadInstructors(locMatch.ids);
  }, [locMatch, loadInstructors]);

  const locResult = useMemo(() => {
    if (!locMatch || !kmlZones) return null;
    const zoneByName = new Map(kmlZones.map((z) => [z.name, z]));
    const instrs: InstructorRow[] = [];
    const instrColors: Record<string, string> = {};
    const zoneInfo: Record<
      string,
      { color: string; instructorName: string; rawName: string }
    > = {};
    for (const name of locMatch.zones) {
      const lightId = locMatch.resolvedNames.get(name);
      const instr = lightId ? instructorsById.get(lightId) : undefined;
      if (!instr) continue;
      let color = instrColors[instr.id];
      if (!color) {
        color = LOCATION_COLORS[instrs.length % LOCATION_COLORS.length];
        instrColors[instr.id] = color;
        instrs.push(instr);
      }
      zoneInfo[name] = {
        color,
        instructorName: instr.name,
        rawName: zoneByName.get(name)?.rawName ?? name,
      };
    }
    return {
      instrs,
      zones: locMatch.zones,
      via: locMatch.via,
      instrColors,
      zoneInfo,
    };
  }, [locMatch, kmlZones, instructorsById]);

  const rowColors = useMemo(
    () => new Map(Object.entries(locResult?.instrColors ?? {})),
    [locResult],
  );

  const locStatus: LocateStatus = useMemo(() => {
    if (!locSearch) return "idle";
    if (kmlZones === null) return "loading";
    if (locResult && locResult.instrs.length > 0) return "found";
    return "none";
  }, [locSearch, kmlZones, locResult]);

  const toggleSelectRow = useCallback((id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The roster persists across reloads (see ROSTER_STORAGE_KEY), so it can
  // grow large over many sessions if instructors are never explicitly
  // removed -- a reload then restores everything ever added, which reads as
  // "all my past searches suddenly appeared" if it's been a while. Reset
  // clears the roster along with filters/search/selection/sort/location, so
  // it's a genuine single "back to a clean slate" action.
  const resetDashboard = () => {
    const ids = data?.instructors.map((i) => i.id) ?? [];
    for (const id of ids) removeInstructor(id);
    setFilter("");
    setSearchOpen(false);
    setDateIndex(0);
    setExpanded(new Set());
    setCompareIds([]);
    setSort("freeDesc");
    setSelectedMonth("");
    setSelectedRows(new Set());
    clearLocation();
  };

  // Any on-break/paused-but-enabled instructor that's either matched by
  // location OR already explicitly loaded (via name search + Add) is
  // treated as "working" for display purposes — real free counts still show
  // (their schedule/unavailability data is unaffected by this status), with
  // a "break-badge" note next to their name (see statusNote()) so it's clear
  // they're temporarily unavailable. Fully disabled instructors are never
  // included here.
  const workingOnMap = useMemo(() => {
    const set = new Set<string>();
    if (locSearch) {
      for (const i of locResult?.instrs ?? []) {
        if (!isBookable(i)) set.add(i.id);
      }
    }
    for (const i of data?.instructors ?? []) {
      if (!isBookable(i) && !isDisabled(i)) set.add(i.id);
    }
    return set;
  }, [locSearch, locResult, data]);

  // The search bar is only ever for FINDING an instructor to add (via
  // searchResults below) -- it must never also filter what the grid shows,
  // or typing a new name to add hides every already-added instructor that
  // doesn't happen to match, making them look removed.
  const visibleInstructors = useMemo(() => {
    const roster = locSearch
      ? (locResult?.instrs ?? [])
      : (data?.instructors ?? []);
    return roster.filter((i) => isBookable(i) || workingOnMap.has(i.id));
  }, [data, locSearch, locResult, workingOnMap]);

  const searchResults = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return [];
    // Only excludes disabled instructors — an on-break instructor typed by
    // name should still be findable (see isDisabled/isBookable comment).
    return allInstructors
      .filter((i) => !isDisabled(i) && i.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allInstructors, filter]);

  const [locCollapsed, setLocCollapsed] = useState(() => {
    try {
      return localStorage.getItem(MAP_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const toggleLocCollapsed = useCallback(() => {
    setLocCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(MAP_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // Storage unavailable — persistence just won't work this session.
      }
      return next;
    });
  }, []);

  const compareInstructors = useMemo(() => {
    if (!data) return [];
    return compareIds
      .map((id) => data.instructors.find((i) => i.id === id))
      .filter((i): i is InstructorRow => Boolean(i));
  }, [data, compareIds]);
  const inSelectionMode = compareIds.length > 0;

  // displayGrid on purpose, unlike windowTotals/dateTotals below -- this
  // feeds cell coloring (freeSet in AvailabilityGridInner -> free =
  // freeSet.has(m)), where a 30-min-only opening still needs to render as
  // free (canBook1Hour separately downgrades it to the striped .cell-half
  // look rather than solid green). Collapsing this to freeGrid would make
  // that half-free/half-buffer distinction impossible to render at all --
  // see bookableCounts below for the freeGrid-based version used for the
  // "X free" counts/sort order, which is a different requirement from
  // what this feeds.
  const freeSets = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (!selectedDate || !data) return map;
    for (const instr of data.instructors) {
      if (!isBookable(instr) && !workingOnMap.has(instr.id)) continue;
      map.set(
        instr.id,
        new Set(displayGrid.get(instr.id)?.get(selectedDate) ?? []),
      );
    }
    return map;
  }, [data, selectedDate, workingOnMap, displayGrid]);

  // The freeGrid-based (bookable full-hour) counterpart to freeSets above,
  // used anywhere a NUMBER is shown ("X free") or slots are sorted by it --
  // so those always agree with the strict, actually-bookable count
  // windowTotals/dateTotals and the expanded mini-row use, rather than
  // freeSets' more lenient half-hour-opening count.
  const bookableCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!selectedDate || !data) return map;
    for (const instr of data.instructors) {
      if (!isBookable(instr) && !workingOnMap.has(instr.id)) continue;
      map.set(
        instr.id,
        data.freeGrid.get(instr.id)?.get(selectedDate)?.length ?? 0,
      );
    }
    return map;
  }, [data, selectedDate, workingOnMap]);

  // freeGrid, not displayGrid: these are the collapsed-row/date-tab summary
  // counts, and they need to agree with what the expanded view's own count
  // and green cells show (both driven by freeGrid, the strict "a full
  // 1-hour class actually fits here" grid -- see MiniRowInner's dayFree
  // below). displayGrid only requires a 30-min gridMinutes-long opening,
  // which is right for coloring buffer-vs-free half-hour cells but counts
  // scattered half-hour gaps that can't fit an actual class -- e.g. an
  // instructor with classes back-to-back except for a 30-min gap every
  // hour would show as "7 free" in the summary while the expanded view,
  // correctly, shows zero bookable hours. Using the same grid everywhere
  // means the summary number always matches what expanding it shows.
  const windowTotals = useMemo(() => {
    const map = new Map<string, number>();
    if (!data) return map;
    for (const instr of data.instructors) {
      if (!isBookable(instr) && !workingOnMap.has(instr.id)) continue;
      const instrDates = data.freeGrid.get(instr.id);
      let total = 0;
      for (const d of data.dates) total += instrDates?.get(d)?.length ?? 0;
      map.set(instr.id, total);
    }
    return map;
  }, [data, workingOnMap]);

  const dateTotals = useMemo(() => {
    const map = new Map<string, number>();
    if (!data) return map;
    for (const d of data.dates) {
      let total = 0;
      for (const instr of data.instructors) {
        if (!isBookable(instr) && !workingOnMap.has(instr.id)) continue;
        total += data.freeGrid.get(instr.id)?.get(d)?.length ?? 0;
      }
      map.set(d, total);
    }
    return map;
  }, [data, workingOnMap]);

  const sortRoster = useCallback(
    (list: InstructorRow[]): InstructorRow[] => {
      const freeCount = (i: InstructorRow) => bookableCounts.get(i.id) ?? 0;
      switch (sort) {
        case "alpha":
          return [...list].sort((a, b) => a.name.localeCompare(b.name));
        case "freeAsc":
          return [...list].sort(
            (a, b) =>
              freeCount(a) - freeCount(b) || a.name.localeCompare(b.name),
          );
        default:
          return [...list].sort(
            (a, b) =>
              freeCount(b) - freeCount(a) || a.name.localeCompare(b.name),
          );
      }
    },
    [sort, bookableCounts],
  );

  const rows = useMemo(() => {
    return sortRoster(visibleInstructors);
  }, [visibleInstructors, sortRoster]);

  const blocksIndex = useMemo(() => {
    const map = new Map<string, Map<string, BlockDetail[]>>();
    if (!data) return map;
    for (const b of data.blocks) {
      let perDate = map.get(b.instructorId);
      if (!perDate) {
        perDate = new Map<string, BlockDetail[]>();
        map.set(b.instructorId, perDate);
      }
      const list = perDate.get(b.date) ?? [];
      list.push(b);
      perDate.set(b.date, list);
    }
    return map;
  }, [data]);

  // Declared here (after instructorsById/blocksIndex, not before) — this
  // needs both in its dependency array, and referencing a const before its
  // own declaration executes throws a ReferenceError (temporal dead zone),
  // not just a lint nit.
  const handleSlotDoubleClick = useCallback(
    (instrId: string, date: string, minute: number) => {
      // Re-verify instructor is still available
      const instr = instructorsById.get(instrId);
      if (
        !instr ||
        instr.enabled === false ||
        (instr.status ?? "active") !== "active"
      ) {
        showSlotNotice("Instructor no longer available.");
        return;
      }

      // Check for existing tentative block on this slot. Tentative blocks
      // are status === "hold" AND isTentative === true (see resolveInfo's
      // own "hold" -> "Tentative" classification above).
      const existingTentative = blocksIndex
        .get(instrId)
        ?.get(date)
        ?.some(
          (b) =>
            b.status === "hold" && b.isTentative && b.startMinute === minute,
        );
      if (existingTentative) {
        showSlotNotice("Tentative block already exists for this slot.");
        return;
      }

      // Validate 1-hour block availability. A genuine overlap always
      // blocks here. A buffer-only conflict is only let through when
      // we're adding another class to an in-progress batch AND the
      // customer's already-entered phone actually waives it (chaining
      // back-to-back classes for the SAME learner) -- that's the one
      // case where opening the modal anyway is useful. A fresh
      // double-click has no customer yet to justify that, so it would
      // always end up rejected at submit after a wasted form fill; show
      // the same notice a genuine overlap gets instead of opening the
      // modal. (validateSlotFresh still re-checks everything for real
      // right before submit, since the grid can change in the meantime.)
      const gapMinutes = Math.max(
        0,
        Math.floor(config?.instructor_gap_minutes ?? 0),
      );
      const conflict = classifySlotConflict(
        instrId,
        date,
        minute,
        gapMinutes,
        blocksIndex,
      );
      if (conflict.kind === "direct") {
        showSlotNotice(
          "This 1-hour slot is not fully available. Please select a different time.",
        );
        return;
      }
      if (conflict.kind === "buffer") {
        const waived =
          addingSlotMode &&
          bufferWaivedForCustomer(conflict, customerFormData.customerPhone);
        if (!waived) {
          showSlotNotice(
            `This slot doesn't have a full free hour — it's within the instructor's ${gapMinutes}-minute travel-gap buffer around another booking. Please select a different time.`,
          );
          if (addingSlotMode) {
            setAddingSlotMode(false);
            setTentativeModalOpen(true);
          }
          return;
        }
      }

      // classifySlotConflict only ever looks at OTHER bookings
      // (blocksIndex) -- it has no idea about the instructor's own
      // Instructor.unavailability data, so a slot that's free of any
      // conflicting booking but still doesn't have a genuine free hour
      // because it runs into the instructor's own unavailability (or its
      // travel-gap buffer) fell all the way through as conflict.kind ===
      // "free" and got booked for real. The strict freeGrid (the same one
      // canBook1Hour/cell-half already uses for coloring) DOES account
      // for unavailability, so cross-check against it here too. Unlike a
      // buffer against another customer's booking, unavailability can
      // never be waived by anyone, so this is an unconditional block.
      if (
        conflict.kind === "free" &&
        !validateOneHourBlock(instrId, date, minute, data?.freeGrid ?? null)
      ) {
        showSlotNotice(
          "This slot doesn't have a full free hour available for this instructor. Please select a different time.",
        );
        if (addingSlotMode) {
          setAddingSlotMode(false);
          setTentativeModalOpen(true);
        }
        return;
      }

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
        // Task 19: adding another class to the SAME in-progress batch.
        // customerFormData is untouched — it's owned here, not by the
        // modal, so it survived the modal being hidden while this slot
        // was picked.
        // Overlap check, not just an exact-start-time match — e.g. an
        // already-selected 7:00-8:00 class must also block 7:30-8:30 for
        // the same instructor/date, even though their start times
        // differ. An exact-match-only check let both through, since
        // neither the freeGrid (unaware of anything not yet saved to the
        // DB) nor the old check caught the overlap.
        const newEnd = minute + 60;
        const overlapsExisting = pendingSlots.some((s) => {
          if (s.instructorId !== instrId || s.date !== date) return false;
          const sStart = timeToMinutes(s.startTime);
          const sEnd = timeToMinutes(s.endTime);
          return minute < sEnd && sStart < newEnd;
        });
        if (overlapsExisting) {
          showSlotNotice(
            "That slot overlaps with a class already in this booking.",
          );
          setAddingSlotMode(false);
          setTentativeModalOpen(true);
          return;
        }
        setPendingSlots((prev) => [...prev, newSlot]);
        setAddingSlotMode(false);
        setTentativeModalOpen(true);
        return;
      }

      // Fresh booking — reset to a clean single-slot batch and blank
      // customer form.
      setOverrideContext(null);
      setPendingSlots([newSlot]);
      setCustomerFormData(DEFAULT_CUSTOMER_FORM(currentUserName));
      setTentativeModalOpen(true);
    },
    [
      config?.instructor_gap_minutes,
      showSlotNotice,
      instructorsById,
      blocksIndex,
      addingSlotMode,
      pendingSlots,
      currentUserName,
      customerFormData.customerPhone,
      data?.freeGrid,
    ],
  );

  // Fresh re-check of a single pending slot's 1-hour availability, run
  // again right before submit (the grid may have changed since it was
  // added to the batch, possibly minutes ago). Unlike the double-click
  // gate, the customer's phone is known here (it's in the form by now),
  // so a buffer-only conflict can be resolved for real: waived if every
  // conflicting block is a Sales tentative hold for this same phone,
  // rejected otherwise.
  const validateSlotFresh = useCallback(
    (slot: SlotPick): { ok: boolean; reason?: string } => {
      const minute = timeToMinutes(slot.startTime);
      const gapMinutes = Math.max(
        0,
        Math.floor(config?.instructor_gap_minutes ?? 0),
      );
      const conflict = classifySlotConflict(
        slot.instructorId,
        slot.date,
        minute,
        gapMinutes,
        blocksIndex,
      );
      const ok = bufferWaivedForCustomer(
        conflict,
        customerFormData.customerPhone,
      );
      if (ok) {
        // classifySlotConflict only ever compares against OTHER bookings
        // (blocksIndex) -- it has no idea about the instructor's own
        // Instructor.unavailability data. A slot that's clear of any
        // conflicting booking can still fail to have a genuine free hour
        // because it runs into the instructor's own unavailability (or
        // its travel-gap buffer), which only the strict freeGrid (the
        // same one canBook1Hour/cell-half coloring already uses) knows
        // about. Without this cross-check a "half free, half on the
        // instructor's own break" slot silently created a real Schedule
        // row instead of being rejected.
        if (
          validateOneHourBlock(
            slot.instructorId,
            slot.date,
            minute,
            data?.freeGrid ?? null,
          )
        ) {
          return { ok: true };
        }
        return {
          ok: false,
          reason: "not fully available for this instructor",
        };
      }
      // Distinguishes *why* for the error message a sales agent actually
      // sees -- "no longer available" alone reads the same for a genuine
      // double-booking as for a buffer-only conflict with someone else's
      // booking, when only the latter is about the instructor needing
      // travel time, not the slot itself being taken.
      const reason =
        conflict.kind === "buffer"
          ? `within the instructor's ${gapMinutes}-minute travel-gap buffer around another booking`
          : "already booked";
      return { ok: false, reason };
    },
    [
      config?.instructor_gap_minutes,
      blocksIndex,
      customerFormData.customerPhone,
      data?.freeGrid,
    ],
  );

  // Override always replaces the SAME slot the unpaid tentative hold
  // already occupies — for a different, paying learner. No grid picking
  // needed: open the modal immediately for that exact instructor/date/time,
  // with a blank form (this is a new learner, not the same one moving) and
  // paymentStatus pre-set to "half_paid" as a sensible starting point,
  // since the form won't accept "unpaid" in this mode (enforced in
  // TentativeBookingModal, and again server-side in the RPC).
  const handleOverrideClick = useCallback(
    (override: NonNullable<SlotInfo["override"]>) => {
      const instr = instructorsById.get(override.instrId);
      setOverrideContext({
        blockId: override.blockId,
        tentativeDetails: override.tentativeDetails,
      });
      setPendingSlots([
        {
          instructorId: override.instrId,
          instructorName: instr?.name ?? "",
          date: override.date,
          startTime: minutesToTime(override.startMinute),
          endTime: minutesToTime(override.endMinute),
        },
      ]);
      setCustomerFormData({
        ...DEFAULT_CUSTOMER_FORM(currentUserName),
        paymentStatus: "half_paid",
      });
      setTentativeModalOpen(true);
    },
    [instructorsById, currentUserName],
  );

  // Lets Sales fix a wrong entry (e.g. a typo'd name/phone or a slot picked
  // by mistake) without needing Operations or Instructor Management —
  // unlike override, this works regardless of payment status, since it's
  // just removing a mistaken hold rather than handing the slot to someone
  // else.
  const handleDeleteTentative = useCallback(
    (action: NonNullable<SlotInfo["deleteAction"]>) => {
      if (
        !window.confirm(
          `Delete the tentative slot for ${action.customerName}? This can't be undone.`,
        )
      ) {
        return;
      }
      void supabase
        .from("Schedule")
        .delete()
        .eq("id", action.blockId)
        .then(({ error }) => {
          if (error) {
            showSlotNotice(`Couldn't delete slot: ${error.message}`);
            return;
          }
          showSuccessNotice("Tentative slot deleted.");
          refreshInstructors([action.instrId]);
        });
    },
    [refreshInstructors, showSlotNotice, showSuccessNotice],
  );

  const resolveInfo = useMemo(() => {
    const gap = config?.instructor_gap_minutes ?? 0;
    const g = Math.max(0, Math.floor(gap));
    return (
      instrId: string,
      date: string,
      minute: number,
      free: boolean,
    ): SlotInfo => {
      const instr = instructorsById.get(instrId);
      const name = instr?.name ?? "";
      const timeLabel = `${minutesToTime(minute)}–${minutesToTime(minute + (config?.gridMinutes ?? 30))}`;

      const unavail = (instr?.unavailability ?? null) as
        | unknown[]
        | null
        | undefined;
      const weekday = dateToWeekdayLower(date);
      const blockedByUnavail =
        unavail != null && isTimeUnavailable(unavail, date, weekday, minute);
      const unavailReason = () => {
        if (!Array.isArray(unavail)) return "";
        for (const u of unavail) {
          if (!isTimeUnavailable([u], date, weekday, minute)) continue;
          const r = (u as Record<string, unknown>)?.reason;
          if (typeof r === "string" && r.trim()) return r.trim();
        }
        return "";
      };

      // Task 19 multi-class batch state (pendingSlots) lives in this
      // component, not the DB — the grid otherwise has zero visibility
      // into slots the user has already picked for the in-progress
      // booking but not yet submitted. Checked ahead of everything else
      // below so it takes priority over whatever the DB-derived
      // free/busy state says.
      const sameInstrDate = pendingSlots.filter(
        (s) => s.instructorId === instrId && s.date === date,
      );
      // Matches BOTH 30-minute grid cells inside the pending slot's full
      // 1-hour span [startMinute, endMinute) — not just the cell exactly
      // at its start minute. That was the earlier bug: only the first
      // half-hour of a selected class showed blue, since the check
      // required minute === startTime instead of "falls within the
      // range".
      const pendingIndex = pendingSlots.findIndex(
        (s) =>
          s.instructorId === instrId &&
          s.date === date &&
          minute >= timeToMinutes(s.startTime) &&
          minute < timeToMinutes(s.endTime),
      );
      if (pendingIndex !== -1) {
        const s = pendingSlots[pendingIndex];
        return {
          title: `Selected — Class ${pendingIndex + 1}`,
          detail: [
            `${minutesToTime(timeToMinutes(s.startTime))}–${minutesToTime(timeToMinutes(s.endTime))}`,
            `Instructor: ${name}`,
            "Already added to this booking.",
          ],
          kind: "pending",
          override: null,
          deleteAction: null,
        };
      }
      if (addingSlotMode && free) {
        const newStart = minute;
        const newEnd = minute + 60;
        const overlapsPending = sameInstrDate.some((s) => {
          const sStart = timeToMinutes(s.startTime);
          const sEnd = timeToMinutes(s.endTime);
          return newStart < sEnd && sStart < newEnd;
        });
        if (overlapsPending) {
          return {
            title: "Overlaps a class already in this booking",
            detail: [timeLabel, `Instructor: ${name}`],
            kind: "pending-blocked",
            override: null,
            deleteAction: null,
          };
        }
      }

      if (free) {
        return {
          title: "Free",
          detail: [timeLabel, `Instructor: ${name}`],
          kind: "free",
          override: null,
          deleteAction: null,
        };
      }

      const slotLen = config?.gridMinutes ?? 30;
      const blocks = blocksIndex.get(instrId)?.get(date) ?? [];
      let cover: BlockDetail | null = null;
      let coverIsDirect = false;
      for (const b of blocks) {
        if (b.status === "cancelled" || b.status === "rejected") continue;
        // A "direct" match means `minute` literally falls inside this
        // block's own [startMinute, endMinute) span — this is a real,
        // unambiguous booking/paused/etc. A block only reachable via its
        // gap gap-extended window (buffer reach) is a weaker, secondary
        // match. When two blocks sit back-to-back (e.g. a paused class
        // immediately followed by a real booking for the next hour), the
        // second block's own direct start can fall inside the FIRST
        // block's gap-extended reach — so taking whichever block matches
        // first in array order (the old behavior) could show the second
        // block's own real time as "buffer for [first block]" instead of
        // its actual status. A direct match always wins over a
        // buffer-only match, regardless of iteration order.
        const isDirect = minute >= b.startMinute && minute < b.endMinute;
        const isBufferReach =
          b.startMinute - g < minute + slotLen && minute < b.endMinute + g;
        if (!isDirect && !isBufferReach) continue;
        if (cover && coverIsDirect) break; // already found the strongest possible match
        if (!cover || isDirect) {
          cover = b;
          coverIsDirect = isDirect;
        }
      }

      if (cover) {
        const blockTime = `${minutesToTime(cover.startMinute)}–${minutesToTime(cover.endMinute)}`;
        const isBuffer =
          minute < cover.startMinute || minute >= cover.endMinute;
        if (cover.status === "booked" || cover.status === "completed") {
          const detail = [blockTime, `Instructor: ${name}`];
          if (cover.learnerName) detail.push(`Learner: ${cover.learnerName}`);
          if (cover.area) detail.push(`Area: ${cover.area}`);
          if (cover.courseName) detail.push(`Course: ${cover.courseName}`);
          return {
            title: isBuffer
              ? `Buffer for ${cover.status === "booked" ? "Booked" : "Completed"} class`
              : cover.status === "booked"
                ? "Booked class"
                : "Completed class",
            detail,
            kind: isBuffer ? "default" : "booked",
            override: null,
            deleteAction: null,
          };
        }
        if (cover.status === "pending_payment" || cover.status === "hold") {
          // "hold" + isTentative === true is a genuine Sales tentative
          // block. "pending_payment" (and a "hold" that somehow isn't
          // flagged isTentative) is a real learner-side booking mid
          // payment — not something Sales created, never overridable here,
          // and shown as "booked" (purple), not "tentative" (yellow).
          const isSalesTentative = cover.status === "hold" && cover.isTentative;
          if (!isSalesTentative) {
            return {
              title: isBuffer
                ? "Buffer for Pending Payment slot"
                : "Payment pending",
              detail: isBuffer
                ? [blockTime, `Instructor: ${name}`]
                : [
                    blockTime,
                    `Instructor: ${name}`,
                    "Slot is on hold until payment completes.",
                  ],
              kind: isBuffer ? "default" : "booked",
              override: null,
              deleteAction: null,
            };
          }
          if (isBuffer) {
            return {
              title: "Buffer for Tentative slot",
              detail: [blockTime, `Instructor: ${name}`],
              kind: "default",
              override: null,
              deleteAction: null,
            };
          }
          // The actual tentative slot itself (not its buffer). Payment
          // status gates both the label and whether override is offered —
          // default to "unpaid" only if the field is missing entirely
          // (shouldn't happen for a real tentative row, but favors
          // showing the override option over silently hiding it).
          const paymentStatus = cover.paymentStatus ?? "unpaid";
          const isUnpaid = paymentStatus === "unpaid";
          return {
            title: isUnpaid ? "🟡 Tentative (Unpaid)" : "Tentative",
            detail: isUnpaid
              ? [
                  blockTime,
                  `Instructor: ${name}`,
                  "Unpaid — can be overridden with a new slot.",
                ]
              : [blockTime, `Instructor: ${name}`],
            kind: "tentative",
            override: isUnpaid
              ? {
                  blockId: cover.id,
                  instrId,
                  date,
                  startMinute: cover.startMinute,
                  endMinute: cover.endMinute,
                  tentativeDetails: cover.rawTentativeDetails,
                }
              : null,
            deleteAction: {
              blockId: cover.id,
              instrId,
              customerName:
                typeof cover.rawTentativeDetails?.name === "string" &&
                cover.rawTentativeDetails.name
                  ? cover.rawTentativeDetails.name
                  : "this customer",
            },
          };
        }
        if (cover.status === "paused") {
          return {
            title: isBuffer ? "Buffer for Paused class" : "Paused",
            detail: isBuffer
              ? [blockTime, `Instructor: ${name}`]
              : [
                  blockTime,
                  `Instructor: ${name}`,
                  ...(cover.notes ? [`Reason: ${cover.notes}`] : []),
                ],
            kind: "default",
            override: null,
            deleteAction: null,
          };
        }
        return {
          title: cap(cover.status),
          detail: [blockTime, `Instructor: ${name}`],
          kind: "default",
          override: null,
          deleteAction: null,
        };
      }

      if (blockedByUnavail) {
        return {
          title: "Unavailable",
          detail: [
            timeLabel,
            `Instructor: ${name}`,
            ...(unavailReason()
              ? [`Reason: ${unavailReason()}`]
              : ["Instructor marked this time unavailable."]),
          ],
          kind: "default",
          override: null,
          deleteAction: null,
        };
      }

      return {
        title: "Busy",
        detail: [timeLabel, `Instructor: ${name}`],
        kind: "default",
        override: null,
        deleteAction: null,
      };
    };
  }, [config, instructorsById, blocksIndex, pendingSlots, addingSlotMode]);

  const gridRows = useMemo(() => {
    if (compareIds.length === 0) return rows;
    return sortRoster(compareInstructors);
  }, [compareIds, compareInstructors, rows, sortRoster]);

  // Guarantees the timeline (06:00 column onward) always starts exactly
  // where the Instructor column ends, for any name length. The table's own
  // auto column-sizing can't be trusted here: .instructor-cell is a <td>
  // with display: flex (needed for the row-select/Schedule-button/name
  // layout), and browsers don't reliably feed a flex box's true content
  // width back into the table's intrinsic-width algorithm the way they do
  // for a plain table-cell — so a sufficiently long name can render wider
  // than the column the browser decided to allocate, spilling into the
  // first time column. Measuring the actual rendered content width
  // (scrollWidth, which reports the true extent even when it overflows the
  // box) and handing the table an explicit min-width sidesteps that
  // unreliable inference entirely.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cells = root.querySelectorAll<HTMLElement>(".instructor-cell");
    let widest = 0;
    cells.forEach((cell) => {
      if (cell.scrollWidth > widest) widest = cell.scrollWidth;
    });
    if (widest > 0) {
      root.style.setProperty("--instr-col-width", `${widest}px`);
    }
  }, [gridRows]);

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchResults.length > 0)
      toggleRoster(searchResults[0].id);
    if (e.key === "Escape") {
      setSearchOpen(false);
      setFilter("");
    }
  };

  if (phase === "loading") {
    return (
      <div
        className={["sales-dashboard-root", theme === "dark" && "dark"]
          .filter(Boolean)
          .join(" ")}
        data-theme={theme}
        ref={rootRef}
      >
        <main className="shell">
          <p className="state">Loading availability from the database…</p>
        </main>
      </div>
    );
  }

  if (phase === "error" || !data) {
    return (
      <div
        className={["sales-dashboard-root", theme === "dark" && "dark"]
          .filter(Boolean)
          .join(" ")}
        data-theme={theme}
        ref={rootRef}
      >
        <main className="shell">
          <div className="state error">
            <p>
              Couldn&apos;t load availability: {errorMsg ?? "unknown error"}
            </p>
            <button type="button" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (!config) return null;

  const fromLabel = shortDate(dates[0]);
  const timeCols = timeStarts.map((m) => minutesToTime(m));

  return (
    <div
      className={["sales-dashboard-root", theme === "dark" && "dark"]
        .filter(Boolean)
        .join(" ")}
      data-theme={theme}
      ref={rootRef}
    >
      <main className="shell">
        <header className="topbar">
          <h1 className="topbar-title">Instructor availability</h1>
          <div className="topbar-row">
            <div className="brand">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/admin")}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            </div>

            <div className="cal-nav">
              <button
                type="button"
                className="cal-btn chev"
                onClick={goPrev}
                disabled={monthIdx <= 0}
                aria-label="Previous month"
              >
                ‹
              </button>
              <div className="cal-month">{monthLabel(activeMonth)}</div>
              <button
                type="button"
                className="cal-btn chev"
                onClick={goNext}
                disabled={monthIdx >= months.length - 1}
                aria-label="Next month"
              >
                ›
              </button>
            </div>

            <div className="controls">
              <div className="controls-row">
                <select
                  className="sort-select"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  aria-label="Sort instructors"
                >
                  <option value="freeDesc">Filter (Most free slots)</option>
                  <option value="freeAsc">Filter (Least free slots)</option>
                  <option value="alpha">Filter (A → Z)</option>
                </select>

                <div className="search" ref={searchRef}>
                  <input
                    type="search"
                    placeholder="Search or compare instructors…"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setSearchOpen(true);
                    }}
                    onFocus={() => {
                      setSearchOpen(true);
                      void loadInstructorIndex();
                    }}
                    onKeyDown={onSearchKeyDown}
                    aria-label="Search instructors by name"
                  />
                  {searchOpen && searchResults.length > 0 && (
                    <ul className="suggest">
                      {searchResults.map((instr) => {
                        const inRoster =
                          data?.instructors.some((i) => i.id === instr.id) ??
                          false;
                        const isLoading =
                          data?.loading.some((i) => i.id === instr.id) ?? false;
                        return (
                          <li
                            key={instr.id}
                            className={
                              inRoster ? "suggest-row added" : "suggest-row"
                            }
                          >
                            <button
                              type="button"
                              className="suggest-main"
                              onClick={() => toggleRoster(instr.id)}
                            >
                              <span className="suggest-name-wrap">
                                <span className="suggest-name">
                                  {instr.name}
                                </span>
                                {statusNote(instr) && (
                                  <span className="break-badge">
                                    {statusNote(instr)}
                                  </span>
                                )}
                              </span>
                              <span className="suggest-btn">
                                {inRoster
                                  ? "✓ Added"
                                  : isLoading
                                    ? "Loading…"
                                    : "＋ Add"}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  className="cal-btn icon-btn"
                  onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                  aria-label="Toggle dark theme"
                  title="Toggle dark theme"
                >
                  {theme === "dark" ? "☀" : "☾"}
                </button>
                <button
                  type="button"
                  className="reset-dash"
                  onClick={resetDashboard}
                  aria-label="Reset dashboard"
                  title="Reset filters, search and selection"
                >
                  ↺ Reset
                </button>
                <button
                  type="button"
                  className="cal-btn icon-btn"
                  onClick={() => setHelpOpen(true)}
                  aria-label="Help"
                  title="How to use this dashboard"
                >
                  ?
                </button>
              </div>
            </div>
          </div>
        </header>

        <Suspense fallback={null}>
          <LocationSearch
            zones={kmlZones}
            zonesError={kmlError}
            status={locStatus}
            resultLabel={locSearch?.label ?? null}
            point={
              locSearch ? { lat: locSearch.lat, lng: locSearch.lng } : null
            }
            matchedNames={locResult?.zones ?? []}
            via={locResult?.via ?? "none"}
            zoneInfo={locResult?.zoneInfo ?? {}}
            onLocate={(lat, lng, label) => setLocSearch({ lat, lng, label })}
            onClear={clearLocation}
            collapsed={locCollapsed}
            onToggleCollapsed={toggleLocCollapsed}
            theme={theme}
          />
        </Suspense>

        <div className="summary">
          {!locCollapsed && locSearch && (
            <div className="loc-results">
              <span className="loc-results-count">
                {locStatus === "found" ? (
                  <>
                    <strong>{locResult?.instrs.length ?? 0}</strong> instructor
                    {(locResult?.instrs.length ?? 0) === 1 ? "" : "s"} near “
                    {locSearch.label}”
                  </>
                ) : (
                  <>No instructor covers “{locSearch.label}” yet.</>
                )}
              </span>
              {locResult && locResult.instrs.length > 0 && (
                <div className="loc-results-chips">
                  {locResult.instrs.map((instr) => {
                    const added = compareIds.includes(instr.id);
                    const rawZones = Object.values(locResult.zoneInfo)
                      .filter((z) => z.instructorName === instr.name)
                      .map((z) => z.rawName);
                    return (
                      <button
                        key={instr.id}
                        type="button"
                        className={added ? "loc-chip added" : "loc-chip"}
                        title={
                          rawZones.length
                            ? `Zone on map: ${rawZones.join(", ")}`
                            : undefined
                        }
                        onClick={() =>
                          added
                            ? removeFromCompare(instr.id)
                            : addToCompare(instr.id)
                        }
                      >
                        <span
                          className="loc-swatch"
                          style={{
                            background: locResult.instrColors[instr.id],
                          }}
                          title={`${instr.name}’s zone colour on the map`}
                        />
                        {`${instr.name} · ${bookableCounts.get(instr.id) ?? 0} free`}
                        {statusNote(instr) && (
                          <span className="break-badge">
                            {statusNote(instr)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                className="clear-select"
                onClick={clearLocation}
              >
                Clear location
              </button>
            </div>
          )}
          {inSelectionMode && (
            <button
              type="button"
              className="clear-select"
              onClick={() => setCompareIds([])}
            >
              Clear selection
            </button>
          )}
        </div>

        <nav className="tabs" aria-label="Select date">
          {visibleDates.map((d, i) => {
            const { weekday, day } = shortDate(d);
            const total = dateTotals.get(d) ?? 0;
            return (
              <button
                type="button"
                key={d}
                className={i === safeDateIndex ? "tab active" : "tab"}
                onClick={() => setDateIndex(i)}
              >
                <span>{weekday}</span>
                <strong>{day}</strong>
                <em>{total} free</em>
              </button>
            );
          })}
        </nav>

        <div
          className={
            addingSlotMode ? "grid-wrap grid-wrap-picking" : "grid-wrap"
          }
          ref={gridWrapRef}
        >
          <AvailabilityGrid
            instructors={gridRows}
            // The strict, full-60-min grid -- canBook1Hour (in both the
            // main row and MiniRow) validates against this prop, so it
            // must NOT be displayGrid (30-min duration check), or
            // validateOneHourBlock trivially agrees with `free` itself and
            // the cell-half downgrade never fires. Cell color/coloring
            // still gets the lenient displayGrid separately via freeSets
            // below.
            freeGrid={
              data?.freeGrid ?? new Map<string, Map<string, number[]>>()
            }
            freeSets={freeSets}
            windowTotals={windowTotals}
            timeCols={timeCols}
            timeStarts={timeStarts}
            dates={dates}
            selectedDate={selectedDate}
            gridMinutes={config.gridMinutes}
            slotStart={config.slotStart}
            slotEnd={config.slotEnd}
            expanded={expanded}
            pendingExpandId={pendingExpandRowId}
            selectedRows={selectedRows}
            rowColors={rowColors}
            loadingRows={data?.loading ?? []}
            onToggleExpand={toggleExpand}
            onToggleSelectRow={toggleSelectRow}
            onRemove={inSelectionMode ? removeFromCompare : removeInstructor}
            onDoubleClick={handleSlotDoubleClick}
            onOverrideClick={handleOverrideClick}
            onDeleteTentative={handleDeleteTentative}
            resolveInfo={resolveInfo}
          />
          {gridRows.length === 0 && !locSearch && (
            <p className="empty">
              No instructors loaded yet. Search by name above or use Search by
              location.
            </p>
          )}
          {gridRows.length === 0 && locSearch && (
            <p className="empty">
              No instructors match this location. Try another area.
            </p>
          )}
        </div>

        <footer className="legend">
          <span>
            <i className="swatch free" /> Free slot (no class, not on
            unavailability, outside the {config.instructor_gap_minutes}-minute
            travel gap)
          </span>
          <span>
            <i className="swatch tentative" /> 🟡 Tentative (unpaid can be
            overridden)
          </span>
          <span>
            <i className="swatch booked" /> 🟣 Booked
          </span>
          <span>
            <i className="swatch pending" /> 🔵 Selected for this booking
          </span>
          <span>
            <i className="swatch busy" /> Busy / other
          </span>
          <button
            type="button"
            className="reload"
            onClick={() => void reload()}
          >
            Refresh
          </button>
        </footer>

        {helpOpen && (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- standard click-outside-to-dismiss backdrop; the modal itself has role="dialog" and a visible close button
          <div className="modal-backdrop" onClick={() => setHelpOpen(false)}>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions -- stops the backdrop's dismiss click from bubbling; the modal itself has role="dialog" and a visible close button */}
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label="How to use this dashboard"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>How to use this dashboard</h2>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setHelpOpen(false)}
                  aria-label="Close help"
                >
                  ×
                </button>
              </div>

              <div className="help-section">
                <h3>What this page shows</h3>
                <p>
                  Live availability from the sales database: which of{" "}
                  {rows.length} active instructors can take a new learner in
                  each 30-minute slot, across {dates.length} days from{" "}
                  {fromLabel.weekday} {fromLabel.date}.
                </p>
              </div>

              <div className="help-section">
                <h3>Pick a month</h3>
                <ul>
                  <li>
                    Use the ‹ and › arrows beside the month name to step one
                    month at a time.
                  </li>
                  <li>
                    The month selector on the right jumps straight to any
                    visible month.
                  </li>
                  <li>The arrows stop at the start and end of the window.</li>
                </ul>
              </div>

              <div className="help-section">
                <h3>Pick a date</h3>
                <ul>
                  <li>
                    Each tab is one date: weekday, day number, and total free
                    slots for that day.
                  </li>
                  <li>
                    Click a tab to view that date. The active day shows a blue
                    circle.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>Filter the instructor list</h3>
                <ul>
                  <li>
                    The Filter select reorders instructors using the selected
                    date.
                  </li>
                  <li>
                    Most free slots first, least free slots first, or
                    alphabetical A to Z.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>Search and compare instructors</h3>
                <ul>
                  <li>
                    Type a name to search; results drop down below the field.
                  </li>
                  <li>
                    Click + Compare (or press Enter for the top result) to pin
                    an instructor.
                  </li>
                  <li>
                    While comparing, the grid shows only the pinned instructors.
                  </li>
                  <li>
                    Remove one with the small ×, or reset with Clear selection.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>Search by location</h3>
                <ul>
                  <li>
                    Below the search box, type an area or address (e.g.
                    Koramangala, Bangalore).
                  </li>
                  <li>
                    Pick a suggestion or press Search; the map shows the
                    matching coverage zones.
                  </li>
                  <li>
                    The grid narrows to instructors who work in that location.
                    Click a name chip to pin instructor(s) for comparison.
                  </li>
                  <li>
                    Clear location or ↺ Reset to go back to the full roster.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>Read the grid</h3>
                <ul>
                  <li>Columns are 30-minute slots; rows are instructors.</li>
                  <li>
                    <strong>🟢 Green</strong> = free: no class, no time off,
                    enough travel time.
                  </li>
                  <li>
                    <strong>🟡 Yellow</strong> = tentative (created from this
                    dashboard) — unpaid, half paid, or full paid.
                  </li>
                  <li>
                    <strong>🟣 Purple</strong> = booked, completed, or a real
                    learner booking mid-payment — a confirmed class, never
                    editable from here.
                  </li>
                  <li>
                    Plain/unshaded = paused, unavailable, or a travel-gap buffer
                    around another slot.
                  </li>
                  <li>
                    <strong>Hover</strong> any slot for full details: status,
                    time, instructor, and — for a booked class — learner, area,
                    and course when known.
                  </li>
                  <li>
                    A {config.instructor_gap_minutes}-minute travel gap around
                    classes is applied, so green slots are safe to assign.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>Create a tentative booking</h3>
                <ul>
                  <li>
                    <strong>Double-click</strong> any green (free) slot to open
                    the booking form for that 1-hour block.
                  </li>
                  <li>
                    Fill in the customer&apos;s name, phone, sales agent,
                    payment status, address, and course, then submit.
                  </li>
                  <li>
                    This always creates a <strong>tentative</strong> hold (shown
                    yellow) — it is never a confirmed/booked class. Operations
                    verifies the customer and converts valid tentative slots to
                    confirmed bookings separately.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>Book multiple classes in one go</h3>
                <ul>
                  <li>
                    While the booking form is open, click{" "}
                    <strong>+ Add another class</strong> instead of submitting —
                    useful for a customer buying a course of several classes at
                    once.
                  </li>
                  <li>
                    The form hides and the grid gets a pulsing yellow border:{" "}
                    <strong>double-click the next free slot</strong> (any
                    date/instructor) to add it. The form reopens with that class
                    added — your name/phone/agent/course entries are kept,
                    nothing is lost.
                  </li>
                  <li>
                    Every class you&apos;ve already picked shows{" "}
                    <strong>🔵 blue</strong> on the grid while you&apos;re
                    picking the next one, so it&apos;s always clear what
                    you&apos;ve selected so far.
                  </li>
                  <li>
                    Any free slot that would <strong>overlap</strong> a class
                    already in this booking is greyed out and can&apos;t be
                    selected — e.g. picking 7:00–8:00 disables 7:30–8:30 for
                    that same instructor.
                  </li>
                  <li>
                    Repeat for as many classes as needed. Each one appears in a
                    &quot;Selected Slots&quot; list with a × to remove it (the
                    last remaining slot can&apos;t be removed — use Cancel
                    instead).
                  </li>
                  <li>
                    Submitting creates all selected classes together as
                    tentative holds. If any one of them is no longer available
                    by the time you submit, the form tells you exactly which
                    class and creates none of them — so you never end up with a
                    half-created batch.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>Override an unpaid tentative slot</h3>
                <ul>
                  <li>
                    Hover a <strong>yellow</strong> slot. If its payment status
                    is <strong>unpaid</strong>, the popover shows{" "}
                    <strong>🟡 Tentative (Unpaid)</strong> with an{" "}
                    <strong>Override Slot</strong> button.
                  </li>
                  <li>
                    Half-paid and full-paid tentative slots show plainly as{" "}
                    <strong>Tentative</strong> with no override option — once
                    any payment has been collected, that slot is protected and
                    can&apos;t be taken from this dashboard.
                  </li>
                  <li>
                    Clicking <strong>Override Slot</strong> opens the booking
                    form immediately for that <strong>same</strong> slot — no
                    need to pick a different time. This is for handing an unpaid
                    hold to a new, paying learner, not moving the existing
                    customer elsewhere.
                  </li>
                  <li>
                    Fill in the <strong>new</strong> learner&apos;s details.
                    Payment Status only offers <strong>Half Paid</strong> or{" "}
                    <strong>Full Paid</strong> — a new unpaid hold can&apos;t
                    override an existing one, so &quot;Unpaid&quot; isn&apos;t
                    an option here.
                  </li>
                  <li>
                    Submitting releases the old unpaid hold and creates a new
                    tentative slot (still tentative, never directly booked) for
                    the new learner at the same time. This is re-checked on the
                    server, not just here — if the old slot was paid or changed
                    by someone else in the meantime, the override is rejected
                    and the original booking stays exactly as it was.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>View an instructor&apos;s full schedule</h3>
                <ul>
                  <li>
                    Click an instructor&apos;s name or the Schedule button to
                    open their day-by-day timetable across all dates.
                  </li>
                  <li>
                    Each day shows its free-slot count; the highlighted row is
                    the currently selected date.
                  </li>
                  <li>
                    Click the name or Hide schedule to collapse the timetable.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>Refresh and legend</h3>
                <ul>
                  <li>Bottom-right Refresh fetches the latest data.</li>
                  <li>The legend explains the slot colors used in the grid.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Tentative Booking Modal */}
      <TentativeBookingModal
        isOpen={tentativeModalOpen}
        onClose={handleCloseTentativeModal}
        onSuccess={handleTentativeSuccess}
        slots={pendingSlots}
        onRemoveSlot={handleRemoveSlot}
        onAddAnotherSlot={handleAddAnotherSlot}
        validateSlot={validateSlotFresh}
        formData={customerFormData}
        onFormDataChange={setCustomerFormData}
        overrideContext={overrideContext}
      />

      {/* Persistent banner while picking an additional class for an
          in-progress multi-class booking (Task 19) — the modal is
          hidden (not closed: pendingSlots/customerFormData are untouched)
          until a new slot is double-clicked or this is cancelled. */}
      {addingSlotMode && (
        <div className="slot-toast slot-toast-info" role="status">
          <span className="slot-toast-icon" aria-hidden="true">
            ➕
          </span>
          <span className="slot-toast-msg">
            <strong>👉 Pick the next class now:</strong> double-click any green
            (free) cell on the highlighted grid below to add it to this booking.
            The form isn&apos;t closed — it will reopen with your selection
            added.
          </span>
          <button
            type="button"
            className="slot-toast-close"
            aria-label="Cancel adding another class"
            onClick={cancelAddingSlot}
          >
            ×
          </button>
        </div>
      )}

      {/* Themed in-app notice, replaces the native browser alert() for
          slot-validation feedback (e.g. "not fully available"). */}
      {slotNotice && (
        <div className="slot-toast" role="alert">
          <span className="slot-toast-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="slot-toast-msg">{slotNotice}</span>
          <button
            type="button"
            className="slot-toast-close"
            aria-label="Dismiss notice"
            onClick={() => {
              if (slotNoticeTimerRef.current)
                clearTimeout(slotNoticeTimerRef.current);
              setSlotNotice(null);
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Booking confirmation, shown on the dashboard itself so it's
          visible after the modal (which shows its own brief message
          before closing) is gone. */}
      {successNotice && (
        <div className="slot-toast slot-toast-success" role="status">
          <span className="slot-toast-msg">{successNotice}</span>
          <button
            type="button"
            className="slot-toast-close"
            aria-label="Dismiss notice"
            onClick={() => {
              if (successNoticeTimerRef.current)
                clearTimeout(successNoticeTimerRef.current);
              setSuccessNotice(null);
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function useOutsideClick(
  ref: RefObject<HTMLDivElement | null>,
  onOutside: () => void,
) {
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [ref, onOutside]);
}
