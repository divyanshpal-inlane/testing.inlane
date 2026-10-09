import "@/components/admin/sales-dashboard/sales-dashboard.css";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Trash2,
} from "lucide-react";
import type { CSSProperties, KeyboardEvent, RefObject } from "react";
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
import { LoadingSpinner } from "@/components/ui/loading-spinner";
// TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
import { useAuth } from "@/context/auth-context";
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
  isCompanyInstructor,
  isCompanyInstructorId,
} from "@/lib/sales-dashboard/company-instructors";
import {
  bufferWaivedForCustomer,
  classifySlotConflict,
} from "@/lib/sales-dashboard/conflict";
import { pointInPolygon } from "@/lib/sales-dashboard/kml";
// TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
import {
  measureApi,
  setMonitorIdentity,
  startMonitoringSession,
  trackEvent,
} from "@/lib/sales-dashboard/tempMonitoring";
import {
  addDaysISO,
  dateToWeekdayLower,
  istTodayISO,
  minutesTo12Hour,
  minutesToTime,
  timeToMinutes,
} from "@/lib/sales-dashboard/validation";
import type { InstructorWorkingHours } from "@/lib/sales-dashboard/workingHours";
import { inferInstructorWorkingHours } from "@/lib/sales-dashboard/workingHours";
import type { DbZone } from "@/lib/sales-dashboard/zones-db";
import {
  fetchCompanyInstructorIds,
  fetchDbZones,
  warnOnCompanyInstructorZones,
} from "@/lib/sales-dashboard/zones-db";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { useCurrentAdmin } from "@/queries/adminPermissions";
import { useCurrentUser } from "@/queries/userManagement";

const LocationSearch = lazy(
  () => import("@/components/admin/sales-dashboard/LocationSearch"),
);

// Plain-English name for each SlotInfo.kind, shown as the badge at the top of
// the side panel when a taken slot is selected. Mirrors the cell colours.
const SLOT_KIND_LABELS: Record<SlotInfo["kind"], string> = {
  free: "Free",
  tentative: "Tentative",
  booked: "Booked",
  paused: "Paused",
  unavailable: "Unavailable",
  pending: "In this booking",
  "pending-blocked": "Blocked",
  default: "Slot",
};

// The customer's home area/address is one of the few multi-word values in a
// detail line, so a hover popover sized to the grid turns into a tall ragged
// block that covers the neighbouring instructors. It is still shown - the side
// panel keeps the full `detail` array - it is only hidden on hover, where the
// popover is a glance rather than a reading surface.
const ADDRESS_DETAIL_PREFIX = "Area: ";

// Rich label/value rows the side panel renders for a taken slot, mirroring
// Instructor Management's timetable card. Kept separate from `detail` (the
// terse hover-popover lines) so the full card never bloats the hover glance.
interface SlotCardRow {
  label: string;
  value: string;
}

interface SlotInfo {
  title: string;
  detail: string[];
  // Drives cell background color. "tentative" = yellow (any payment
  // status), "booked" = purple (booked/completed/pending_payment — i.e.
  // a real class, never overridable from Sales). "pending" = blue, a
  // slot already added to the in-progress multi-class batch (Task 19).
  // "paused" and "unavailable" are styled only in the expanded calendar.
  // "pending-blocked" = grey/disabled, a free slot that would overlap a
  // class already in that same batch — can't be added on top of it. Buffer
  // zones and everything else stay "default" (existing plain appearance).
  kind:
    | "free"
    | "tentative"
    | "booked"
    | "paused"
    | "unavailable"
    | "pending"
    | "pending-blocked"
    | "default";
  // Set for any non-buffer tentative slot regardless of payment status --
  // a wrong entry can be deleted no matter who's already paid something
  // toward it.
  deleteAction: {
    blockId: number;
    instrId: string;
    customerName: string;
  } | null;
  // Set for a tentative booking the signed-in agent created (same creator gate
  // as deleteAction) — opens the booking form in edit mode, pre-loaded with
  // every class booked together so shared customer fields and each class's
  // date/time can be changed in one save. Optional: most SlotInfo results
  // (free/busy/booked/paused/…) have nothing to edit.
  editAction?: {
    blockId: number;
    instrId: string;
    tentativeDetails: Record<string, unknown> | null;
  } | null;
  // Present only on the first visible grid cell of a real Schedule row.
  // This is display metadata; all slot state and interactions still come
  // from the existing per-cell availability/booking flow below it.
  scheduleBlock?: {
    customerName: string;
    lessonNumber: number | null;
    startMinute: number;
    endMinute: number;
    statusLabel: string;
    span: number;
  };
  // Instructor-Management-style rows for the side panel (learner + class no.,
  // 12-hour time, phone, address, description, lead, payment). When present the
  // panel renders these instead of `detail`; the hover popover always uses
  // `detail`.
  card?: SlotCardRow[];
  // Panel-only lines kept alongside `card` so nothing the panel used to show is
  // lost when `card` takes over (e.g. a tentative hold's delete
  // notes). The popover never reads this.
  panelDetail?: string[];
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
    !isDisabled(instructor) && (instructor.status ?? "active") === "active"
  );
}

// Distinct from isBookable: a disabled instructor has been
// deactivated/removed and must never appear anywhere — not in the roster, not
// in the grid, not in a name search, and never as a location match. status !==
// "active" with `enabled !== false` (e.g. "on_break") is a *temporary* state —
// that instructor still exists and a sales rep searching for them by name
// should be able to find them, same as the existing behavior for
// location-matched on-break instructors (see workingOnMap below).
//
// Both columns are checked because they are only kept in sync by the admin UI
// (`instructors.tsx` writes status and enabled together). A row carrying
// status='inactive' with enabled=true — reachable via a direct write, an older
// script, or a partially-applied migration — would otherwise be picked up by
// workingOnMap and shown in the grid, which is exactly what must never happen.
function isDisabled(
  instructor: Pick<InstructorRow, "status" | "enabled">,
): boolean {
  return instructor.enabled === false || instructor.status === "inactive";
}

// Short label shown next to an instructor's name wherever they can appear
// (search suggestions, grid rows, location chips) when they're temporarily
// unavailable but still real/searchable — null for active or disabled
// instructors (disabled ones aren't shown in these lists at all).
function statusNote(
  instructor: Pick<InstructorRow, "status" | "enabled">,
): string | null {
  if (isDisabled(instructor)) return null;
  const status = instructor.status ?? "active";
  if (status === "active") return null;
  if (status === "on_break") return "On break";
  // No "paused" case: instructor_status_check only allows
  // active | on_break | inactive, so any other value is unexpected and is
  // surfaced as a generic warning rather than inventing a status that cannot
  // be stored.
  return "Unavailable";
}

function instructorDisplayRank(
  instructor: Pick<InstructorRow, "status">,
): number {
  const status = instructor.status ?? "active";
  if (status === "active") return 0;
  if (status === "on_break") return 2;
  return 1;
}

const EMPTY_LIGHT: LightInstructor[] = [];

const LEGACY_ROSTER_STORAGE_KEY = "lane-sales-dashboard-roster";
const LEGACY_SEARCH_STORAGE_KEY = "lane-sales-dashboard-search";
const ROSTER_STORAGE_PREFIX = "lane-sales-dashboard-roster:v2";
// Persists whether the location map is collapsed, so explicitly closing it
// sticks across a reload instead of reopening every time.
const MAP_COLLAPSED_STORAGE_KEY = "lane-sales-dashboard-map-collapsed";

function parseStoredRoster(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

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

function formatPanelRange(days: string[]): string {
  if (days.length === 0) return "";
  const base: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  };
  const first = new Date(`${days[0]}T00:00:00Z`).toLocaleDateString(
    "en-US",
    base,
  );
  const last = new Date(
    `${days[days.length - 1]}T00:00:00Z`,
  ).toLocaleDateString("en-US", { ...base, year: "numeric" });
  return `${first} - ${last}`;
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

// One instructor whose schedule fetch failed. Rendered as an in-grid row.
export interface SalesErrorRow {
  id: string;
  name: string;
  message: string;
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
  // The rolling 7-day window the expanded Schedule timetable shows, plus its
  // Instructor-Management-style navigation (<< < Today > >>) and the visible
  // date-range label.
  weekDates: string[];
  panelRangeLabel: string;
  canPanelPrev: boolean;
  canPanelNext: boolean;
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
  // Instructors whose schedule fetch failed, shown as in-grid rows with a
  // Retry so a load failure is visible instead of being swallowed into the
  // "No instructors loaded yet" empty state.
  errorRows: SalesErrorRow[];
  onRetryLoad: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onPanelPrevWeek: () => void;
  onPanelNextWeek: () => void;
  onPanelPrevDay: () => void;
  onPanelNextDay: () => void;
  onPanelToday: () => void;
  onToggleSelectRow: (id: string) => void;
  onRemove?: (id: string) => void;
  onSelect?: (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
    info: SlotInfo,
  ) => void;
  onDeleteTentative?: (action: NonNullable<SlotInfo["deleteAction"]>) => void;
  onEditBooking?: (action: NonNullable<SlotInfo["editAction"]>) => void;
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
  expandedCalendar?: boolean;
  onSelect?: (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
    info: SlotInfo,
  ) => void;
  onDeleteTentative?: (action: NonNullable<SlotInfo["deleteAction"]>) => void;
  onEditBooking?: (action: NonNullable<SlotInfo["editAction"]>) => void;
  resolveInfo: (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
  ) => SlotInfo;
}

// Where a slot popover has to sit so its scroll container does not clip it.
// Both grids live inside an `overflow: auto` box (.grid-wrap for the main
// grid, .detail for the expanded calendar), so a popover anchored below a cell
// near the bottom edge, or a wide one beside the first/last column, used to be
// cut off. Measured once per hover in SlotCellInner; CSS applies the result.
interface PopPlacement {
  // Render above the cell instead of below it (flipped for lack of room).
  above: boolean;
  // Horizontal nudge, in px, applied on top of the normal centring.
  shiftX: number;
  // Where the little arrow sits, measured from the popover's left edge, so it
  // keeps pointing at the cell even when the popover has been shifted.
  arrowX: number;
  // Cap on the popover's height; anything taller scrolls instead of clipping.
  maxH: number;
}

function SlotCellInner({
  instrId,
  date,
  minute,
  free,
  band,
  timeLabel,
  canBook1Hour,
  expandedCalendar = false,
  onSelect,
  onDeleteTentative,
  onEditBooking,
  resolveInfo,
}: SlotCellProps) {
  const [isHovered, setIsHovered] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<PopPlacement | null>(null);
  // Computed on every render, not just while hovered — kind drives the
  // cell's background color (yellow tentative / purple booked), which
  // must be visible at a glance, not only on hover.
  const info = resolveInfo(instrId, date, minute, free);
  // Stable string key for the popover's contents, so the measurement effect
  // below re-runs when the text changes but not on every unrelated render.
  const popKey = `${info.title}\u0000${info.detail.join("\u0000")}`;

  // Runs after the popover mounts (it is only rendered while hovered), so its
  // real size is known. Cheap: one hovered cell at a time, and the state
  // update is skipped entirely when nothing would move.
  useLayoutEffect(() => {
    const popEl = popRef.current;
    if (!isHovered || !popEl) {
      setPop(null);
      return;
    }
    const cellEl = popEl.parentElement;
    if (!cellEl) return;
    const cellRect = cellEl.getBoundingClientRect();
    // Fall back to the viewport if this cell is somehow outside both boxes.
    const clipEl = popEl.closest<HTMLElement>(".detail, .grid-wrap");
    const view = clipEl
      ? clipEl.getBoundingClientRect()
      : {
          top: 0,
          left: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
        };
    const gap = 8;
    const pad = 6;
    const roomBelow = view.bottom - cellRect.bottom - gap;
    const roomAbove = cellRect.top - view.top - gap;
    const above = popEl.offsetHeight > roomBelow && roomAbove > roomBelow;
    const centred = cellRect.left + cellRect.width / 2 - popEl.offsetWidth / 2;
    const minLeft = view.left + pad;
    // maxLeft can be < minLeft on a very narrow container; the Math.max keeps
    // the clamp from pushing the popover back outside the left edge.
    const maxLeft = Math.max(minLeft, view.right - pad - popEl.offsetWidth);
    const left = Math.min(Math.max(centred, minLeft), maxLeft);
    const next: PopPlacement = {
      above,
      shiftX: Math.round(left - centred),
      arrowX: Math.round(cellRect.left + cellRect.width / 2 - left),
      maxH: Math.max(140, Math.round(above ? roomAbove : roomBelow)),
    };
    setPop((prev) =>
      prev &&
      prev.above === next.above &&
      prev.shiftX === next.shiftX &&
      prev.arrowX === next.arrowX &&
      prev.maxH === next.maxH
        ? prev
        : next,
    );
  }, [isHovered, popKey]);
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
  } else if (expandedCalendar && info.kind === "paused") {
    cls.push("cell-paused");
  } else if (expandedCalendar && info.kind === "unavailable") {
    cls.push("cell-unavailable");
  } else if (band) {
    cls.push("cell-band");
  }
  if (expandedCalendar && info.scheduleBlock) {
    cls.push("cell-schedule-anchor");
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
                : `Free ${timeLabel} — click to book 1hr`
              : "Hover for details"
      }
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => {
        // Single click selects the slot: a free one opens the booking form in
        // the side panel, a taken one (booked / tentative / paused /
        // unavailable) shows its details there. Replaces the old double-click.
        if (onSelect) onSelect(instrId, date, minute, free, info);
      }}
    >
      {expandedCalendar && info.scheduleBlock && (
        <div
          className={`mini-schedule-card mini-schedule-card-${info.kind}`}
          style={{
            // Transposed grid: a class spans vertically (its slots are now
            // consecutive ROWS), so the block grows by height, not width.
            height: `calc(${info.scheduleBlock.span} * var(--mini-slot-height) - 4px)`,
          }}
          aria-label={`${info.scheduleBlock.customerName}, ${info.scheduleBlock.statusLabel}, ${minutesToTime(info.scheduleBlock.startMinute)} to ${minutesToTime(info.scheduleBlock.endMinute)}`}
        >
          <div className="mini-schedule-name">
            <span>{info.scheduleBlock.customerName}</span>
            {info.scheduleBlock.lessonNumber != null && (
              <span className="mini-schedule-number">
                ({info.scheduleBlock.lessonNumber})
              </span>
            )}
          </div>
          <div className="mini-schedule-meta">
            <span>
              {minutesToTime(info.scheduleBlock.startMinute)} -{` `}
              {minutesToTime(info.scheduleBlock.endMinute)}
            </span>
            <span>{info.scheduleBlock.statusLabel}</span>
          </div>
        </div>
      )}
      {isHovered && (
        <div
          ref={popRef}
          className={pop?.above ? "slot-pop above" : "slot-pop"}
          style={
            pop
              ? ({
                  "--pop-shift-x": `${pop.shiftX}px`,
                  "--pop-arrow-x": `${pop.arrowX}px`,
                  "--pop-max-h": `${pop.maxH}px`,
                } as CSSProperties)
              : undefined
          }
        >
          <div className={free ? "pop-title free" : "pop-title busy"}>
            {info.title}
          </div>
          {info.detail
            .filter((line) => !line.startsWith(ADDRESS_DETAIL_PREFIX))
            .map((line, i) => (
              <div key={i} className="pop-line">
                {line}
              </div>
            ))}
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
          {info.editAction && (
            <button
              type="button"
              className="slot-pop-edit-btn"
              onClick={(e) => {
                e.stopPropagation();
                onEditBooking?.(info.editAction!);
              }}
            >
              Edit Slot
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
// instructors with expanded monthly schedules are open at once.
const SlotCell = memo(SlotCellInner);

// ---------------------------------------------------------------------------
// Expanded instructor timetable.
//
// A pixel-for-pixel reproduction of Instructor Management's "View Schedule"
// timetable (InstructorSchedulePage in src/routes/admin/instructors.tsx):
// 7 consecutive day columns x 18 hourly rows (SlotConfig 05:00-23:00), with
// the same Tailwind classes, PALETTE hexes, borders, fonts and lesson-block
// treatment, so the two timetables read as the same component.
//
// The one deliberate addition is availability shading in the empty halves.
// This is a Sales booking surface, not a read-only schedule, so a cell the
// engine reports busy is tinted even when it carries no class block. Lesson
// blocks themselves use the reference's exact getScheduleColors() colours.
// ---------------------------------------------------------------------------

// Verbatim from instructors.tsx (InstructorSchedulePage's PALETTE).
const TT_PURPLE_DARK = "#6257FF";
const TT_BLOCK = "#030508";

// Reference rows: SlotConfig.startHourOfDay (5) .. endHourOfDay (23).
const TT_HOURS = Array.from({ length: 18 }, (_, i) => i + 5);

// Mirrors InstructorSchedulePage's getScheduleColors() block classes exactly,
// mapped through the SlotInfo states this dashboard produces.
function ttBlockClass(kind: SlotInfo["kind"], statusLabel: string): string {
  if (kind === "tentative") {
    return "border-amber-600 bg-amber-400 text-amber-950";
  }
  if (kind === "paused") {
    return statusLabel === "Payment due"
      ? "border-red-700 bg-red-500 text-white"
      : "border-slate-700 bg-slate-500 text-white";
  }
  if (kind === "booked") {
    if (statusLabel === "Done (OTP)") {
      return "border-emerald-700 bg-emerald-500 text-white";
    }
    if (statusLabel === "Done (manual)") {
      return "border-orange-600 bg-orange-400 text-orange-950";
    }
    return "border-indigo-700 bg-indigo-500 text-white";
  }
  return "border-indigo-700 bg-indigo-500 text-white";
}

// Availability fill for one half of an hourly row. Free reads white (the
// reference's own "empty is bookable" language); every busy state gets a light
// neutral so a taken slot is never mistaken for an open one even when it has
// no drawn class block (buffer zones, engine unavailability).
function ttHalfFill(kind: SlotInfo["kind"], free: boolean): string {
  if (free) return "transparent";
  if (kind === "tentative") return "#fef3c7";
  if (kind === "booked") return "#e0e7ff";
  if (kind === "pending" || kind === "pending-blocked") return "#dbeafe";
  // Busy/plain (unavailable) halves read the same grey as the main grid's
  // band -- Instructor Management greys an unavailable slot with #030508 at
  // 25% over white (~#c0c0c1), the reference tone, so it never blends into a
  // white free half.
  if (kind === "paused") return "#c0c0c1";
  return "#c0c0c1";
}

// Builds the side panel's Instructor-Management-style card rows for a taken
// slot. `description`, `lead` and `payment` default to "N/A" for a real class,
// exactly like Instructor Management's timetable card; a tentative hold fills
// them from its tentative_details.
function buildSlotCard(row: {
  startMinute: number;
  endMinute: number;
  instructor: string;
  learner: string;
  lessonNumber: number | null;
  phone: string;
  location: string;
  course: string;
  description: string;
  lead: string;
  payment: string;
}): SlotCardRow[] {
  const learnerWithClass =
    row.learner && row.lessonNumber != null
      ? `${row.learner} (Class ${row.lessonNumber})`
      : row.learner;
  return [
    {
      label: "Time",
      value: `${minutesTo12Hour(row.startMinute)} — ${minutesTo12Hour(row.endMinute)}`,
    },
    { label: "Instructor", value: row.instructor || "N/A" },
    { label: "Learner", value: learnerWithClass || "N/A" },
    { label: "Phone", value: row.phone || "N/A" },
    { label: "Location", value: row.location || "N/A" },
    { label: "Course", value: row.course || "N/A" },
    { label: "Description", value: row.description || "N/A" },
    { label: "Lead", value: row.lead || "N/A" },
    { label: "Payment", value: row.payment || "N/A" },
  ];
}

interface WeekTimetableProps {
  instrId: string;
  weekDates: string[];
  selectedDate: string;
  dayFree: Map<string, number[]> | undefined;
  onSelect?: (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
    info: SlotInfo,
  ) => void;
  onDeleteTentative?: (action: NonNullable<SlotInfo["deleteAction"]>) => void;
  onEditBooking?: (action: NonNullable<SlotInfo["editAction"]>) => void;
  resolveInfo: (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
  ) => SlotInfo;
}

function WeekTimetable({
  instrId,
  weekDates,
  selectedDate,
  dayFree,
  onSelect,
  onDeleteTentative,
  onEditBooking,
  resolveInfo,
}: WeekTimetableProps) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);
  const freeAt = (date: string, minute: number) =>
    dayFree?.get(date)?.includes(minute) ?? false;
  return (
    <div className="week-timetable flex flex-row font-sans">
      {/* TIME AXIS */}
      <div className="z-20 flex w-14 shrink-0 flex-col border-r bg-slate-50">
        <div className="h-10 border-b bg-white" />
        <div
          className="grid"
          style={{
            gridTemplateRows: `repeat(${TT_HOURS.length}, minmax(44px, 1fr))`,
          }}
        >
          {TT_HOURS.map((h, idx) => {
            const isHovered = hoveredRow === idx;
            return (
              <div
                key={h}
                className={cn(
                  "flex items-start justify-end border-b border-slate-100 pr-2 pt-1 transition-colors",
                  isHovered ? "bg-slate-500" : "bg-white",
                )}
              >
                <span
                  className={cn(
                    "text-[9px] font-bold uppercase transition-colors",
                    isHovered ? "text-white" : "text-slate-400",
                  )}
                >
                  {`${String(h).padStart(2, "0")}:00`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {/* GRID */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* DAY HEADERS */}
        <div className="grid shrink-0 grid-cols-7 border-b bg-white">
          {weekDates.map((d, colIdx) => {
            const dt = new Date(`${d}T00:00:00Z`);
            const isToday = d === todayIso;
            const isHovered = hoveredCol === colIdx;
            return (
              <div
                key={d}
                className="flex h-10 flex-col items-center justify-center border-r transition-colors last:border-0"
                style={{ backgroundColor: isHovered ? TT_BLOCK : "#FFFFFF" }}
              >
                <span
                  className="mb-0.5 text-[8px] font-bold uppercase transition-colors"
                  style={{ color: isHovered ? "#F1F5F9" : "#94A3B8" }}
                >
                  {dt.toLocaleDateString("en-GB", {
                    weekday: "short",
                    timeZone: "UTC",
                  })}
                </span>
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black transition-all"
                  style={{
                    backgroundColor:
                      isToday && !isHovered ? TT_PURPLE_DARK : "transparent",
                    color:
                      isHovered || (isToday && !isHovered)
                        ? "#FFFFFF"
                        : "#334155",
                  }}
                >
                  {dt.toLocaleDateString("en-GB", {
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {/* CELLS */}
        <div
          className="relative grid grid-cols-7"
          style={{
            gridTemplateRows: `repeat(${TT_HOURS.length}, minmax(44px, 1fr))`,
          }}
        >
          {TT_HOURS.map((h, rowIdx) => (
            <Fragment key={h}>
              {weekDates.map((d, colIdx) => {
                const h0 = h * 60;
                const h1 = h0 + 30;
                const free0 = freeAt(d, h0);
                const free1 = freeAt(d, h1);
                const info0 = resolveInfo(instrId, d, h0, free0);
                const info1 = resolveInfo(instrId, d, h1, free1);
                const blocks: {
                  block: NonNullable<SlotInfo["scheduleBlock"]>;
                  kind: SlotInfo["kind"];
                  del: SlotInfo["deleteAction"];
                  edit: SlotInfo["editAction"];
                }[] = [];
                if (info0.scheduleBlock) {
                  blocks.push({
                    block: info0.scheduleBlock,
                    kind: info0.kind,
                    del: info0.deleteAction,
                    edit: info0.editAction,
                  });
                }
                if (info1.scheduleBlock) {
                  blocks.push({
                    block: info1.scheduleBlock,
                    kind: info1.kind,
                    del: info1.deleteAction,
                    edit: info1.editAction,
                  });
                }
                const isSelected = d === selectedDate;
                // Highlight only the 30-minute halves that are actually pending.
                // A cell is a full hour, so outlining the whole cell for either
                // half made a 15:30–16:30 class light up 15:00–17:00.
                const pending0 = info0.kind === "pending";
                const pending1 = info1.kind === "pending";
                return (
                      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- grid cell; clicking selects the slot in the side panel, and the roster grid exposes keyboard-operable booking controls
                      <div
                        key={`${d}-${h}`}
                        className={cn(
                          "group relative cursor-pointer select-none border-b border-r border-slate-50 transition-colors",
                          isSelected && "bg-indigo-50/40",
                        )}
                    onMouseEnter={() => {
                      setHoveredRow(rowIdx);
                      setHoveredCol(colIdx);
                    }}
                    onMouseLeave={() => {
                      setHoveredRow(null);
                      setHoveredCol(null);
                    }}
                    onClick={(e) => {
                      // Determine which half of the cell was clicked (top = h0, bottom = h1)
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickY = e.clientY;
                      const midY = rect.top + rect.height / 2;
                      const isTopHalf = clickY < midY;
                      const minute = isTopHalf ? h0 : h1;
                      const free = isTopHalf ? free0 : free1;
                      const info = isTopHalf ? info0 : info1;
                      onSelect?.(instrId, d, minute, free, info);
                    }}
                  >
                    <div
                      className="absolute left-0 top-0 z-0 h-1/2 w-full"
                      style={{ backgroundColor: ttHalfFill(info0.kind, free0) }}
                    />
                    <div
                      className="absolute bottom-0 left-0 z-0 h-1/2 w-full"
                      style={{ backgroundColor: ttHalfFill(info1.kind, free1) }}
                    />
                    {pending0 && (
                      <div className="week-timetable-half-pending pointer-events-none absolute left-0 top-0 z-10 h-1/2 w-full" />
                    )}
                    {pending1 && (
                      <div className="week-timetable-half-pending pointer-events-none absolute bottom-0 left-0 z-10 h-1/2 w-full" />
                    )}
                    <div className="pointer-events-none absolute left-0 top-1/2 z-0 w-full border-t border-dashed border-slate-100" />
                    <div className="pointer-events-none absolute inset-0 z-20 overflow-visible p-0.5">
                      {blocks.map((b, idx) => (
                        <div
                          key={`${b.block.customerName}-${b.block.startMinute}-${idx}`}
                          className={cn(
                            "pointer-events-auto absolute flex flex-col rounded-sm border-l-2 p-1 shadow-md transition-all",
                            ttBlockClass(b.kind, b.block.statusLabel),
                          )}
                          style={{
                            left: `${idx * 10}%`,
                            width: "90%",
                            top: `${((b.block.startMinute - h0) / 60) * 100}%`,
                            height: `${((b.block.endMinute - b.block.startMinute) / 60) * 100}%`,
                            zIndex: 50 + idx,
                            minHeight: "24px",
                          }}
                        >
                          <div className="mb-0.5 flex items-center gap-1 truncate pr-4 text-[8px] font-bold leading-none">
                            <span>{b.block.customerName}</span>
                            {b.block.lessonNumber != null && (
                              <span className="shrink-0 rounded-[2px] bg-black/10 px-1 py-0.5 font-black opacity-80">
                                ({b.block.lessonNumber})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 text-[7px] font-medium opacity-90">
                            <Clock className="h-1.5 w-1.5" />
                            {minutesToTime(b.block.startMinute)}
                            {" - "}
                            {minutesToTime(b.block.endMinute)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  weekDates: string[];
  panelRangeLabel: string;
  canPanelPrev: boolean;
  canPanelNext: boolean;
  gridMinutes: number;
  slotStart: string;
  slotEnd: string;
  freeGrid: Map<string, Map<string, number[]>>;
  onToggleExpand: (id: string) => void;
  onPanelPrevWeek: () => void;
  onPanelNextWeek: () => void;
  onPanelPrevDay: () => void;
  onPanelNextDay: () => void;
  onPanelToday: () => void;
  onToggleSelectRow: (id: string) => void;
  onRemove?: (id: string) => void;
  onSelect?: (
    instrId: string,
    date: string,
    minute: number,
    free: boolean,
    info: SlotInfo,
  ) => void;
  onDeleteTentative?: (action: NonNullable<SlotInfo["deleteAction"]>) => void;
  onEditBooking?: (action: NonNullable<SlotInfo["editAction"]>) => void;
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
    weekDates,
    panelRangeLabel,
    canPanelPrev,
    canPanelNext,
    onSelect,
    onDeleteTentative,
    onEditBooking,
    gridMinutes,
    slotStart,
    slotEnd,
    freeGrid,
    onToggleExpand,
    onPanelPrevWeek,
    onPanelNextWeek,
    onPanelPrevDay,
    onPanelNextDay,
    onPanelToday,
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
          <div className="instructor-cell-inner">
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
                  ? `Hide ${instr.name}'s expanded timetable`
                  : `Show ${instr.name}'s expanded timetable`
              }
              title={
                isExpanded
                  ? "Hide this instructor's full timetable"
                  : "Show this instructor's monthly schedule"
              }
              onClick={() => onToggleExpand(instr.id)}
            >
              <span className="expand-chev" aria-hidden="true">
                {isExpanded ? "▲" : "▼"}
              </span>
              <span className="expand-label">Schedule</span>
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
          </div>
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
              onSelect={onSelect}
              onDeleteTentative={onDeleteTentative}
              onEditBooking={onEditBooking}
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
                  <span className="detail-badge">weekly timetable</span>
                </span>
                <span className="detail-sub">
                  {weekDates.length} days · {windowTotal} free slots
                </span>
                <div
                  className="detail-month-nav"
                  aria-label={`${instr.name} schedule week navigation`}
                >
                  <button
                    type="button"
                    className="detail-month-btn"
                    onClick={onPanelPrevWeek}
                    disabled={!canPanelPrev}
                    aria-label={`Show previous week in ${instr.name}'s expanded schedule`}
                    title="Previous week"
                  >
                    <ChevronsLeft aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="detail-month-btn"
                    onClick={onPanelPrevDay}
                    disabled={!canPanelPrev}
                    aria-label={`Show previous day in ${instr.name}'s expanded schedule`}
                    title="Previous day"
                  >
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="detail-today-btn"
                    onClick={onPanelToday}
                    title="Jump to today"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className="detail-month-btn"
                    onClick={onPanelNextDay}
                    disabled={!canPanelNext}
                    aria-label={`Show next day in ${instr.name}'s expanded schedule`}
                    title="Next day"
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="detail-month-btn"
                    onClick={onPanelNextWeek}
                    disabled={!canPanelNext}
                    aria-label={`Show next week in ${instr.name}'s expanded schedule`}
                    title="Next week"
                  >
                    <ChevronsRight aria-hidden="true" />
                  </button>
                  <span className="detail-month-label">{panelRangeLabel}</span>
                </div>
                {instr.areas.length > 0 && (
                  <span className="detail-areas">
                    Areas: {instr.areas.join(", ")}
                  </span>
                )}
              </div>
              {isExpandPending && !isExpanded ? (
                // Keep immediate feedback while React renders the selected
                // month's rows. The transition is also used by collapse, so
                // this remains deliberately separate from data loading. Skipped
                // when the row is already expanded (the auto-open path): the
                // lock derives it as expanded in the same paint as the roster
                // collapse, so flashing "Loading…" here would itself be the
                // page jump the user sees.
                <div className="detail-loading" role="status">
                  Loading {instr.name}&apos;s weekly timetable…
                </div>
              ) : (
                <WeekTimetable
                  instrId={instr.id}
                  weekDates={weekDates}
                  selectedDate={selectedDate}
                  dayFree={freeGrid.get(instr.id)}
                  onSelect={onSelect}
                  onDeleteTentative={onDeleteTentative}
                  onEditBooking={onEditBooking}
                  resolveInfo={resolveInfo}
                />
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
// their expanded monthly table.
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
    weekDates,
    panelRangeLabel,
    canPanelPrev,
    canPanelNext,
    gridMinutes,
    slotStart,
    slotEnd,
    expanded,
    pendingExpandId,
    selectedRows,
    rowColors,
    loadingRows,
    errorRows,
    onRetryLoad,
    onToggleExpand,
    onPanelPrevWeek,
    onPanelNextWeek,
    onPanelPrevDay,
    onPanelNextDay,
    onPanelToday,
    onToggleSelectRow,
    onRemove,
    onSelect,
    onDeleteTentative,
    onEditBooking,
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
            weekDates={weekDates}
            panelRangeLabel={panelRangeLabel}
            canPanelPrev={canPanelPrev}
            canPanelNext={canPanelNext}
            gridMinutes={gridMinutes}
            freeGrid={freeGrid}
            onToggleExpand={onToggleExpand}
            onPanelPrevWeek={onPanelPrevWeek}
            onPanelNextWeek={onPanelNextWeek}
            onPanelPrevDay={onPanelPrevDay}
            onPanelNextDay={onPanelNextDay}
            onPanelToday={onPanelToday}
            onToggleSelectRow={onToggleSelectRow}
            onRemove={onRemove}
            onSelect={onSelect}
            onDeleteTentative={onDeleteTentative}
            onEditBooking={onEditBooking}
            resolveInfo={resolveInfo}
          />
        ))}
        {loadingRows.map((li) => (
          <tr key={li.id} className="row row-loading">
            <td className="instructor-cell">
              <div className="instructor-cell-inner">{li.name}</div>
            </td>
            <td colSpan={timeCols.length}>
              <span className="row-loading-msg">Loading schedule…</span>
            </td>
          </tr>
        ))}
        {errorRows.map((er) => (
          <tr key={`err-${er.id}`} className="row row-error">
            <td className="instructor-cell">
              <div className="instructor-cell-inner">{er.name}</div>
            </td>
            <td colSpan={timeCols.length}>
              <span className="row-error-msg">
                Couldn&apos;t load schedule: {er.message}
              </span>
              <button
                type="button"
                className="row-error-retry"
                onClick={() => onRetryLoad(er.id)}
              >
                Retry
              </button>
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
  const { data: currentAdmin, isLoading: currentAdminLoading } =
    useCurrentAdmin();
  const { data: currentUser, isLoading: currentUserLoading } = useCurrentUser();
  // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
  const { user: authUser } = useAuth();
  const currentUserName = currentAdmin?.name || currentUser?.name || "";
  const rosterIdentityReady = !currentAdminLoading && !currentUserLoading;
  const rosterOwner = currentAdmin?.id
    ? `admin:${currentAdmin.id}`
    : currentUser?.id
      ? `user:${currentUser.id}`
      : null;
  const rosterStorageKey =
    rosterIdentityReady && rosterOwner
      ? `${ROSTER_STORAGE_PREFIX}:${rosterOwner}`
      : null;

  // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
  // Session lifecycle. Identity resolves asynchronously (currentAdmin /
  // currentUser are network-backed), so the logger is told a lookup is in
  // flight and holds early events back instead of writing them anonymously.
  useEffect(() => {
    return startMonitoringSession();
  }, []);
  useEffect(() => {
    setMonitorIdentity({
      userId: currentAdmin?.id ?? currentUser?.id ?? null,
      userName: currentUserName,
      role: currentAdmin ? "admin" : currentUser ? "user" : "",
      // Supabase Auth uid as well: currentAdmin/currentUser are network-backed
      // and can stay null when the Go service is unavailable, which must not
      // make every monitoring row anonymous.
      authUserId: authUser?.id ?? null,
    });
  }, [authUser, currentAdmin, currentUser, currentUserName]);

  const [filter, setFilter] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [dateIndex, setDateIndex] = useState(0);
  const [sortAnchorDate, setSortAnchorDate] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Keep expanding/collapsing the monthly timetable responsive and retain
  // immediate feedback while its slot grid is rendered.
  const [isExpandTransitionPending, startExpandTransition] = useTransition();
  const [pendingExpandId, setPendingExpandId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("freeDesc");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  // Expanded Schedule panel is an independent rolling 7-day window over the
  // full loaded range (past + future), navigated like Instructor Management's
  // "View Schedule". This holds its anchor day (empty = today).
  const [panelAnchorInput, setPanelAnchorInput] = useState<string>("");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dbZones, setDbZones] = useState<DbZone[] | null>(null);
  const [companyIds, setCompanyIds] = useState<Set<string> | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [locSearch, setLocSearch] = useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);
  const [tentativeModalOpen, setTentativeModalOpen] = useState(false);
  // The slot the side panel is describing. Set by EVERY cell click (the
  // booking form owns the panel while it is open, so this is only read once
  // that closes). Cleared on close so the panel falls back to its empty state.
  const [selectedSlot, setSelectedSlot] = useState<{
    instrId: string;
    date: string;
    minute: number;
    free: boolean;
    info: SlotInfo;
  } | null>(null);
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
  // Set (together with addingSlotMode) when Sales clicks "Change slot" on a
  // conflicting class: the next clicked free slot REPLACES that row of
  // pendingSlots instead of being appended. Cleared whenever the picking mode
  // ends, by any path (picked, cancelled, rejected, modal closed), so it can
  // never leak into a later "Add another class".
  const [replacingSlotIndex, setReplacingSlotIndex] = useState<number | null>(
    null,
  );
  useEffect(() => {
    if (!addingSlotMode) setReplacingSlotIndex(null);
  }, [addingSlotMode]);
  // Set while an existing tentative booking is being edited. Carries the
  // shared identity of the booking (its batch id and original
  // tentative_details) and every Schedule row id that was in it, so the modal
  // can update the rows, insert added ones and delete removed ones in one go.
  const [editContext, setEditContext] = useState<{
    batchId: string | null;
    baseDetails: Record<string, unknown> | null;
    rowIds: number[];
  } | null>(null);
  // A tentative booking belongs to ONE instructor: once Sales has picked a
  // slot, every additional class in that same booking must be the same
  // instructor's, so the learner isn't handed between instructors
  // mid-enrollment. Derived from the batch rather than stored as its own
  // state, so it cannot outlive the batch - every path that ends a booking
  // (cancel, successful submit) clears pendingSlots, and the lock
  // disappears with it.
  const lockedInstructorId =
    pendingSlots.length === 0 ? null : pendingSlots[0].instructorId;
  // The booking's instructor row is opened by the auto-expand effect below,
  // but that effect runs AFTER the paint that also collapses the roster to
  // this one instructor. Rendering the collapse and the expansion in separate
  // paints made the whole page visibly jump: the grid shrank (every other row
  // removed), then grew again once the effect expanded the row (via a
  // transition that first showed a short "Loading…" placeholder). Deriving the
  // locked instructor as expanded here folds both into the SAME render, so the
  // grid's height changes exactly once. The `expanded` set is still updated by
  // the effect, so cancelling a booking leaves the row open (see the Playwright
  // "hides the other rows" spec).
  const expandedForRender = useMemo(() => {
    if (!lockedInstructorId || expanded.has(lockedInstructorId)) {
      return expanded;
    }
    const next = new Set(expanded);
    next.add(lockedInstructorId);
    return next;
  }, [expanded, lockedInstructorId]);
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
  // slot" mode. handleSlotSelect appends the next clicked
  // free slot to pendingSlots and reopens the modal.
  //
  // Declared below toggleExpand (rather than alongside the other
  // tentative-booking handlers) because it reuses toggleExpand, and a
  // useCallback dep array is evaluated during render — referencing it up
  // here would throw a temporal-dead-zone ReferenceError.

  const handleRemoveSlot = useCallback(
    (index: number) => {
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      trackEvent("booking_slot_removed", {
        instructorId: pendingSlots[index]?.instructorId,
        slotDate: pendingSlots[index]?.date,
        slotStart: pendingSlots[index]?.startTime,
        slotEnd: pendingSlots[index]?.endTime,
        customerName: customerFormData.customerName,
        details: { batch_size_before: pendingSlots.length },
      });
      setPendingSlots((prev) => prev.filter((_, i) => i !== index));
    },
    [pendingSlots, customerFormData.customerName],
  );

  const handleCloseTentativeModal = useCallback(() => {
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    // A close with a non-empty batch is an abandoned booking: it never reached
    // the database, so it would otherwise be invisible in the success-rate
    // numbers.
    if (pendingSlots.length > 0) {
      trackEvent("booking_cancelled", {
        instructorId: lockedInstructorId,
        customerName: customerFormData.customerName,
        success: false,
        details: {
          classes_abandoned: pendingSlots.length,
          course: customerFormData.course,
        },
      });
    }
    setTentativeModalOpen(false);
    setPendingSlots([]);
    setCustomerFormData(DEFAULT_CUSTOMER_FORM(currentUserName));
    setEditContext(null);
    setAddingSlotMode(false);
    // Back to the panel's "select a slot" empty state rather than leaving a
    // stale slot's details on screen after its booking form is dismissed.
    setSelectedSlot(null);
  }, [
    currentUserName,
    customerFormData.course,
    customerFormData.customerName,
    lockedInstructorId,
    pendingSlots.length,
  ]);

  const handleTentativeSuccess = useCallback(() => {
    const message = editContext
      ? "✅ Tentative booking updated successfully."
      : pendingSlots.length > 1
        ? `✅ ${pendingSlots.length} tentative classes booked successfully.`
        : "✅ Tentative slot booked successfully.";
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    // One event per created hold, so "classes per user" and "instructors booked
    // most" are a plain GROUP BY rather than an array unnest. The customer
    // name IS recorded (separate column); phone and address never are.
    for (const slot of pendingSlots) {
      trackEvent("booking_created", {
        instructorId: slot.instructorId,
        slotDate: slot.date,
        slotStart: slot.startTime,
        slotEnd: slot.endTime,
        // The whole batch belongs to one customer, so every slot row carries
        // the name -- "who booked what" without needing a join.
        customerName: customerFormData.customerName,
        success: true,
        details: {
          is_edit: Boolean(editContext),
          course: customerFormData.course,
          payment_status: customerFormData.paymentStatus,
          batch_size: pendingSlots.length,
        },
      });
    }
    showSuccessNotice(message);
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
    setEditContext(null);
    setAddingSlotMode(false);
    refreshInstructors(affectedIds);
  }, [
    refreshInstructors,
    editContext,
    pendingSlots,
    showSuccessNotice,
    currentUserName,
    customerFormData.customerName,
    customerFormData.course,
    customerFormData.paymentStatus,
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
  // Full past+future window (the roster grid's `dates` above stays
  // forward-only so the main month grid and its totals are unchanged).
  const windowDates = useMemo(
    () => (data?.windowDates?.length ? data.windowDates : dates),
    [data, dates],
  );
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
  const visibleDates = useMemo(
    () => dates.filter((d) => d.startsWith(activeMonth)),
    [dates, activeMonth],
  );

  const safeDateIndex = Math.min(
    dateIndex,
    Math.max(0, visibleDates.length - 1),
  );
  const selectedDate = visibleDates[safeDateIndex] ?? null;

  // Expanded Schedule panel: an independent rolling 7-day window over the full
  // loaded range (past + future), navigated like Instructor Management's
  // "View Schedule" (<< < Today > >>). The main roster grid's month nav/day
  // strip above is untouched.
  const today = useMemo(() => istTodayISO(), []);
  const panelMinAnchor = windowDates[0] ?? today;
  const panelMaxAnchor =
    windowDates[Math.max(0, windowDates.length - 7)] ?? today;
  const panelAnchor = useMemo(() => {
    const raw = panelAnchorInput || today;
    if (raw < panelMinAnchor) return panelMinAnchor;
    if (raw > panelMaxAnchor) return panelMaxAnchor;
    return raw;
  }, [panelAnchorInput, today, panelMinAnchor, panelMaxAnchor]);
  const weekDates = useMemo(() => {
    const start = Math.max(0, windowDates.indexOf(panelAnchor));
    return windowDates.slice(start, start + 7);
  }, [windowDates, panelAnchor]);
  const panelRangeLabel = useMemo(
    () => formatPanelRange(weekDates),
    [weekDates],
  );
  const canPanelPrev = panelAnchor > panelMinAnchor;
  const canPanelNext = panelAnchor < panelMaxAnchor;
  const shiftPanel = useCallback(
    (deltaDays: number) => {
      setPanelAnchorInput((current) => {
        const shifted = addDaysISO(current || today, deltaDays);
        if (shifted < panelMinAnchor) return panelMinAnchor;
        if (shifted > panelMaxAnchor) return panelMaxAnchor;
        return shifted;
      });
    },
    [today, panelMinAnchor, panelMaxAnchor],
  );
  const panelPrevWeek = useCallback(() => shiftPanel(-7), [shiftPanel]);
  const panelNextWeek = useCallback(() => shiftPanel(7), [shiftPanel]);
  const panelPrevDay = useCallback(() => shiftPanel(-1), [shiftPanel]);
  const panelNextDay = useCallback(() => shiftPanel(1), [shiftPanel]);
  const panelToday = useCallback(() => setPanelAnchorInput(today), [today]);
  const goPrev = useCallback(() => {
    if (monthIdx > 0) {
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      trackEvent("month_changed", {
        success: true,
        details: { direction: "prev", month: months[monthIdx - 1] },
      });
      setSortAnchorDate((current) => current ?? selectedDate);
      setSelectedMonth(months[monthIdx - 1]);
      setDateIndex(0);
    }
  }, [monthIdx, months, selectedDate]);
  const goNext = useCallback(() => {
    if (monthIdx < months.length - 1) {
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      trackEvent("month_changed", {
        success: true,
        details: { direction: "next", month: months[monthIdx + 1] },
      });
      setSortAnchorDate((current) => current ?? selectedDate);
      setSelectedMonth(months[monthIdx + 1]);
      setDateIndex(0);
    }
  }, [monthIdx, months, selectedDate]);

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
  // unmistakable where to click next.
  const gridWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (addingSlotMode) {
      gridWrapRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [addingSlotMode]);

  // The expanded timetable is a copy of Instructor Management's grid, whose 7
  // day-columns fill the *visible panel*. The roster grid is far wider than the
  // viewport (18 slot columns), so expose the viewport width as a CSS var and
  // let .detail/.week-timetable size to it instead of the full table.
  useLayoutEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    const apply = () =>
      el.style.setProperty("--gc-viewport-w", `${el.clientWidth}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [config]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchDbZones(),
      // Tolerant: resolves to an empty set until the is_company_instructor
      // migration is applied, then becomes the rename-proof source of truth.
      fetchCompanyInstructorIds(),
      loadInstructorIndex(),
    ])
      .then(([zones, companyIds]) => {
        if (active) {
          setDbZones(zones);
          setCompanyIds(companyIds);
          setZoneError(null);
          warnOnCompanyInstructorZones(zones, companyIds);
        }
      })
      .catch((err: unknown) => {
        if (active)
          setZoneError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [loadInstructorIndex]);

  // Restore only the current account's explicitly added instructor IDs.
  // Configuration must be ready before loadInstructors() can fetch rows, and
  // both identity lookups must settle before an account-scoped key is safe.
  // The stored IDs are never rewritten from query results: a transient load
  // failure must leave the intended roster intact for the next reload.
  const restoredRosterKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "ready" || !rosterIdentityReady) return;
    try {
      // Never migrate an unscoped roster to whichever account happens to
      // sign in first on a shared browser. Old search text is also discarded
      // so the persistence payload contains instructor IDs only.
      localStorage.removeItem(LEGACY_ROSTER_STORAGE_KEY);
      localStorage.removeItem(LEGACY_SEARCH_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in restricted/private browser contexts.
    }
    if (
      !rosterStorageKey ||
      restoredRosterKeyRef.current === rosterStorageKey
    ) {
      return;
    }
    restoredRosterKeyRef.current = rosterStorageKey;
    try {
      const ids = parseStoredRoster(localStorage.getItem(rosterStorageKey));
      if (ids.length > 0) loadInstructors(ids);
    } catch {
      // Keep this visit session-only if storage is unavailable or corrupt.
    }
  }, [phase, rosterIdentityReady, rosterStorageKey, loadInstructors]);

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

  const toggleExpand = useCallback(
    (id: string) => {
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      trackEvent("instructor_schedule_toggled", {
        instructorId: id,
        success: true,
        details: { will_expand: !expanded.has(id) },
      });
      setPendingExpandId(id);
      startExpandTransition(() => {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      });
    },
    [expanded],
  );

  // Clears the stale row id once its transition actually settles, so a
  // later render can't misread a leftover pendingExpandId as "still
  // pending" for some other reason.
  useEffect(() => {
    if (!isExpandTransitionPending) setPendingExpandId(null);
  }, [isExpandTransitionPending]);

  const pendingExpandRowId = isExpandTransitionPending ? pendingExpandId : null;

  // Opens a row without the way `toggleExpand` can work against the caller:
  // membership is read inside the updater, so an already-open row is left
  // alone. That matters because this is driven from an effect, and an effect
  // runs twice under StrictMode — a toggle would open the row and then shut
  // it again on the second pass, leaving the booking with no schedule at all.
  const expandRow = useCallback((id: string) => {
    setPendingExpandId(id);
    startExpandTransition(() => {
      setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    });
  }, []);

  // Opening a booking auto-opens that instructor's "Schedule" view.
  //
  // Every next step of the flow ("+ Add another class", "Change slot") tells
  // Sales to click a green cell on the schedule, so the FIRST class should be
  // picked from the same view the later ones are, rather than having to be
  // chosen from a collapsed row and then re-opened mid-booking. Only the locked
  // instructor is on screen at this point (see the gridRows filter), so this
  // opens exactly the one row the booking belongs to.
  //
  // Keyed on `lockedInstructorId`, which is derived from the batch rather than
  // stored (see above), so it can only change when a booking starts or ends.
  // Re-running on an open row is a no-op, not a collapse.
  useEffect(() => {
    // Nothing to ensure outside a booking. This guard also keeps the telemetry
    // below honest: without it the effect would fire on mount and again when
    // the booking ends, both times with no instructor to report.
    if (!lockedInstructorId) return;
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    // Named "ensured", not "opened": expandRow is idempotent, so this also
    // fires when a class is added to a batch whose view is already open.
    // Counting opens would then over-report, by one per added class.
    trackEvent("booking_schedule_view_ensured", {
      instructorId: lockedInstructorId,
      success: true,
      details: { batch_size: pendingSlots.length },
    });
    expandRow(lockedInstructorId);
  }, [expandRow, lockedInstructorId, pendingSlots.length]);

  // Opening a booking collapses the roster to the booked instructor and
  // expands that instructor's timetable in one commit (see
  // `expandedForRender`), so the grid's height changes exactly once. This ref
  // carries the scroll offset captured by `handleSlotSelect` across that
  // commit; the layout effect re-applies it BEFORE the browser paints, so the
  // viewport never visibly jumps while the booking panel opens. The clamp
  // guards the case where the page got shorter than the captured offset (the
  // browser would otherwise force a scroll to its new maximum).
  const preserveScrollRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const captured = preserveScrollRef.current;
    if (captured === null) return;
    preserveScrollRef.current = null;
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    const target = Math.min(captured, maxScroll);
    if (window.scrollY !== target) window.scrollTo(0, target);
  });

  // Hides the modal (formData/pendingSlots stay exactly as they are — both
  // live in this component, not the modal) and arms "pick another slot" mode.
  // handleSlotSelect appends the next clicked free slot to
  // pendingSlots and reopens the modal.
  const handleAddAnotherSlot = useCallback(() => {
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    trackEvent("booking_add_another_class", {
      instructorId: lockedInstructorId,
      success: true,
      details: { batch_size: pendingSlots.length },
    });
    setAddingSlotMode(true);
    // `tentativeModalOpen` is deliberately LEFT TRUE. This used to close the
    // form, which was fine when the form was a floating dialog over the grid:
    // hiding it just handed the screen back to the calendar. But the panel now
    // renders `selectedSlot` detail whenever the form is not open, and
    // `selectedSlot` still points at the class the user just booked - so
    // "+ Add another class" snapped the panel to "In this booking / Already
    // added to this booking", i.e. the summary of the class they were in the
    // middle of building. Keeping the form mounted leaves the customer form
    // and Selected Slots exactly where they were; the next green cell click
    // appends and the form updates in place. See handleSlotSelect's
    // `addingSlotMode` append branch.
    // Reuse the row's existing "Schedule" control so the next class is
    // picked from the same view Sales would reach by hand, and from where
    // other days and months are reachable via its month arrows. Safe on an
    // already-open row: expandRow only opens, so it can be called
    // unconditionally.
    if (lockedInstructorId) expandRow(lockedInstructorId);
  }, [lockedInstructorId, expandRow, pendingSlots.length]);

  // "Change slot" on a conflicting class: same hide-the-modal / pick-on-the-
  // calendar flow as "+ Add another class", but remembers WHICH row is being
  // replaced so handleSlotSelect swaps it instead of appending.
  const handleChangeSlot = useCallback(
    (index: number) => {
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      trackEvent("booking_change_slot_started", {
        instructorId: lockedInstructorId,
        slotDate: pendingSlots[index]?.date,
        slotStart: pendingSlots[index]?.startTime,
        slotEnd: pendingSlots[index]?.endTime,
        customerName: customerFormData.customerName,
        success: true,
        details: { batch_size: pendingSlots.length, class_number: index + 1 },
      });
      setReplacingSlotIndex(index);
      setTentativeModalOpen(false);
      setAddingSlotMode(true);
      if (lockedInstructorId) expandRow(lockedInstructorId);
    },
    [
      customerFormData.customerName,
      expandRow,
      lockedInstructorId,
      pendingSlots,
    ],
  );

  const cancelAddingSlot = useCallback(() => {
    setAddingSlotMode(false);
    setTentativeModalOpen(true);
  }, []);

  // Roster persistence is keyed by the account-scoped storage key, which only
  // exists once useCurrentAdmin()/useCurrentUser() have resolved (that
  // requires a network round trip to the get-current-user edge function).
  // "Add instructor" used to call updateStoredRoster() directly, so clicking
  // before that resolved was a SILENT no-op: the instructor appeared on the
  // grid but was never written, and vanished on the next reload. Buffer the
  // intent here and flush it as soon as the key becomes available.
  const pendingRosterRef = useRef<{ id: string; shouldInclude: boolean }[]>([]);

  const updateStoredRoster = useCallback(
    (id: string, shouldInclude: boolean) => {
      if (!rosterStorageKey) {
        pendingRosterRef.current.push({ id, shouldInclude });
        return;
      }
      try {
        const ids = new Set(
          parseStoredRoster(localStorage.getItem(rosterStorageKey)),
        );
        if (shouldInclude) ids.add(id);
        else ids.delete(id);

        if (ids.size > 0) {
          localStorage.setItem(rosterStorageKey, JSON.stringify([...ids]));
        } else {
          localStorage.removeItem(rosterStorageKey);
        }
      } catch {
        // The dashboard remains usable for this session without storage.
      }
    },
    [rosterStorageKey],
  );

  useEffect(() => {
    if (!rosterStorageKey) return;
    const pending = pendingRosterRef.current;
    if (pending.length === 0) return;
    pendingRosterRef.current = [];
    for (const { id, shouldInclude } of pending) {
      updateStoredRoster(id, shouldInclude);
    }
  }, [rosterStorageKey, updateStoredRoster]);

  const addRosterInstructor = useCallback(
    (id: string) => {
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      trackEvent("instructor_added", {
        instructorId: id,
        success: true,
        details: { roster_size: data?.instructors.length ?? null },
      });
      updateStoredRoster(id, true);
      loadInstructors([id]);
    },
    [data?.instructors.length, loadInstructors, updateStoredRoster],
  );

  const removeRosterInstructor = useCallback(
    (id: string) => {
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      trackEvent("instructor_removed", {
        instructorId: id,
        success: true,
        details: { roster_size: data?.instructors.length ?? null },
      });
      updateStoredRoster(id, false);
      removeInstructor(id);
    },
    [data?.instructors.length, removeInstructor, updateStoredRoster],
  );

  const addToCompare = (id: string) => {
    addRosterInstructor(id);
    setCompareIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setSearchOpen(false);
  };

  const removeFromCompare = useCallback((id: string) => {
    setCompareIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const toggleRoster = (id: string) => {
    if (data?.instructors.some((i) => i.id === id)) removeRosterInstructor(id);
    else addRosterInstructor(id);
  };

  const handleLocation = useCallback(
    (lat: number, lng: number, label: string) => {
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      // Only the shape of the query is logged -- a place label can contain a
      // customer's home address, so the text itself is deliberately dropped.
      // The match count is NOT read here: locResult is declared further down
      // this render pass, so touching it (even from a dep array) is a
      // temporal-dead-zone crash. Which instructors matched is recorded by the
      // location effect below instead.
      trackEvent("location_searched", {
        success: true,
        details: {
          label_length: label.length,
          has_latlng: Number.isFinite(lat) && Number.isFinite(lng),
        },
      });
      setLocSearch({ lat, lng, label });
    },
    [],
  );

  const clearLocation = useCallback(() => {
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    trackEvent("location_cleared", { success: true });
    setLocSearch(null);
  }, []);

  const allInstructors = data?.allInstructors ?? EMPTY_LIGHT;

  const instructorsById = useMemo(() => {
    const map = new Map<string, InstructorRow>();
    if (!data) return map;
    for (const i of data.instructors) map.set(i.id, i);
    return map;
  }, [data]);

  const lockedInstructorName = lockedInstructorId
    ? (instructorsById.get(lockedInstructorId)?.name ?? "")
    : "";

  // Zones come from `instructor_service_zones`, which is already keyed by
  // Instructor id, so a name match is exact by construction — the KML
  // spelling-alias table is no longer needed on this read path.
  const zoneIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const z of dbZones ?? [])
      if (!map.has(z.name)) map.set(z.name, z.instructorId);
    return map;
  }, [dbZones]);

  const locMatch = useMemo<{
    ids: string[];
    zones: string[];
    via: "polygon" | "none";
    zoneIds: Map<string, string>;
  } | null>(() => {
    if (!locSearch || !dbZones) return null;
    // Polygon-only by design: an instructor matches when the searched point
    // falls inside their `instructor_service_zones` polygon. There is no
    // centroid/radius fallback — no zone row is a point, so it could never
    // contribute a match.
    //
    // `dbZones` comes from `fetchDbZones()` with no options, which excludes
    // rough polygons (see zones-db.ts). That is deliberate and is the only
    // reason this loop needs no `isRough` test of its own: a provisional
    // onboarding boundary must never be able to auto-match a customer, and
    // filtering at the single read point makes that impossible to forget here
    // or in any future caller. Do not pass `includeRough` on this path.
    //
    // Status: an instructor's polygon is matched regardless of status, so a
    // location-matched on-break instructor is returned here and then rendered
    // with a break badge via workingOnMap. They are not bookable
    // (isBookable requires status === "active", and availability.ts
    // isInstructorActive() does the same), so their slots are never proposed.
    // Inactive instructors never reach this point — isDisabled() removes them
    // from workingOnMap/visibleInstructors and from name search.
    //
    // Company instructors are Ops-assigned backups and are skipped even if a
    // zone is ever drawn for them. The `is_company_instructor` flag is
    // authoritative; the name list covers the window before that migration is
    // applied, and any zone whose Instructor.name changed. `z.name` is the
    // authoritative `Instructor.name` (see zones-db.ts), not the KML spelling.
    const names = dbZones
      .filter(
        (z) =>
          !isCompanyInstructorId(z.instructorId, companyIds) &&
          !isCompanyInstructor(z.name) &&
          pointInPolygon({ lat: locSearch.lat, lng: locSearch.lng }, z.coords),
      )
      .map((z) => z.name);
    const ids: string[] = [];
    const zoneIds = new Map<string, string>();
    for (const name of names) {
      const id = zoneIdByName.get(name);
      if (!id) continue;
      zoneIds.set(name, id);
      if (!ids.includes(id)) ids.push(id);
    }
    return {
      ids,
      zones: names,
      via: names.length ? "polygon" : "none",
      zoneIds,
    };
  }, [locSearch, dbZones, companyIds, zoneIdByName]);

  useEffect(() => {
    if (locMatch && locMatch.ids.length > 0) loadInstructors(locMatch.ids);
  }, [locMatch, loadInstructors]);

  const locResult = useMemo(() => {
    if (!locMatch || !dbZones) return null;
    const zoneByName = new Map(dbZones.map((z) => [z.name, z]));
    const instrs: InstructorRow[] = [];
    const instrColors: Record<string, string> = {};
    const zoneInfo: Record<
      string,
      { color: string; instructorName: string; rawName: string }
    > = {};
    for (const name of locMatch.zones) {
      const instructorId = locMatch.zoneIds.get(name);
      const instr = instructorId
        ? instructorsById.get(instructorId)
        : undefined;
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
  }, [locMatch, dbZones, instructorsById]);

  const rowColors = useMemo(
    () => new Map(Object.entries(locResult?.instrColors ?? {})),
    [locResult],
  );

  const locStatus: LocateStatus = useMemo(() => {
    if (!locSearch) return "idle";
    if (dbZones === null) return "loading";
    if (locResult && locResult.instrs.length > 0) return "found";
    return "none";
  }, [locSearch, dbZones, locResult]);

  const toggleSelectRow = useCallback((id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The roster persists across reloads, so it can
  // grow large over many sessions if instructors are never explicitly
  // removed -- a reload then restores everything ever added, which reads as
  // "all my past searches suddenly appeared" if it's been a while. Reset
  // clears the roster along with filters/search/selection/sort/location, so
  // it's a genuine single "back to a clean slate" action.
  const resetDashboard = () => {
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    trackEvent("dashboard_reset", {
      success: true,
      details: {
        roster_size: data?.instructors.length ?? 0,
        had_location: Boolean(locSearch),
        had_search: filter.length > 0,
      },
    });
    const ids = data?.instructors.map((i) => i.id) ?? [];
    for (const id of ids) removeInstructor(id);
    if (rosterStorageKey) {
      try {
        localStorage.removeItem(rosterStorageKey);
      } catch {
        // The in-memory reset still succeeds when storage is unavailable.
      }
    }
    setFilter("");
    setSearchOpen(false);
    setDateIndex(0);
    setSortAnchorDate(null);
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
  // used anywhere a NUMBER is shown ("X free"), so those always agree with
  // the strict, actually-bookable count windowTotals/dateTotals and the
  // expanded mini-row use, rather than freeSets' more lenient half-hour
  // opening count.
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

  // Month navigation changes the displayed date but must not reshuffle the
  // roster. Keep sorting anchored to the date that was active before the
  // first month-arrow click; selecting a date or sort option resets it.
  const effectiveSortDate =
    sortAnchorDate && dates.includes(sortAnchorDate)
      ? sortAnchorDate
      : selectedDate;
  const sortBookableCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!effectiveSortDate || !data) return map;
    for (const instr of data.instructors) {
      if (!isBookable(instr) && !workingOnMap.has(instr.id)) continue;
      map.set(
        instr.id,
        data.freeGrid.get(instr.id)?.get(effectiveSortDate)?.length ?? 0,
      );
    }
    return map;
  }, [data, effectiveSortDate, workingOnMap]);

  // freeGrid, not displayGrid: these are the collapsed-row/date-tab summary
  // counts, and they need to agree with what the expanded view's own count
  // and green cells show (both driven by freeGrid, the strict "a full
  // 1-hour class actually fits here" grid -- see MiniTimeRowInner's
  // per-cell freeGrid read below). displayGrid only requires a 30-min
  // gridMinutes-long opening,
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
      for (const d of visibleDates) total += instrDates?.get(d)?.length ?? 0;
      map.set(instr.id, total);
    }
    return map;
  }, [data, visibleDates, workingOnMap]);

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
      const freeCount = (i: InstructorRow) => sortBookableCounts.get(i.id) ?? 0;
      const byStatus = (a: InstructorRow, b: InstructorRow) =>
        instructorDisplayRank(a) - instructorDisplayRank(b);
      switch (sort) {
        case "alpha":
          return [...list].sort(
            (a, b) => byStatus(a, b) || a.name.localeCompare(b.name),
          );
        case "freeAsc":
          return [...list].sort(
            (a, b) =>
              byStatus(a, b) ||
              freeCount(a) - freeCount(b) ||
              a.name.localeCompare(b.name),
          );
        default:
          return [...list].sort(
            (a, b) =>
              byStatus(a, b) ||
              freeCount(b) - freeCount(a) ||
              a.name.localeCompare(b.name),
          );
      }
    },
    [sort, sortBookableCounts],
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
  const handleSlotSelect = useCallback(
    (
      instrId: string,
      date: string,
      minute: number,
      free: boolean,
      info: SlotInfo,
    ) => {
      // Any single click selects the slot, so the side panel can show it.
      // A taken slot (booked / tentative / paused / unavailable) has nothing
      // to book, so it just displays its details -- no validation, no notice,
      // and it must not disturb an in-progress booking.
      setSelectedSlot({ instrId, date, minute, free, info });
      if (!free) return;

      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      // Defined inline so the rejection telemetry needs no extra deps in the
      // array below. `reason` is a machine-readable bucket -- the human-facing
      // notice text stays the app's own wording.
      const trackRejected = (reason: string, extra?: Record<string, unknown>) =>
        trackEvent("slot_selected", {
          instructorId: instrId,
          slotDate: date,
          slotStart: minutesToTime(minute),
          slotEnd: minutesToTime(minute + 60),
          success: false,
          errorMessage: reason,
          details: { ...extra, adding_slot_mode: addingSlotMode },
        });

      // Defence in depth for the one-instructor-per-booking lock. Other
      // instructors' rows aren't rendered while locked, so this should be
      // unreachable - but gridRows is a render-time filter, and a stale
      // render or a programmatic call must never be able to put a second
      // instructor into a booking.
      if (lockedInstructorId && instrId !== lockedInstructorId) {
        trackRejected("different_instructor_locked", {
          locked_instructor: lockedInstructorId,
        });
        showSlotNotice(
          `This booking is for ${lockedInstructorName}. Cancel or submit it before booking a class with a different instructor.`,
        );
        return;
      }

      // Re-verify instructor is still available
      const instr = instructorsById.get(instrId);
      if (
        !instr ||
        instr.enabled === false ||
        (instr.status ?? "active") !== "active"
      ) {
        trackRejected("instructor_unavailable");
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
        trackRejected("already_tentative");
        showSlotNotice("Tentative block already exists for this slot.");
        return;
      }

      // Validate 1-hour block availability. A genuine overlap always
      // blocks here. A buffer-only conflict is only let through when
      // we're adding another class to an in-progress batch AND the
      // customer's already-entered phone actually waives it (chaining
      // back-to-back classes for the SAME learner) -- that's the one
      // case where opening the modal anyway is useful. A fresh
      // fresh click has no customer yet to justify that, so it would
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
        trackRejected("direct_conflict");
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
          trackRejected("buffer_conflict", { gap_minutes: gapMinutes });
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
        trackRejected("instructor_unavailability");
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
        const overlapsExisting = pendingSlots.some((s, i) => {
          // The class being replaced is about to disappear, so it cannot
          // clash with its own replacement.
          if (i === replacingSlotIndex) return false;
          if (s.instructorId !== instrId || s.date !== date) return false;
          const sStart = timeToMinutes(s.startTime);
          const sEnd = timeToMinutes(s.endTime);
          return minute < sEnd && sStart < newEnd;
        });
        if (overlapsExisting) {
          trackRejected("overlaps_own_batch");
          showSlotNotice(
            "That slot overlaps with a class already in this booking.",
          );
          setAddingSlotMode(false);
          setTentativeModalOpen(true);
          return;
        }
        if (
          replacingSlotIndex !== null &&
          replacingSlotIndex < pendingSlots.length
        ) {
          // "Change slot": swap the conflicting row in place, so its position
          // (Class N) and the rest of the batch are untouched.
          const replaced = pendingSlots[replacingSlotIndex];
          setPendingSlots((prev) =>
            prev.map((s, i) => (i === replacingSlotIndex ? newSlot : s)),
          );
          setAddingSlotMode(false);
          setTentativeModalOpen(true);
          // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
          trackEvent("booking_slot_changed", {
            instructorId: instrId,
            slotDate: date,
            slotStart: newSlot.startTime,
            slotEnd: newSlot.endTime,
            customerName: customerFormData.customerName,
            success: true,
            details: {
              class_number: replacingSlotIndex + 1,
              replaced_date: replaced?.date,
              replaced_start: replaced?.startTime,
              batch_size: pendingSlots.length,
            },
          });
          return;
        }
        setPendingSlots((prev) => [...prev, newSlot]);
        setAddingSlotMode(false);
        setTentativeModalOpen(true);
        // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
        trackEvent("booking_class_added", {
          instructorId: instrId,
          slotDate: date,
          slotStart: newSlot.startTime,
          slotEnd: newSlot.endTime,
          // The form for this batch is left untouched when a slot is added, so
          // its name is the booking's customer -- empty if Sales has not typed
          // it yet, which is stored as null rather than guessed.
          customerName: customerFormData.customerName,
          success: true,
          details: { batch_size_after: pendingSlots.length + 1 },
        });
        return;
      }

      // Fresh booking — reset to a clean single-slot batch and blank
      // customer form. Auto-fill address from map search if available.
      // Capture the current scroll offset first: the roster collapses to this
      // instructor and its schedule expands in the same commit below, and the
      // layout effect keyed on `preserveScrollRef` restores this offset before
      // paint so the page doesn't jump.
      preserveScrollRef.current = window.scrollY;
        setEditContext(null);
      setPendingSlots([newSlot]);
      setCustomerFormData(
        DEFAULT_CUSTOMER_FORM(currentUserName, locSearch?.label ?? ""),
      );
      setTentativeModalOpen(true);
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      // The slot click that opens the booking form, plus the class that was
      // selected. Split from booking_created so "attempts" and "successes" are
      // separately countable.
      trackEvent("booking_started", {
        instructorId: instrId,
        slotDate: date,
        slotStart: newSlot.startTime,
        slotEnd: newSlot.endTime,
        // A new customer does not exist until the form is filled.
        customerName: null,
        success: true,
        details: { customer_mode: "new" },
      });
    },
    [
      config?.instructor_gap_minutes,
      showSlotNotice,
      instructorsById,
      blocksIndex,
      addingSlotMode,
      replacingSlotIndex,
      pendingSlots,
      currentUserName,
      customerFormData.customerPhone,
      customerFormData.customerName,
      data?.freeGrid,
      locSearch,
      lockedInstructorId,
      lockedInstructorName,
    ],
  );

  // Fresh re-check of a single pending slot's 1-hour availability, run
  // again right before submit (the grid may have changed since it was
  // added to the batch, possibly minutes ago). Unlike the click
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

  // Bulk Add (copied from Instructor Management's "Bulk Add Schedules").
  //
  // Like Instructor Management, this appends EVERY generated slot (only a
  // slot for a different instructor than the locked one is ignored). It does
  // not filter busy slots out: the modal checks each row against the DB and
  // shows Free / Conflict, and a conflicting row blocks submit until it is
  // removed. Filtering here is what used to turn 10 copies into 7.
  const handleAddBulkSlots = useCallback(
    async (
      newSlots: SlotPick[],
    ): Promise<{ added: number; skipped: string[] }> => {
      if (!lockedInstructorId) {
        return { added: 0, skipped: ["No booking is in progress."] };
      }

      const accepted: SlotPick[] = [];
      for (const slot of newSlots) {
        if (slot.instructorId !== lockedInstructorId) {
          // skip silently like instructor management
          continue;
        }
        accepted.push(slot);
      }

      if (accepted.length > 0) {
        setPendingSlots((prev) => [...prev, ...accepted]);
      }

      return { added: accepted.length, skipped: [] };
    },
    [lockedInstructorId],
  );

  // Edit an existing tentative booking: reopen the booking form loaded with
  // every class booked together, so the shared customer fields and each
  // class's date/time can be corrected in a single save. The booking is found
  // by batch_id when present (new bookings) and falls back to customer
  // phone+name (bookings made before batch_id existed). Who may edit is
  // decided in resolveInfo: the creator for any payment status, anyone for an
  // unpaid slot.
  const handleEditBooking = useCallback(
    (action: NonNullable<SlotInfo["editAction"]>) => {
      const td = action.tentativeDetails ?? {};
      const batchId =
        typeof td.batch_id === "string" && td.batch_id ? td.batch_id : null;
      const phone = typeof td.phone === "string" ? td.phone : "";
      const name = typeof td.name === "string" ? td.name : "";

      const isTentativeHold = (b: BlockDetail) =>
        b.isTentative && (b.status === "hold" || b.status === "booked");
      const matchesBooking = (b: BlockDetail) => {
        if (b.instructorId !== action.instrId) return false;
        if (!isTentativeHold(b)) return false;
        const bd = b.rawTentativeDetails ?? {};
        const bBatch =
          typeof bd.batch_id === "string" && bd.batch_id ? bd.batch_id : null;
        // A request that carries a batch id only accepts rows with that same
        // id. Only when NEITHER side has one (legacy rows) fall back to the
        // customer identity.
        if (batchId || bBatch) return bBatch === batchId;
        const bPhone = typeof bd.phone === "string" ? bd.phone : "";
        const bName = typeof bd.name === "string" ? bd.name : "";
        return phone !== "" && bPhone === phone && bName === name;
      };

      const siblings = (data?.blocks ?? [])
        .filter(matchesBooking)
        .sort((a, b) =>
          a.date === b.date
            ? a.startMinute - b.startMinute
            : a.date < b.date
              ? -1
              : 1,
        );
      // Guarantee the clicked row is present even if the batch/identity match
      // somehow missed it (e.g. it was the only row and had no details).
      if (!siblings.some((b) => b.id === action.blockId)) {
        const clicked = (data?.blocks ?? []).find(
          (b) => b.id === action.blockId,
        );
        if (clicked) siblings.unshift(clicked);
      }

        setEditContext({
        batchId,
        baseDetails: action.tentativeDetails,
        rowIds: siblings.map((b) => b.id),
      });
      setPendingSlots(
        siblings.map((b) => ({
          instructorId: b.instructorId,
          instructorName: instructorsById.get(b.instructorId)?.name ?? "",
          date: b.date,
          startTime: minutesToTime(b.startMinute),
          endTime: minutesToTime(b.endMinute),
          scheduleId: b.id,
        })),
      );
      setCustomerFormData({
        customerName: name,
        customerPhone: phone,
        // Keep the original creator: another agent editing an unpaid slot
        // must not take over (or strip) the creator's ownership.
        salesAgent:
          typeof td.sales_agent === "string" && td.sales_agent.trim()
            ? td.sales_agent
            : currentUserName,
        paymentStatus:
          td.payment_status === "half_paid" || td.payment_status === "full_paid"
            ? td.payment_status
            : "unpaid",
        customerAddress: typeof td.address === "string" ? td.address : "",
        course: typeof td.course === "string" && td.course ? td.course : "demo",
      });
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      trackEvent("booking_edit_started", {
        instructorId: action.instrId,
        bookingId: String(action.blockId),
        customerName: name || null,
        success: true,
        details: {
          batch_size: siblings.length,
          has_batch_id: Boolean(batchId),
        },
      });
      setSelectedSlot(null);
      setTentativeModalOpen(true);
    },
    [currentUserName, data?.blocks, instructorsById],
  );

  // Lets Sales fix a wrong entry (e.g. a typo'd name/phone or a slot picked
  // by mistake) without needing Operations or Instructor Management —
  // this works regardless of payment status, since it's just removing a
  // mistaken hold.
  // Opens the in-app confirm dialog below rather than the browser's native
  // window.confirm() -- unstyled, doesn't match the app, and (unlike this
  // dialog) can't be dismissed by clicking outside or be given a real
  // destructive-action button.
  const [pendingDelete, setPendingDelete] = useState<NonNullable<
    SlotInfo["deleteAction"]
  > | null>(null);

  const handleDeleteTentative = useCallback(
    (action: NonNullable<SlotInfo["deleteAction"]>) => {
      setPendingDelete(action);
    },
    [],
  );

  const confirmDeleteTentative = useCallback(() => {
    const action = pendingDelete;
    if (!action) return;
    setPendingDelete(null);
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    void measureApi(
      "schedule.delete_tentative",
      () => supabase.from("Schedule").delete().eq("id", action.blockId),
      {
        method: "DELETE",
        details: { instructor_id: action.instrId },
        // PostgREST resolves { error } rather than throwing, so map it here.
        resolveError: (res) =>
          (res as { error?: unknown } | null)?.error ?? null,
      },
    ).then(({ error }) => {
      trackEvent("tentative_deleted", {
        instructorId: action.instrId,
        bookingId: String(action.blockId),
        customerName: action.customerName,
        success: !error,
        error,
      });
      if (error) {
        showSlotNotice(`Couldn't delete slot: ${error.message}`);
        return;
      }
      showSuccessNotice("Tentative slot deleted.");
      refreshInstructors([action.instrId]);
    });
  }, [pendingDelete, refreshInstructors, showSlotNotice, showSuccessNotice]);

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
        unknown[] | null | undefined;
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
      // While "Change slot" is replacing a class, that class is about to
      // disappear: it must not render as Selected or block its own replacement.
      const sameInstrDate = pendingSlots.filter(
        (s, i) =>
          i !== replacingSlotIndex &&
          s.instructorId === instrId &&
          s.date === date,
      );
      // Matches BOTH 30-minute grid cells inside the pending slot's full
      // 1-hour span [startMinute, endMinute) — not just the cell exactly
      // at its start minute. That was the earlier bug: only the first
      // half-hour of a selected class showed blue, since the check
      // required minute === startTime instead of "falls within the
      // range".
      const pendingIndex = pendingSlots.findIndex(
        (s, i) =>
          i !== replacingSlotIndex &&
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
            deleteAction: null,
          };
        }
      }

      if (free) {
        return {
          title: "Free",
          detail: [timeLabel, `Instructor: ${name}`],
          kind: "free",
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
        // A "booked" row can still be a tentative hold: Instructor
        // Management's own tentative-booking feature (and some legacy
        // data) writes status:"booked" + isTentative:true instead of the
        // Sales Dashboard's status:"hold" + isTentative:true — same
        // meaning (a hold, not a real confirmed class), different status
        // value. isTentative is the authoritative flag regardless of which
        // flow created the row, so it takes priority over the status
        // string for BOTH "booked" and "hold"; "completed" is excluded on
        // purpose (a class that already happened is real regardless of any
        // leftover isTentative flag).
        const isSalesTentative =
          cover.isTentative === true &&
          (cover.status === "hold" || cover.status === "booked");
        const scheduleBlock = (
          statusLabel: string,
        ): SlotInfo["scheduleBlock"] => {
          if (isBuffer || timeStarts.length === 0) return undefined;
          const firstMinute = timeStarts[0];
          const visibleEnd = timeStarts[timeStarts.length - 1] + slotLen;
          const anchorMinute = Math.max(
            firstMinute,
            firstMinute +
              Math.floor((cover.startMinute - firstMinute) / slotLen) * slotLen,
          );
          if (minute !== anchorMinute || anchorMinute >= visibleEnd) {
            return undefined;
          }
          const span = Math.max(
            1,
            Math.ceil(
              (Math.min(cover.endMinute, visibleEnd) - anchorMinute) / slotLen,
            ),
          );
          return {
            customerName: cover.learnerName || "Scheduled class",
            lessonNumber: cover.lessonNumber,
            startMinute: cover.startMinute,
            endMinute: cover.endMinute,
            statusLabel,
            span,
          };
        };

        if (
          (cover.status === "booked" && !isSalesTentative) ||
          cover.status === "completed"
        ) {
          const detail = [blockTime, `Instructor: ${name}`];
          if (cover.learnerName)
            detail.push(
              `Learner: ${cover.learnerName}${
                cover.lessonNumber != null
                  ? ` (Class ${cover.lessonNumber})`
                  : ""
              }`,
            );
          if (cover.area) detail.push(`${ADDRESS_DETAIL_PREFIX}${cover.area}`);
          if (cover.courseName) detail.push(`Course: ${cover.courseName}`);
          return {
            title: isBuffer
              ? `Buffer for ${cover.status === "booked" ? "Booked" : "Completed"} class`
              : cover.status === "booked"
                ? "Booked class"
                : "Completed class",
            detail,
            kind: isBuffer ? "default" : "booked",
            deleteAction: null,
            card: isBuffer
              ? undefined
              : buildSlotCard({
                  startMinute: cover.startMinute,
                  endMinute: cover.endMinute,
                  instructor: name,
                  learner: cover.learnerName,
                  lessonNumber: cover.lessonNumber,
                  phone: cover.learnerPhone,
                  location: cover.area,
                  course: cover.courseName,
                  // Real classes carry no tentative-only fields — Instructor
                  // Management shows these as N/A for a confirmed class.
                  description: "",
                  lead: "",
                  payment: "",
                }),
            scheduleBlock: scheduleBlock(
              cover.status === "booked"
                ? "Booked"
                : cover.startedAt && cover.endedAt
                  ? "Done (OTP)"
                  : "Done (manual)",
            ),
          };
        }
        if (
          cover.status === "pending_payment" ||
          cover.status === "hold" ||
          isSalesTentative
        ) {
          // pending_payment (and a "hold"/"booked" row that isn't flagged
          // isTentative) is a real learner-side booking mid payment — not
          // something Sales/Instructor-Management created as a hold, never
          // overridable here, and shown as "booked" (purple), not
          // "tentative" (yellow).
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
              deleteAction: null,
              card: isBuffer
                ? undefined
                : buildSlotCard({
                    startMinute: cover.startMinute,
                    endMinute: cover.endMinute,
                    instructor: name,
                    learner: cover.learnerName,
                    lessonNumber: cover.lessonNumber,
                    phone: cover.learnerPhone,
                    location: cover.area,
                    course: cover.courseName,
                    description: "",
                    lead: "",
                    payment: "Payment pending",
                  }),
              panelDetail: isBuffer
                ? undefined
                : ["Slot is on hold until payment completes."],
              scheduleBlock: scheduleBlock("Payment pending"),
            };
          }
          if (isBuffer) {
            return {
              title: "Buffer for Tentative slot",
              detail: [blockTime, `Instructor: ${name}`],
              kind: "default",
              deleteAction: null,
            };
          }
          // The actual tentative slot itself (not its buffer). Payment
          // status gates both the label and who may edit — default to
          // "unpaid" only if the field is missing entirely (shouldn't happen
          // for a real tentative row, but favors allowing the edit over
          // silently hiding it).
          const paymentStatus = cover.paymentStatus ?? "unpaid";
          const isUnpaid = paymentStatus === "unpaid";
          // Same fields (and the same cover.learnerName/area/courseName
          // already computed from tentative_details) the "booked" branch
          // above shows — a tentative hold has a real customer attached
          // too, and a sales agent hovering it needs to see who, not just
          // that a slot is taken.
          const tentativeDetail = [blockTime, `Instructor: ${name}`];
          if (cover.learnerName)
            tentativeDetail.push(`Learner: ${cover.learnerName}`);
          if (cover.area)
            tentativeDetail.push(`${ADDRESS_DETAIL_PREFIX}${cover.area}`);
          if (cover.courseName)
            tentativeDetail.push(`Course: ${cover.courseName}`);
          // Only the sales agent who created a tentative hold can delete
          // it — matched against tentative_details.sales_agent, the same
          // field the "Sales Agent" form field is locked to (see
          // currentUserName above), trimmed/case-insensitive so a stray
          // space or capitalization difference doesn't wrongly block the
          // actual creator. Fails CLOSED, not open: a row with no recorded
          // sales_agent (e.g. Instructor-Management-created rows never set
          // this field) has no verifiable creator, so it must NOT be
          // deletable from here either — the earlier version of this check
          // treated "unknown creator" as "anyone may delete it", which is
          // exactly backwards and let any logged-in account delete a real
          // customer's tentative hold it never created.
          const creatorName =
            typeof cover.rawTentativeDetails?.sales_agent === "string"
              ? cover.rawTentativeDetails.sales_agent.trim()
              : "";
          const canDelete =
            creatorName !== "" &&
            creatorName.toLowerCase() === currentUserName.trim().toLowerCase();
          // The creator may edit their own tentative slot at any payment
          // status; anyone may edit an unpaid one (e.g. to hand it to a
          // learner who is now paying). Delete stays creator-only.
          const canEdit = canDelete || isUnpaid;
          if (isUnpaid) {
            tentativeDetail.push("Unpaid — anyone can edit this booking.");
          }
          if (!canDelete) {
            tentativeDetail.push(
              creatorName
                ? `Created by ${creatorName} — only they can delete${canEdit ? "" : " or edit"} this.`
                : `No creator recorded for this slot — it can't be deleted${canEdit ? "" : " or edited"} from here.`,
            );
          }
          // Keep the panel's existing hold notes (edit/creator) alongside
          // the card, so nothing the panel showed before is lost.
          const panelNotes = tentativeDetail.filter(
            (line) =>
              line !== blockTime &&
              !line.startsWith("Instructor: ") &&
              !line.startsWith("Learner: ") &&
              !line.startsWith(ADDRESS_DETAIL_PREFIX) &&
              !line.startsWith("Course: "),
          );
          return {
            title: isUnpaid ? "🟡 Tentative (Unpaid)" : "Tentative",
            detail: tentativeDetail,
            kind: "tentative",
            panelDetail: panelNotes,
            card: buildSlotCard({
              startMinute: cover.startMinute,
              endMinute: cover.endMinute,
              instructor: name,
              learner: cover.learnerName,
              lessonNumber: cover.lessonNumber,
              phone: cover.learnerPhone,
              location: cover.area,
              // Instructor Management's tentative card shows the hold's
              // description (not a course) plus its lead and payment info.
              course: "",
              description: cover.courseName,
              lead: cover.rawTentativeDetails?.leadName
                ? String(cover.rawTentativeDetails.leadName)
                : "",
              payment:
                paymentStatus === "full_paid"
                  ? "Full paid"
                  : paymentStatus === "half_paid"
                    ? "Half paid"
                    : paymentStatus === "unpaid"
                      ? "Unpaid"
                      : paymentStatus,
            }),
            deleteAction: canDelete
              ? {
                  blockId: cover.id,
                  instrId,
                  customerName:
                    typeof cover.rawTentativeDetails?.name === "string" &&
                    cover.rawTentativeDetails.name
                      ? cover.rawTentativeDetails.name
                      : "this customer",
                }
              : null,
            // Creator: any payment status. Anyone else: unpaid slots only.
            editAction: canEdit
              ? {
                  blockId: cover.id,
                  instrId,
                  tentativeDetails: cover.rawTentativeDetails,
                }
              : null,
            scheduleBlock: scheduleBlock("Tentative"),
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
            kind: isBuffer ? "default" : "paused",
            deleteAction: null,
            scheduleBlock: scheduleBlock(
              cover.pauseReason.toLowerCase() === "payment"
                ? "Payment due"
                : "Paused",
            ),
          };
        }
        return {
          title: cap(cover.status),
          detail: [blockTime, `Instructor: ${name}`],
          kind: "default",
          deleteAction: null,
          scheduleBlock: scheduleBlock(cap(cover.status)),
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
          kind: "unavailable",
          deleteAction: null,
        };
      }

      return {
        title: "Busy",
        detail: [timeLabel, `Instructor: ${name}`],
        kind: "default",
        deleteAction: null,
      };
    };
  }, [
    config,
    instructorsById,
    blocksIndex,
    pendingSlots,
    addingSlotMode,
    replacingSlotIndex,
    currentUserName,
    timeStarts,
  ]);

  // A locked booking shows only its own instructor's row, so there is no
  // other instructor left to click while picking the next class. This
  // is a render-time filter ONLY - `rows`/`visibleInstructors` (and the
  // persisted roster behind them) are untouched, so the full grid comes back
  // untouched the moment the booking ends.
  const gridRows = useMemo(() => {
    const base =
      compareIds.length === 0 ? rows : sortRoster(compareInstructors);
    if (!lockedInstructorId) return base;
    return base.filter((i) => i.id === lockedInstructorId);
  }, [compareIds, compareInstructors, rows, sortRoster, lockedInstructorId]);

  // Guarantees the timeline (06:00 column onward) always starts exactly
  // where the Instructor column ends, for any name length. The table's own
  // auto column-sizing can't be trusted here: browsers don't reliably feed a
  // box's true content width back into the table's intrinsic-width algorithm
  // — so a sufficiently long name can render wider than the column the
  // browser decided to allocate, spilling into the first time column.
  // Measuring the actual rendered content width (scrollWidth, which reports
  // the true extent even when it overflows the box) and handing the table an
  // explicit min-width sidesteps that unreliable inference entirely.
  //
  // The +1 is load-bearing, not slack. scrollWidth is an INTEGER: the real
  // min-content width is fractional (measured 346.547px for `test_dp`). When
  // the min-width lands a hair UNDER the fractional min-content, the two cells
  // in that one column stop agreeing — <th> takes its specified min-width
  // exactly while <td> is floored up by its own intrinsic width — and the
  // header's time lines sit a fraction of a pixel off the body's, which is
  // visible as a ragged seam down the grid. +1 puts min-width safely back on
  // the ">= intrinsic" side of that boundary, which is the only state in which
  // the header and body cells are guaranteed to resolve to one width. It is
  // derived from the content width, not from the applied width, so the column
  // still shrinks correctly when a shorter name replaces a longer one.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cells = root.querySelectorAll<HTMLElement>(".instructor-cell");
    let widest = 0;
    cells.forEach((cell) => {
      if (cell.scrollWidth > widest) widest = cell.scrollWidth;
    });
    if (widest > 0) {
      root.style.setProperty("--instr-col-width", `${widest + 1}px`);
    }
  }, [gridRows]);

  // Instructors whose schedules are still being fetched. The empty state must
  // wait for these: otherwise "No instructors loaded yet" renders underneath a
  // "Loading schedule…" row while a newly added instructor is in flight.
  const loadingRows = (data?.loading ?? []).filter(
    (li) => !lockedInstructorId || li.id === lockedInstructorId,
  );

  // Instructors whose fetch failed. Rendered as in-grid rows (name + reason +
  // Retry) so a failure is never masked by the "No instructors loaded yet"
  // empty state, which is what used to happen because `data.errors` was
  // written but never read by the UI.
  const errorRows = useMemo<SalesErrorRow[]>(() => {
    const errors = data?.errors ?? {};
    const names = data?.names;
    return Object.entries(errors)
      .map(([id, message]) => ({
        id,
        name: names?.get(id) ?? "",
        message,
      }))
      .filter((r) => !lockedInstructorId || r.id === lockedInstructorId);
  }, [data, lockedInstructorId]);

  const retryLoadInstructor = useCallback(
    (id: string) => {
      loadInstructors([id]);
    },
    [loadInstructors],
  );

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
          <div className="state dashboard-loading-state">
            <LoadingSpinner size="sm" className="dashboard-loading-spinner" />
            <span>Loading availability…</span>
          </div>
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
              <div
                className="topbar-legend"
                aria-label="Schedule status legend"
              >
                <span className="tt-legend-item">
                  <span className="h-2 w-2 rounded-sm bg-indigo-500" />
                  Booked
                </span>
                <span className="tt-legend-item">
                  <span className="h-2 w-2 rounded-sm bg-amber-400" />
                  Tentative
                </span>
                <span className="tt-legend-item">
                  <span className="h-2 w-2 rounded-sm bg-blue-500" />
                  Ongoing
                </span>
                <span className="tt-legend-item">
                  <span className="h-2 w-2 rounded-sm bg-emerald-500" />
                  Done (OTP)
                </span>
                <span className="tt-legend-item">
                  <span className="h-2 w-2 rounded-sm bg-orange-400" />
                  Done (manual)
                </span>
                <span className="tt-legend-item">
                  <span className="h-2 w-2 rounded-sm bg-slate-500" />
                  Paused
                </span>
                <span className="tt-legend-item">
                  <span className="h-2 w-2 rounded-sm bg-red-500" />
                  Payment Due
                </span>
              </div>
              <div className="controls-row">
                <select
                  className="sort-select"
                  value={sort}
                  onChange={(e) => {
                    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
                    trackEvent("sort_changed", {
                      success: true,
                      details: { sort: e.target.value },
                    });
                    setSort(e.target.value as SortKey);
                    setSortAnchorDate(selectedDate);
                  }}
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
                      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
                      // Query length + hit count only: a typed name is a person.
                      const q = e.target.value.trim().toLowerCase();
                      trackEvent("instructor_searched", {
                        success: true,
                        details: {
                          query_length: e.target.value.length,
                          matches: q
                            ? allInstructors.filter(
                                (i) =>
                                  !isDisabled(i) &&
                                  i.name.toLowerCase().includes(q),
                              ).length
                            : 0,
                        },
                      });
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

        {/* Two-column body: the calendar keeps its width and the slot panel
            takes the space to its right, instead of the booking form
            covering the grid. Mirrors InstructorSchedulePage's detail column. */}
        <div className="shell-body">
          {/* Slot panel. Sits on the LEFT of the calendar: a booking form
              for a free slot, that slot's details for a taken one, and a
              "select a slot" prompt when nothing is picked. Every cell is a
              single click now, so both cases come through this one handler. */}
          <aside className="slot-panel" aria-label="Slot panel">
            {tentativeModalOpen ? (
              <TentativeBookingModal
                variant="panel"
                isOpen={tentativeModalOpen}
                onClose={handleCloseTentativeModal}
                onSuccess={handleTentativeSuccess}
                slots={pendingSlots}
                onRemoveSlot={handleRemoveSlot}
                onAddAnotherSlot={handleAddAnotherSlot}
                onChangeSlot={handleChangeSlot}
                onAddBulkSlots={handleAddBulkSlots}
                validateSlot={validateSlotFresh}
                formData={customerFormData}
                onFormDataChange={setCustomerFormData}
                editContext={editContext}
              />
            ) : selectedSlot ? (
              <div className="slot-panel-detail">
                <div className="slot-panel-detail-top">
                  <span
                    className={`slot-panel-badge slot-panel-badge-${selectedSlot.info.kind}`}
                  >
                    {SLOT_KIND_LABELS[selectedSlot.info.kind] ??
                      selectedSlot.info.kind}
                  </span>
                  <button
                    type="button"
                    className="slot-panel-detail-close"
                    onClick={() => setSelectedSlot(null)}
                    aria-label="Close slot details"
                  >
                    &times;
                  </button>
                </div>
                <h2 className="slot-panel-detail-title">
                  {selectedSlot.info.title}
                </h2>
                <p className="slot-panel-detail-when">
                  {instructorsById.get(selectedSlot.instrId)?.name ??
                    selectedSlot.instrId}{" "}
                  &middot; {selectedSlot.date} &middot;{" "}
                  {minutesToTime(selectedSlot.minute)}&ndash;
                  {minutesToTime(selectedSlot.minute + 60)}
                </p>
                {selectedSlot.info.card ? (
                  <>
                    <dl className="slot-panel-detail-list">
                      {selectedSlot.info.card.map((row, i) => (
                        <div className="slot-panel-detail-row" key={i}>
                          <dt>{row.label}</dt>
                          <dd>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {(selectedSlot.info.panelDetail?.length ?? 0) > 0 && (
                      <dl className="slot-panel-detail-list slot-panel-detail-extra">
                        {selectedSlot.info.panelDetail!.map((line, i) => (
                          <div className="slot-panel-detail-row" key={i}>
                            <dd>{line}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </>
                ) : (
                  selectedSlot.info.detail.length > 0 && (
                    <dl className="slot-panel-detail-list">
                      {selectedSlot.info.detail.map((line, i) => (
                        <div className="slot-panel-detail-row" key={i}>
                          <dd>{line}</dd>
                        </div>
                      ))}
                    </dl>
                  )
                )}
                {(selectedSlot.info.editAction ||
                  selectedSlot.info.deleteAction) && (
                  <div className="slot-panel-detail-actions">
                    {selectedSlot.info.editAction && (
                      <button
                        type="button"
                        className="slot-pop-edit-btn"
                        onClick={() =>
                          handleEditBooking(selectedSlot.info.editAction!)
                        }
                      >
                        Edit Booking
                      </button>
                    )}
                    {selectedSlot.info.deleteAction && (
                      <button
                        type="button"
                        className="slot-pop-delete-btn"
                        onClick={() =>
                          handleDeleteTentative(selectedSlot.info.deleteAction!)
                        }
                      >
                        Delete Slot
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="slot-panel-empty">
                <div className="slot-panel-empty-icon" aria-hidden="true">
                  &#128197;
                </div>
                <p className="slot-panel-empty-title">
                  Select a slot to view schedules
                </p>
                <p className="slot-panel-empty-hint">
                  {addingSlotMode
                    ? `Click a green (free) cell on ${lockedInstructorName}'s schedule to pick ${
                        replacingSlotIndex !== null
                          ? "a replacement slot"
                          : "the next class"
                      }.`
                    : "Click any slot on the calendar. A free one opens the booking form here; a booked or paused one shows its details."}
                </p>
              </div>
            )}
          </aside>
          <div className="shell-main">
            <Suspense fallback={null}>
              <LocationSearch
                zones={dbZones}
                zonesError={zoneError}
                status={locStatus}
                resultLabel={locSearch?.label ?? null}
                point={
                  locSearch ? { lat: locSearch.lat, lng: locSearch.lng } : null
                }
                matchedNames={locResult?.zones ?? []}
                via={locResult?.via ?? "none"}
                zoneInfo={locResult?.zoneInfo ?? {}}
                onLocate={handleLocation}
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
                        <strong>{locResult?.instrs.length ?? 0}</strong>{" "}
                        instructor
                        {(locResult?.instrs.length ?? 0) === 1 ? "" : "s"} near
                        “{locSearch.label}”
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
                    onClick={() => {
                      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
                      trackEvent("date_changed", {
                        slotDate: d,
                        success: true,
                        details: { free_slots: dateTotals.get(d) ?? 0 },
                      });
                      setDateIndex(i);
                      setSortAnchorDate(d);
                    }}
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
                // main row and MiniTimeRow) validates against this prop, so it
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
                dates={visibleDates}
                selectedDate={selectedDate}
                weekDates={weekDates}
                panelRangeLabel={panelRangeLabel}
                canPanelPrev={canPanelPrev}
                canPanelNext={canPanelNext}
                gridMinutes={config.gridMinutes}
                slotStart={config.slotStart}
                slotEnd={config.slotEnd}
                expanded={expandedForRender}
                pendingExpandId={pendingExpandRowId}
                selectedRows={selectedRows}
                rowColors={rowColors}
                loadingRows={loadingRows}
                errorRows={errorRows}
                onRetryLoad={retryLoadInstructor}
                onToggleExpand={toggleExpand}
                onPanelPrevWeek={panelPrevWeek}
                onPanelNextWeek={panelNextWeek}
                onPanelPrevDay={panelPrevDay}
                onPanelNextDay={panelNextDay}
                onPanelToday={panelToday}
                onToggleSelectRow={toggleSelectRow}
                onRemove={
                  inSelectionMode ? removeFromCompare : removeRosterInstructor
                }
                onSelect={handleSlotSelect}
                onDeleteTentative={handleDeleteTentative}
                onEditBooking={handleEditBooking}
                resolveInfo={resolveInfo}
              />
              {gridRows.length === 0 &&
                loadingRows.length === 0 &&
                errorRows.length === 0 &&
                lockedInstructorId && (
                  <p className="empty">
                    {lockedInstructorName} is no longer on the grid. Cancel or
                    complete the booking, then search for the instructor again.
                  </p>
                )}
              {gridRows.length === 0 &&
                loadingRows.length === 0 &&
                errorRows.length === 0 &&
                !lockedInstructorId &&
                !locSearch && (
                  <p className="empty">
                    No instructors loaded yet. Search by name above or use
                    Search by location.
                  </p>
                )}
              {gridRows.length === 0 &&
                loadingRows.length === 0 &&
                errorRows.length === 0 &&
                !lockedInstructorId &&
                locSearch && (
                  <p className="empty">
                    No instructors match this location. Try another area.
                  </p>
                )}
            </div>

            <footer className="legend">
              <span>
                <i className="swatch free" /> Free slot (no class, not on
                unavailability, outside the {config.instructor_gap_minutes}
                -minute travel gap)
              </span>
              <span>
                <i className="swatch tentative" /> 🟡 Tentative (unpaid slots
                can be edited by anyone)
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
              <div
                className="modal-backdrop"
                onClick={() => setHelpOpen(false)}
              >
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
                      <li>
                        The arrows stop at the start and end of the window.
                      </li>
                    </ul>
                  </div>

                  <div className="help-section">
                    <h3>Pick a date</h3>
                    <ul>
                      <li>
                        Each tab is one date: weekday, day number, and total
                        free slots for that day.
                      </li>
                      <li>
                        Click a tab to view that date. The active day shows a
                        blue circle.
                      </li>
                    </ul>
                  </div>

                  <div className="help-section">
                    <h3>Filter the instructor list</h3>
                    <ul>
                      <li>
                        The Filter select reorders instructors using the
                        selected date.
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
                        Type a name to search; results drop down below the
                        field.
                      </li>
                      <li>
                        Click + Compare (or press Enter for the top result) to
                        pin an instructor.
                      </li>
                      <li>
                        While comparing, the grid shows only the pinned
                        instructors.
                      </li>
                      <li>
                        Remove one with the small ×, or reset with Clear
                        selection.
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
                        Picking a suggestion applies it immediately. Search
                        remains available for typed addresses.
                      </li>
                      <li>
                        The grid narrows to instructors who work in that
                        location. Click a name chip to pin instructor(s) for
                        comparison.
                      </li>
                      <li>
                        Clear location or ↺ Reset to go back to the full roster.
                      </li>
                    </ul>
                  </div>

                  <div className="help-section">
                    <h3>Read the grid</h3>
                    <ul>
                      <li>
                        Columns are 30-minute slots; rows are instructors.
                      </li>
                      <li>
                        <strong>🟢 Green</strong> = free: no class, no time off,
                        enough travel time.
                      </li>
                      <li>
                        <strong>🟡 Yellow</strong> = tentative (created from
                        this dashboard) — unpaid, half paid, or full paid.
                      </li>
                      <li>
                        <strong>🟣 Purple</strong> = booked, completed, or a
                        real learner booking mid-payment — a confirmed class,
                        never editable from here.
                      </li>
                      <li>
                        Plain/unshaded = paused, unavailable, or a travel-gap
                        buffer around another slot.
                      </li>
                      <li>
                        <strong>Hover</strong> any slot for full details:
                        status, time, instructor, and — for a booked class —
                        learner, area, and course when known.
                      </li>
                      <li>
                        A {config.instructor_gap_minutes}-minute travel gap
                        around classes is applied, so green slots are safe to
                        assign.
                      </li>
                    </ul>
                  </div>

                  <div className="help-section">
                    <h3>Create a tentative booking</h3>
                    <ul>
                      <li>
                        <strong>Click</strong> any green (free) slot to open the
                        booking form for that 1-hour block.
                      </li>
                      <li>
                        Fill in the customer&apos;s name, phone, sales agent,
                        payment status, address, and course, then submit.
                      </li>
                      <li>
                        This always creates a <strong>tentative</strong> hold
                        (shown yellow) — it is never a confirmed/booked class.
                        Operations verifies the customer and converts valid
                        tentative slots to confirmed bookings separately.
                      </li>
                    </ul>
                  </div>

                  <div className="help-section">
                    <h3>Book multiple classes in one go</h3>
                    <ul>
                      <li>
                        While the booking form is open, click{" "}
                        <strong>+ Add another class</strong> instead of
                        submitting — useful for a customer buying a course of
                        several classes at once.
                      </li>
                      <li>
                        The form hides and the grid gets a pulsing yellow
                        border: <strong>click the next free slot</strong> (any
                        date/instructor) to add it. The form reopens with that
                        class added — your name/phone/agent/course entries are
                        kept, nothing is lost.
                      </li>
                      <li>
                        Every class you&apos;ve already picked shows{" "}
                        <strong>🔵 blue</strong> on the grid while you&apos;re
                        picking the next one, so it&apos;s always clear what
                        you&apos;ve selected so far.
                      </li>
                      <li>
                        Any free slot that would <strong>overlap</strong> a
                        class already in this booking is greyed out and
                        can&apos;t be selected — e.g. picking 7:00–8:00 disables
                        7:30–8:30 for that same instructor.
                      </li>
                      <li>
                        Repeat for as many classes as needed. Each one appears
                        in a &quot;Selected Slots&quot; list with a × to remove
                        it (the last remaining slot can&apos;t be removed — use
                        Cancel instead).
                      </li>
                      <li>
                        Submitting creates all selected classes together as
                        tentative holds. If any one of them is no longer
                        available by the time you submit, the form tells you
                        exactly which class and creates none of them — so you
                        never end up with a half-created batch.
                      </li>
                    </ul>
                  </div>

                  <div className="help-section">
                    <h3>Edit a tentative booking</h3>
                    <ul>
                      <li>
                        Click a <strong>yellow</strong> slot and choose{" "}
                        <strong>Edit Booking</strong> to change the customer
                        details, payment status or the classes in that booking.
                      </li>
                      <li>
                        The agent who created a tentative slot can edit it at
                        any payment status.
                      </li>
                      <li>
                        <strong>Anyone</strong> can edit an{" "}
                        <strong>unpaid</strong> tentative slot — for example to
                        hand it to a learner who is now paying. The original
                        creator stays on record, and only they can delete it.
                      </li>
                      <li>
                        Paid slots created by someone else are protected:
                        they can&apos;t be edited from here.
                      </li>
                    </ul>
                  </div>

                  <div className="help-section">
                    <h3>View an instructor&apos;s schedule</h3>
                    <ul>
                      <li>
                        Click an instructor&apos;s name or the Schedule button
                        to open their day-by-day timetable for the selected
                        month.
                      </li>
                      <li>
                        Each day shows its free-slot count; the highlighted row
                        is the currently selected date.
                      </li>
                      <li>
                        Use the month arrows in the expanded timetable to view
                        the previous or next loaded month.
                      </li>
                      <li>
                        Click the name or Hide schedule to collapse the
                        timetable.
                      </li>
                    </ul>
                  </div>

                  <div className="help-section">
                    <h3>Refresh and legend</h3>
                    <ul>
                      <li>Bottom-right Refresh fetches the latest data.</li>
                      <li>
                        The legend explains the slot colors used in the grid.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* In-app confirm dialog for deleting a tentative slot — replaces
          window.confirm() so it matches the rest of the dashboard and can
          be dismissed by clicking outside, not just OK/Cancel. */}
      {pendingDelete && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- standard click-outside-to-dismiss backdrop; the modal itself has role="alertdialog" and a visible close button
        <div className="modal-backdrop" onClick={() => setPendingDelete(null)}>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions -- stops the backdrop's dismiss click from bubbling; the modal itself has role="alertdialog" and a visible close button */}
          <div
            className="modal modal-sm"
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete tentative slot"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Delete tentative slot?</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setPendingDelete(null)}
                aria-label="Cancel"
              >
                ×
              </button>
            </div>
            <p className="confirm-message">
              Delete the tentative slot for{" "}
              <strong>{pendingDelete.customerName}</strong>? This can&apos;t be
              undone.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="expand"
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="reset-dash"
                onClick={confirmDeleteTentative}
              >
                Delete Slot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent banner while picking an additional class for an
          in-progress multi-class booking (Task 19) — the modal is
          hidden (not closed: pendingSlots/customerFormData are untouched)
          until a new slot is clicked or this is cancelled. */}
      {addingSlotMode && (
        <div className="slot-toast slot-toast-info" role="status">
          <span className="slot-toast-icon" aria-hidden="true">
            ➕
          </span>
          <span className="slot-toast-msg">
            {replacingSlotIndex !== null ? (
              <>
                <strong>
                  👉 Pick a new slot for Class {replacingSlotIndex + 1} now:
                </strong>{" "}
                click any green (free) cell on {lockedInstructorName}
                &apos;s schedule below to replace the conflicting class. The
                form isn&apos;t closed — it will reopen with your new slot in
                place of Class {replacingSlotIndex + 1}.
              </>
            ) : (
              <>
                <strong>
                  👉 Pick {lockedInstructorName}&apos;s next class now:
                </strong>{" "}
                click any green (free) cell on {lockedInstructorName}
                &apos;s schedule to add it to this booking. Other instructors
                are hidden — this booking must stay with the same instructor.
                Your form stays open here and updates as you pick.
              </>
            )}
          </span>
          <button
            type="button"
            className="slot-toast-close"
            aria-label={
              replacingSlotIndex !== null
                ? "Cancel changing slot"
                : "Cancel adding another class"
            }
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
