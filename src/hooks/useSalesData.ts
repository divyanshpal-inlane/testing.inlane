import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildDisplayFreeGrid,
  buildInstructorFreeGrid,
  candidateStartMinutes,
  type InstructorLike,
  type ScheduleBlock,
} from "@/lib/sales-dashboard/availability";
import {
  isCompanyInstructor,
  isCompanyInstructorId,
} from "@/lib/sales-dashboard/company-instructors";
import {
  type BookingFlowConfig,
  readBookingFlowConfig,
} from "@/lib/sales-dashboard/config";
import {
  addDaysISO,
  istTodayISO,
  loadErrorToMessage,
  timeToMinutes,
} from "@/lib/sales-dashboard/validation";
import { fetchCompanyInstructorIds } from "@/lib/sales-dashboard/zones-db";
import { supabase } from "@/lib/supabaseClient";

// database.types.ts is stale for several of the columns this dashboard reads
// (Instructor.gender/unavailability/status/enabled, Schedule.pause_notes,
// app_settings.value) — same `as any` escape hatch used elsewhere in the
// codebase (see queries/controlTower.ts, queries/dlTestSlots.ts, etc.) for
// tables/columns the generated types haven't caught up with.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const PAGE_SIZE = 1000;
const IN_CHUNK = 60;

// How long the realtime handler collects Schedule-change events before
// refreshing the affected instructors once. Long enough to swallow a bulk-add
// burst, short enough that the grid still feels live after a booking.
const REALTIME_DEBOUNCE_MS = 400;

// Client-side deadline for a roster/schedule/config fetch. Supabase/PostgREST
// requests have no timeout of their own, so a stalled connection left a row on
// "Loading schedule…" (or the whole page on "Loading availability…") forever,
// with `s.loading` never cleared because `doLoad` never settled. On expiry the
// fetch is aborted, the row leaves the loading set and a retryable error is
// shown instead of a permanent skeleton.
const LOAD_TIMEOUT_MS = 20_000;
const LOAD_TIMEOUT_MESSAGE =
  "Loading timed out. Check your connection and try again.";

export interface InstructorRow {
  id: string;
  name: string;
  areas: string[];
  gender: string | null;
  status: string | null;
  enabled: boolean | null;
  unavailability: unknown[] | null;
  /**
   * Ops-assigned backup instructor. Never auto-matched to a learner — the
   * availability engine short-circuits on this before consulting `areas` or
   * any polygon. Resolved from `Instructor.is_company_instructor` plus the
   * name-list fallback; see parseInstructors().
   */
  isCompany: boolean;
}

export interface LightInstructor {
  id: string;
  name: string;
  status: string | null;
  enabled: boolean | null;
}

export interface ScheduleRow {
  id: number;
  instructor_id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  learner_id: string | null;
  course_id: string | null;
  leadName: string | null;
  isTentative: boolean | null;
  tentative_details: Record<string, unknown> | null;
  pause_reason: string | null;
  pause_notes: string | null;
  started_at: string | null;
  ended_at: string | null;
  lesson: { number: number | null } | null;
}

export interface BlockDetail {
  id: number;
  instructorId: string;
  date: string;
  startMinute: number;
  endMinute: number;
  status: string;
  isTentative: boolean;
  // Only meaningful when isTentative is true — the sales-side hold's
  // payment_status ("unpaid" | "half_paid" | "full_paid"), read straight
  // from tentative_details so the UI can gate the override action without
  // a second round trip.
  paymentStatus: string | null;
  // Full raw tentative_details JSON, kept as-is (not just the extracted
  // learnerName/area/courseName below) so the slot-override flow can
  // carry the customer's name/phone/sales_agent/address/course forward to
  // the replacement tentative block without a second fetch.
  rawTentativeDetails: Record<string, unknown> | null;
  learnerName: string;
  area: string;
  courseName: string;
  notes: string;
  pauseReason: string;
  lessonNumber: number | null;
  startedAt: string | null;
  endedAt: string | null;
  // Learner's phone, shown in the side panel's Instructor-Management-style
  // card (tentative holds keep it in tentative_details.phone instead).
  learnerPhone: string;
}

export interface SalesData {
  config: BookingFlowConfig;
  // Main roster grid window: forward-only (starts tomorrow), unchanged.
  dates: string[];
  // Full past+future window the expanded Schedule timetable pages over.
  windowDates: string[];
  timeStarts: number[];
  allInstructors: LightInstructor[];
  instructors: InstructorRow[];
  loading: LightInstructor[];
  // Display names for ids in `loading`/`errors`, cached so those rows render
  // even before the light index (allInstructors) has loaded.
  names: Map<string, string>;
  errors: Record<string, string>;
  freeGrid: Map<string, Map<string, number[]>>;
  displayGrid: Map<string, Map<string, number[]>>;
  blocks: BlockDetail[];
}

const DEFAULT_VIEW_DAYS_AHEAD = 400;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchScheduleWindow(
  instructorIds: string[] | null,
  dateFrom: string,
  dateTo: string,
  excludedStatuses: string[],
  signal?: AbortSignal,
): Promise<ScheduleRow[]> {
  const excludeFilter =
    excludedStatuses.length > 0 ? `(${excludedStatuses.join(",")})` : null;
  const rows: ScheduleRow[] = [];
  const groups: (string[] | null)[] = instructorIds
    ? chunk(instructorIds, IN_CHUNK)
    : [null];
  for (const group of groups) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = sb
        .from("Schedule")
        .select(
          "id, instructor_id, date, start_time, end_time, status, learner_id, course_id, leadName, isTentative, tentative_details, pause_reason, pause_notes, started_at, ended_at, lesson:lesson_id(number)",
        )
        .gte("date", dateFrom)
        .lte("date", dateTo);
      if (excludeFilter) query = query.not("status", "in", excludeFilter);
      if (group) query = query.in("instructor_id", group);
      const { data, error } = await query
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
        .abortSignal(signal);
      if (error) throw error;
      rows.push(...((data ?? []) as ScheduleRow[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

function parseInstructors(
  rows: Record<string, unknown>[],
  companyIds?: ReadonlySet<string>,
): InstructorRow[] {
  return rows.map((r) => {
    const id = String(r.id_instructor);
    const name = String(r.name ?? "");
    return {
      id,
      name,
      areas: Array.isArray(r.areas)
        ? (r.areas as string[]).map((a) => String(a))
        : [],
      gender: r.gender == null ? null : String(r.gender),
      status: r.status == null ? null : String(r.status),
      enabled: r.enabled == null ? null : Boolean(r.enabled),
      unavailability:
        r.unavailability == null ? null : (r.unavailability as unknown[]),
      // Mirrors zones-db's tolerant rule: the flagged id is authoritative
      // (survives a rename), the name list covers pre-migration rows, and a
      // flagged id whose name differs still wins.
      isCompany:
        isCompanyInstructorId(id, companyIds ?? null) ||
        isCompanyInstructor(name),
    };
  });
}

function parseLight(rows: Record<string, unknown>[]): LightInstructor[] {
  return rows.map((r) => ({
    id: String(r.id_instructor),
    name: String(r.name ?? ""),
    status: r.status == null ? null : String(r.status),
    enabled: r.enabled == null ? null : Boolean(r.enabled),
  }));
}

function toInstructorLike(i: InstructorRow): InstructorLike {
  return {
    id: i.id,
    areas: i.areas,
    radiusKm: null,
    lat: null,
    lng: null,
    gender: i.gender,
    name: i.name,
    status: i.status,
    enabled: i.enabled,
    unavailability: i.unavailability,
    // Reaches availability.ts:instructorServesArea(), which returns false for
    // a company instructor before it looks at areas/radius/polygon.
    isCompany: i.isCompany,
  };
}

interface Store {
  instructors: Map<string, InstructorRow>;
  grid: Map<string, Map<string, number[]>>;
  displayGrid: Map<string, Map<string, number[]>>;
  blocks: BlockDetail[];
  loading: Set<string>;
  // Display name per loading/errored instructor id. The roster grid renders
  // loading/error rows from `loading`/`errors`, whose names used to be resolved
  // through the light instructor index (allRef). On a cold load that index can
  // still be empty while a fetch is in flight, so the row was dropped entirely
  // -- which produced the bogus "No instructors loaded yet" empty state while
  // the same fetch was genuinely running. Caching the name here makes the row
  // renderable regardless of index timing.
  names: Map<string, string>;
  errors: Record<string, string>;
}

export function useSalesData() {
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [data, setData] = useState<SalesData | null>(null);

  const configRef = useRef<BookingFlowConfig | null>(null);
  const datesRef = useRef<string[]>([]);
  // The forward slice of datesRef the main roster grid uses (tomorrow onward).
  // `datesRef` itself now carries the expanded timetable's full past+future
  // window, but every main-grid consumer (month nav, day strip, "X free"
  // totals) must keep seeing the original forward-only list.
  const forwardDatesRef = useRef<string[]>([]);
  const timeStartsRef = useRef<number[]>([]);
  const allRef = useRef<LightInstructor[]>([]);
  const storeRef = useRef<Store>({
    instructors: new Map(),
    grid: new Map(),
    displayGrid: new Map(),
    blocks: [],
    loading: new Set(),
    names: new Map(),
    errors: {},
  });

  const commit = useCallback(() => {
    const cfg = configRef.current;
    if (!cfg) return;
    const s = storeRef.current;
    const loadingIds = [...s.loading];
    const byId = new Map(allRef.current.map((a) => [a.id, a]));
    setData({
      config: cfg,
      dates: forwardDatesRef.current,
      windowDates: datesRef.current,
      timeStarts: timeStartsRef.current,
      allInstructors: allRef.current,
      instructors: [...s.instructors.values()],
      // Never drop a loading id just because the index hasn't loaded its name
      // yet -- fall back to the cached name (possibly "") so the grid, the
      // empty-state gate and the error gate all agree that a fetch is running.
      loading: loadingIds.map(
        (id): LightInstructor =>
          byId.get(id) ?? {
            id,
            name: s.names.get(id) ?? "",
            status: null,
            enabled: null,
          },
      ),
      names: s.names,
      errors: { ...s.errors },
      freeGrid: s.grid,
      displayGrid: s.displayGrid,
      blocks: s.blocks,
    });
  }, []);

  const doLoad = useCallback(
    // `silent` re-fetches instructors that are ALREADY on the grid without
    // blanking them to the "Loading schedule…" skeleton first (used by the
    // realtime refresh and post-booking refresh). `force` is what lets a silent
    // refresh target an instructor that is still present -- otherwise the
    // `!s.instructors.has(id)` filter would skip every one of them.
    async (ids: string[], opts: { silent?: boolean; force?: boolean } = {}) => {
      if (ids.length === 0) return;
      const { silent = false, force = false } = opts;
      const s = storeRef.current;
      const wanted = [...new Set(ids)].filter(
        (id) => !s.loading.has(id) && (force || !s.instructors.has(id)),
      );
      if (wanted.length === 0) return;
      const nameById = new Map(allRef.current.map((a) => [a.id, a.name]));
      for (const id of wanted) {
        // A retry must clear the previous error or the row would show both the
        // error and the skeleton at once.
        delete s.errors[id];
        if (!silent) {
          s.loading.add(id);
          if (!s.names.has(id)) s.names.set(id, nameById.get(id) ?? "");
        }
      }
      if (!silent) commit();
      const cfg = configRef.current;
      if (!cfg) {
        for (const id of wanted) s.loading.delete(id);
        commit();
        return;
      }
      const from = datesRef.current[0];
      const to = datesRef.current[datesRef.current.length - 1];
      const excluded = cfg.excluded_schedule_statuses ?? [
        "cancelled",
        "rejected",
      ];

      // Aborts the in-flight queries when the deadline below fires. Without
      // this the request (and the resulting stuck skeleton) could outlive the
      // race and mutate the store after we've already shown a timeout error.
      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      try {
        // Instructor detail rows and the Schedule window are independent
        // queries (Schedule doesn't need the Instructor rows at all) — fetch
        // both concurrently instead of awaiting one after the other. Each
        // chunk of instructor IDs is also fetched concurrently rather than
        // in a serial loop (only matters once more than IN_CHUNK ids are
        // requested at once, e.g. a location-search match).
        //
        // fetchCompanyInstructorIds() joins the same batch: one small indexed
        // query, already module-cached, resolving to an empty set (never a
        // throw) when migration 20260929_100000 is not applied yet. The batch
        // deliberately returns raw rows rather than parsed ones — calling
        // parseInstructors() inside it would close over `companyIds`, the very
        // variable this destructuring declares, and TypeScript rejects that as
        // a self-referential initializer. Parsing happens just below instead.
        const fetchAll = Promise.all([
          Promise.all(
            chunk(wanted, IN_CHUNK).map(async (part) => {
              const { data: rows, error } = await sb
                .from("Instructor")
                .select(
                  // No "gender" column here — the female-instructor-preference
                  // matching in the ported availability engine expects
                  // Instructor.gender, but this table doesn't have it. Selecting
                  // it makes PostgREST reject the whole query (400), which was
                  // silently breaking every instructor add. This dashboard never
                  // exposes a female-preference control, so parseInstructors()
                  // just falls back to gender: null (isFemale() -> false), which
                  // matches this dashboard's actual behavior either way.
                  //
                  // "is_company_instructor" is likewise NOT selected here, for
                  // the same reason: migration 20260929_100000 is manual-apply
                  // only, so the column may not exist yet and adding it here
                  // would 400 every instructor load. It arrives instead via
                  // fetchCompanyInstructorIds(), which degrades to an empty set.
                  "id_instructor, name, areas, unavailability, status, enabled",
                )
                .in("id_instructor", part)
                .abortSignal(controller.signal);
              if (error) throw error;
              return (rows ?? []) as Record<string, unknown>[];
            }),
          ),
          fetchScheduleWindow(wanted, from, to, excluded, controller.signal),
          fetchCompanyInstructorIds(),
        ]);
        // If the deadline wins the race below, `fetchAll` rejects later when
        // the abort lands; without this handler that becomes an unhandled
        // promise rejection even though we already surfaced the timeout.
        fetchAll.catch(() => {});
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error(LOAD_TIMEOUT_MESSAGE));
          }, LOAD_TIMEOUT_MS);
        });
        const [rawChunks, scheduleRows, companyIds] = await Promise.race([
          fetchAll,
          timeout,
        ]);

        const infos = new Map<string, InstructorRow>();
        for (const part of rawChunks) {
          for (const r of parseInstructors(part, companyIds))
            infos.set(r.id, r);
        }

        const learnerIds = [
          ...new Set(
            scheduleRows
              .map((r) => r.learner_id)
              .filter((x): x is string => Boolean(x)),
          ),
        ];
        const courseIds = [
          ...new Set(
            scheduleRows
              .map((r) => r.course_id)
              .filter((x): x is string => Boolean(x)),
          ),
        ];

        // Learner and Course lookups are independent of each other too.
        const [learnerChunks, courseChunks] = await Promise.all([
          Promise.all(
            chunk(learnerIds, IN_CHUNK).map(async (part) => {
              const { data: learners, error: learnerErr } = await sb
                .from("Learner")
                .select("id, name, area, phone, pick_up_location")
                .in("id", part);
              if (learnerErr) throw learnerErr;
              return (learners ?? []) as Record<string, unknown>[];
            }),
          ),
          Promise.all(
            chunk(courseIds, IN_CHUNK).map(async (part) => {
              const { data: courses, error: courseErr } = await sb
                .from("Courses")
                .select("id, name")
                .in("id", part);
              if (courseErr) throw courseErr;
              return (courses ?? []) as Record<string, unknown>[];
            }),
          ),
        ]);

        const learnerNames = new Map<string, string>();
        const learnerAreas = new Map<string, string>();
        const learnerPhones = new Map<string, string>();
        for (const part of learnerChunks) {
          for (const l of part) {
            learnerNames.set(
              String(l.id),
              l.name == null ? "" : String(l.name),
            );
            // Prefer the full pick-up address over the short `area` — that is
            // the field Instructor Management's timetable card shows.
            learnerAreas.set(
              String(l.id),
              l.pick_up_location == null ||
                String(l.pick_up_location).trim() === ""
                ? l.area == null
                  ? ""
                  : String(l.area)
                : String(l.pick_up_location),
            );
            learnerPhones.set(
              String(l.id),
              l.phone == null ? "" : String(l.phone),
            );
          }
        }

        const courseNames = new Map<string, string>();
        for (const part of courseChunks) {
          for (const c of part) {
            courseNames.set(String(c.id), c.name == null ? "" : String(c.name));
          }
        }

        const str = (v: unknown): string =>
          typeof v === "string" && v.trim().length > 0 ? v : "";

        // Two different flows write tentative_details with two different
        // payment-status shapes: the Sales Dashboard itself writes
        // payment_status ("unpaid"/"half_paid"/"full_paid", see
        // TentativeBookingModal.tsx), while Instructor Management's own
        // tentative-booking feature writes paid_info ("Unpaid"/"Half
        // paid"/"Full paid", see instructors.tsx). Both land in the same
        // Schedule.tentative_details column, so a slot created by the
        // other flow needs its paid_info normalized to the same
        // unpaid/half_paid/full_paid vocabulary the override/unpaid-badge
        // logic below reads -- otherwise it silently defaults to "unpaid"
        // (paymentStatus: null), which incorrectly offers Override on an
        // already-paid slot.
        const normalizePaymentStatus = (
          td: Record<string, unknown>,
        ): string | null => {
          if (typeof td.payment_status === "string") return td.payment_status;
          if (typeof td.paid_info === "string") {
            const p = td.paid_info.trim().toLowerCase();
            if (p === "unpaid") return "unpaid";
            if (p === "half paid") return "half_paid";
            if (p === "full paid") return "full_paid";
          }
          return null;
        };

        const blockDetails: BlockDetail[] = scheduleRows.map((r) => {
          const td = (r.tentative_details ?? {}) as Record<string, unknown>;
          const learnerName =
            str(td.name) ||
            str(td.leadName) ||
            str(r.leadName) ||
            (r.learner_id ? (learnerNames.get(r.learner_id) ?? "") : "");
          const area =
            str(td.pickup_location) ||
            str(td.address) ||
            (r.learner_id ? (learnerAreas.get(r.learner_id) ?? "") : "");
          const courseName =
            str(td.description) ||
            (r.course_id ? (courseNames.get(r.course_id) ?? "") : "");
          const notes =
            r.status === "paused"
              ? str(r.pause_reason) || str(r.pause_notes)
              : "";
          return {
            id: r.id,
            instructorId: r.instructor_id,
            date: r.date,
            startMinute: timeToMinutes(r.start_time),
            endMinute: timeToMinutes(r.end_time),
            status: r.status,
            isTentative: r.isTentative === true,
            paymentStatus: normalizePaymentStatus(td),
            rawTentativeDetails: r.tentative_details ?? null,
            learnerName,
            area,
            courseName,
            notes,
            pauseReason: str(r.pause_reason),
            lessonNumber:
              !r.isTentative &&
              r.learner_id != null &&
              typeof r.lesson?.number === "number" &&
              r.lesson.number > 0
                ? r.lesson.number
                : null,
            startedAt: r.started_at,
            endedAt: r.ended_at,
            learnerPhone:
              str(td.phone) ||
              (r.learner_id ? (learnerPhones.get(r.learner_id) ?? "") : ""),
          };
        });

        const blocks: ScheduleBlock[] = scheduleRows.map((r) => ({
          instructorId: r.instructor_id,
          date: r.date,
          startMinute: timeToMinutes(r.start_time),
          endMinute: timeToMinutes(r.end_time),
          status: r.status,
          // `booking` is RLS-protected (service-role only), so hold creation time
          // can't be read from the browser; pending_payment holds are therefore
          // treated as occupying until the hold-expiry job clears them.
          bookingCreatedAt: null,
          ownerBookingId: null,
        }));

        const engineInstructors: InstructorLike[] = [...infos.values()].map(
          toInstructorLike,
        );

        const slotConfig = {
          slotStart: cfg.slotStart,
          slotEnd: cfg.slotEnd,
          gridMinutes: cfg.gridMinutes,
          slotDurationMinutes: cfg.slotDurationMinutes,
        };
        const baseInput = {
          instructors: engineInstructors,
          learnerArea: "",
          blocks,
          dates: datesRef.current,
          slotConfig,
          holdMinutes: cfg.hold_minutes,
          gapMinutes: cfg.instructor_gap_minutes,
        };

        const grid =
          engineInstructors.length > 0 && datesRef.current.length > 0
            ? buildInstructorFreeGrid(baseInput, engineInstructors)
            : new Map<string, Map<string, number[]>>();

        const displayGrid =
          engineInstructors.length > 0 && datesRef.current.length > 0
            ? buildDisplayFreeGrid(baseInput, engineInstructors)
            : new Map<string, Map<string, number[]>>();

        for (const info of infos.values()) s.instructors.set(info.id, info);
        for (const [id, perDate] of grid) s.grid.set(id, perDate);
        for (const [id, perDate] of displayGrid) s.displayGrid.set(id, perDate);
        // Replace, don't append: a silent refresh (or removing then re-adding
        // an instructor) re-fetches the same window, and blind push would leave
        // duplicate BlockDetail rows for every refreshed instructor.
        const wantedSet = new Set(wanted);
        s.blocks = s.blocks.filter((b) => !wantedSet.has(b.instructorId));
        s.blocks.push(...blockDetails);
        for (const id of wanted) {
          s.loading.delete(id);
          s.names.delete(id);
          delete s.errors[id];
        }
      } catch (err) {
        const message = loadErrorToMessage(err);
        for (const id of wanted) {
          s.loading.delete(id);
          // A silent refresh keeps the already-rendered grid on screen rather
          // than replacing it with an error banner: the data shown is merely
          // stale, not gone, and the realtime stream will retry on the next
          // change. Only a foreground load reports the failure.
          if (!silent) s.errors[id] = message;
        }
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
      }
      commit();
    },
    [commit],
  );

  const loadInstructors = useCallback(
    (ids: string[]) => {
      void doLoad(ids);
    },
    [doLoad],
  );

  const removeInstructor = useCallback(
    (id: string) => {
      const s = storeRef.current;
      s.instructors.delete(id);
      s.grid.delete(id);
      s.displayGrid.delete(id);
      s.blocks = s.blocks.filter((b) => b.instructorId !== id);
      s.loading.delete(id);
      s.names.delete(id);
      delete s.errors[id];
      commit();
    },
    [commit],
  );

  const loadInstructorIndex = useCallback(async () => {
    // Lazy-load instructor index only when needed (for search suggestions)
    if (allRef.current.length > 0) return;
    const { data: listRes, error: listErr } = await sb
      .from("Instructor")
      .select("id_instructor, name, status, enabled")
      .abortSignal(AbortSignal.timeout(LOAD_TIMEOUT_MS));
    if (listErr) throw listErr;
    allRef.current = parseLight((listRes ?? []) as Record<string, unknown>[]);
    // This runs in parallel with loadSession() on mount (Promise.all in
    // SalesDashboard). Without this commit, the index only reaches the UI if
    // some unrelated action happens to call commit() afterward — a race that
    // made the search box intermittently show zero suggestions depending on
    // which fetch won. commit() itself no-ops until configRef is set, so this
    // is a safe no-op when loadSession() hasn't resolved yet; loadSession()'s
    // own commit() picks up the already-populated allRef in that case.
    commit();
  }, [commit]);

  const loadSession = useCallback(async () => {
    // Fast startup: only load config, not all instructors
    const { data: settingRow, error: cfgErr } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "booking_flow")
      .maybeSingle()
      .abortSignal(AbortSignal.timeout(LOAD_TIMEOUT_MS));
    if (cfgErr) throw cfgErr;
    const config = readBookingFlowConfig(settingRow?.value);
    if (!config.enabled) {
      throw new Error(
        "booking_flow configuration is missing or incomplete in app_settings (enabled:false).",
      );
    }
    configRef.current = config;

    const today = istTodayISO();
    const viewDays = config.view_days_ahead ?? DEFAULT_VIEW_DAYS_AHEAD;
    const from = addDaysISO(today, 1);
    const to = addDaysISO(from, viewDays - 1);
    // The expanded Schedule timetable (a rolling 7-day window like Instructor
    // Management's "View Schedule") can page backwards through the current
    // month, so the schedule window starts at the 1st of the current month
    // rather than tomorrow. `forwardDatesRef` keeps the main roster grid on
    // its original forward-only window (tomorrow onward); `datesRef` is the
    // full past+future window the expanded panel reads and the engine builds
    // free grids over.
    datesRef.current = [];
    const windowFrom = `${today.slice(0, 7)}-01`;
    for (let d = windowFrom; d <= to; d = addDaysISO(d, 1))
      datesRef.current.push(d);
    forwardDatesRef.current = datesRef.current.filter((d) => d >= from);
    // The grid's visible time columns are bounded by the shared
    // booking_flow config's slotStart/slotEnd/slotDurationMinutes -- the
    // same window a new tentative booking can actually be created in, so
    // there's no dead zone where a cell is shown but can never be
    // free/bookable. Whether a given cell is actually free within this
    // window is decided purely by the instructor's own
    // Instructor.unavailability data plus real Schedule rows via
    // buildFreeGrid, not a separate business-hours boundary.
    timeStartsRef.current = candidateStartMinutes({
      slotStart: config.slotStart,
      slotEnd: config.slotEnd,
      gridMinutes: config.gridMinutes,
      slotDurationMinutes: config.slotDurationMinutes,
    });
  }, []);

  const reload = useCallback(() => {
    const kept = [...storeRef.current.instructors.keys()];
    storeRef.current = {
      instructors: new Map(),
      grid: new Map(),
      displayGrid: new Map(),
      blocks: [],
      loading: new Set(),
      names: new Map(),
      errors: {},
    };
    setPhase("loading");
    void (async () => {
      try {
        await loadSession();
        // Re-load instructor index in background
        void loadInstructorIndex();
        setPhase("ready");
        commit();
        if (kept.length > 0) await doLoad(kept);
      } catch (err) {
        setErrorMsg(loadErrorToMessage(err));
        setPhase("error");
      }
    })();
  }, [loadSession, commit, doLoad, loadInstructorIndex]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await loadSession();
        if (!active) return;
        setPhase("ready");
        commit();
      } catch (err) {
        if (!active) return;
        setErrorMsg(loadErrorToMessage(err));
        setPhase("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [loadSession, commit]);

  // Re-fetch specific instructors' Schedule/Instructor data without touching
  // `phase` -- unlike reload(), this doesn't reset the whole store, re-fetch
  // app_settings, or re-fetch every OTHER already-loaded instructor, so it
  // never triggers the full-page loading screen. Used after a booking/override
  // completes and by the realtime subscription below.
  //
  // SILENT by design: the old implementation deleted the instructor from the
  // store first, which blanked the row to the "Loading schedule…" skeleton and
  // redrew it on every realtime event -- across a company with many sales
  // dashboards open, a Schedule write anywhere made every grid flicker. Now the
  // instructor stays rendered with its current (stale) schedule while the fetch
  // runs, and only swaps in place once fresh data arrives. `force` lets doLoad
  // re-fetch an instructor that is still present. Silently ignores any id not
  // currently in the roster -- nothing to refresh for those.
  const refreshInstructors = useCallback(
    (ids: string[]) => {
      const s = storeRef.current;
      const present = ids.filter((id) => s.instructors.has(id));
      if (present.length === 0) return;
      void doLoad(present, { silent: true, force: true });
    },
    [doLoad],
  );

  // Realtime sync: when a Schedule row changes anywhere (e.g. a new
  // tentative/booked class created from another module), silently re-fetch
  // just that instructor's Schedule window if they're currently loaded into
  // this dashboard's roster, so the grid stays current without a manual
  // reload or re-search. Requires Realtime replication to be enabled for the
  // "Schedule" table in Supabase (Database -> Replication in the dashboard,
  // or `alter publication supabase_realtime add table "Schedule";` in the
  // SQL editor) -- without it this subscription connects but never receives
  // events.
  //
  // Coalesced: a bulk-add can fire dozens of Schedule events in one second,
  // and with many dashboards open each one would otherwise re-fetch the full
  // 400-day window per event. Events are collected for REALTIME_DEBOUNCE_MS
  // and each touched instructor is refreshed exactly once per burst. Direct
  // calls to refreshInstructors() (after a booking/override) stay immediate —
  // this only gates the realtime stream.
  const realtimePendingRef = useRef<Set<string>>(new Set());
  const realtimeTimerRef = useRef<number | null>(null);

  const flushRealtimeRefresh = useCallback(() => {
    if (realtimeTimerRef.current !== null) {
      window.clearTimeout(realtimeTimerRef.current);
      realtimeTimerRef.current = null;
    }
    const ids = [...realtimePendingRef.current];
    realtimePendingRef.current.clear();
    if (ids.length > 0) refreshInstructors(ids);
  }, [refreshInstructors]);

  const queueRealtimeRefresh = useCallback(
    (instrId: string | null) => {
      if (instrId) {
        realtimePendingRef.current.add(instrId);
      } else {
        // DELETE events only carry the deleted row's primary key in
        // payload.old by default (Postgres's REPLICA IDENTITY DEFAULT),
        // not the rest of the row -- so instructor_id is never available
        // here for a deletion, regardless of client-side code. Refreshing
        // every currently-loaded instructor is the safe fallback: it's
        // strictly more work than a targeted refresh, never less correct,
        // and the roster is normally a handful of instructors, not the
        // whole table. Fixed at the source (REPLICA IDENTITY FULL on
        // "Schedule") would let deletes be targeted too, but that's a DB
        // change requiring separate approval.
        for (const id of storeRef.current.instructors.keys())
          realtimePendingRef.current.add(id);
      }
      if (realtimeTimerRef.current === null) {
        realtimeTimerRef.current = window.setTimeout(
          flushRealtimeRefresh,
          REALTIME_DEBOUNCE_MS,
        );
      }
    },
    [flushRealtimeRefresh],
  );

  useEffect(() => {
    const channel = sb
      .channel("sales-dashboard-schedule-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "Schedule" },
        (payload: {
          new?: { instructor_id?: string } | null;
          old?: { instructor_id?: string } | null;
        }) => {
          queueRealtimeRefresh(
            payload.new?.instructor_id ?? payload.old?.instructor_id ?? null,
          );
        },
      )
      .subscribe();
    return () => {
      if (realtimeTimerRef.current !== null) {
        window.clearTimeout(realtimeTimerRef.current);
        realtimeTimerRef.current = null;
      }
      realtimePendingRef.current.clear();
      void sb.removeChannel(channel);
    };
  }, [queueRealtimeRefresh]);

  return {
    phase,
    errorMsg,
    data,
    reload,
    loadInstructors,
    removeInstructor,
    loadInstructorIndex,
    refreshInstructors,
  };
}
