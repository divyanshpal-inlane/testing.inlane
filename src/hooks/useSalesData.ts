import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildDisplayFreeGrid,
  buildInstructorFreeGrid,
  candidateStartMinutes,
  type InstructorLike,
  type ScheduleBlock,
} from "@/lib/sales-dashboard/availability";
import {
  type BookingFlowConfig,
  readBookingFlowConfig,
} from "@/lib/sales-dashboard/config";
import {
  addDaysISO,
  istTodayISO,
  timeToMinutes,
} from "@/lib/sales-dashboard/validation";
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

export interface InstructorRow {
  id: string;
  name: string;
  areas: string[];
  gender: string | null;
  status: string | null;
  enabled: boolean | null;
  unavailability: unknown[] | null;
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
}

export interface SalesData {
  config: BookingFlowConfig;
  dates: string[];
  timeStarts: number[];
  allInstructors: LightInstructor[];
  instructors: InstructorRow[];
  loading: LightInstructor[];
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
          "id, instructor_id, date, start_time, end_time, status, learner_id, course_id, leadName, isTentative, tentative_details, pause_reason, pause_notes",
        )
        .gte("date", dateFrom)
        .lte("date", dateTo);
      if (excludeFilter) query = query.not("status", "in", excludeFilter);
      if (group) query = query.in("instructor_id", group);
      const { data, error } = await query
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as ScheduleRow[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

function parseInstructors(rows: Record<string, unknown>[]): InstructorRow[] {
  return rows.map((r) => ({
    id: String(r.id_instructor),
    name: String(r.name ?? ""),
    areas: Array.isArray(r.areas)
      ? (r.areas as string[]).map((a) => String(a))
      : [],
    gender: r.gender == null ? null : String(r.gender),
    status: r.status == null ? null : String(r.status),
    enabled: r.enabled == null ? null : Boolean(r.enabled),
    unavailability:
      r.unavailability == null ? null : (r.unavailability as unknown[]),
  }));
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
    status: i.status,
    enabled: i.enabled,
    unavailability: i.unavailability,
  };
}

interface Store {
  instructors: Map<string, InstructorRow>;
  grid: Map<string, Map<string, number[]>>;
  displayGrid: Map<string, Map<string, number[]>>;
  blocks: BlockDetail[];
  loading: Set<string>;
  errors: Record<string, string>;
}

export function useSalesData() {
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [data, setData] = useState<SalesData | null>(null);

  const configRef = useRef<BookingFlowConfig | null>(null);
  const datesRef = useRef<string[]>([]);
  const timeStartsRef = useRef<number[]>([]);
  const allRef = useRef<LightInstructor[]>([]);
  const storeRef = useRef<Store>({
    instructors: new Map(),
    grid: new Map(),
    displayGrid: new Map(),
    blocks: [],
    loading: new Set(),
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
      dates: datesRef.current,
      timeStarts: timeStartsRef.current,
      allInstructors: allRef.current,
      instructors: [...s.instructors.values()],
      loading: loadingIds
        .map((id) => byId.get(id))
        .filter((x): x is LightInstructor => Boolean(x)),
      errors: { ...s.errors },
      freeGrid: s.grid,
      displayGrid: s.displayGrid,
      blocks: s.blocks,
    });
  }, []);

  const doLoad = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const s = storeRef.current;
      const wanted = [...new Set(ids)].filter(
        (id) => !s.instructors.has(id) && !s.loading.has(id),
      );
      if (wanted.length === 0) return;
      for (const id of wanted) s.loading.add(id);
      commit();
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

      try {
        // Instructor detail rows and the Schedule window are independent
        // queries (Schedule doesn't need the Instructor rows at all) — fetch
        // both concurrently instead of awaiting one after the other. Each
        // chunk of instructor IDs is also fetched concurrently rather than
        // in a serial loop (only matters once more than IN_CHUNK ids are
        // requested at once, e.g. a location-search match).
        const [instructorChunks, scheduleRows] = await Promise.all([
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
                  "id_instructor, name, areas, unavailability, status, enabled",
                )
                .in("id_instructor", part);
              if (error) throw error;
              return parseInstructors(
                (rows ?? []) as Record<string, unknown>[],
              );
            }),
          ),
          fetchScheduleWindow(wanted, from, to, excluded),
        ]);

        const infos = new Map<string, InstructorRow>();
        for (const part of instructorChunks) {
          for (const r of part) infos.set(r.id, r);
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
                .select("id, name, area")
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
        for (const part of learnerChunks) {
          for (const l of part) {
            learnerNames.set(
              String(l.id),
              l.name == null ? "" : String(l.name),
            );
            learnerAreas.set(
              String(l.id),
              l.area == null ? "" : String(l.area),
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
        s.blocks.push(...blockDetails);
        for (const id of wanted) s.loading.delete(id);
      } catch (err) {
        for (const id of wanted) {
          s.loading.delete(id);
          s.errors[id] = err instanceof Error ? err.message : String(err);
        }
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
      s.loading.delete(id);
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
      .select("id_instructor, name, status, enabled");
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
      .maybeSingle();
    if (cfgErr) throw cfgErr;
    const config = readBookingFlowConfig(settingRow?.value);
    if (!config.enabled) {
      throw new Error(
        "booking_flow configuration is missing or incomplete in app_settings (enabled:false).",
      );
    }
    configRef.current = config;

    const from = addDaysISO(istTodayISO(), 1);
    const viewDays = config.view_days_ahead ?? DEFAULT_VIEW_DAYS_AHEAD;
    const to = addDaysISO(from, viewDays - 1);
    datesRef.current = [];
    for (let d = from; d <= to; d = addDaysISO(d, 1)) datesRef.current.push(d);
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
        setErrorMsg(err instanceof Error ? err.message : String(err));
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
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [loadSession, commit]);

  // Silently re-fetch specific instructors' Schedule/Instructor data without
  // touching `phase` -- unlike reload(), this doesn't reset the whole store,
  // re-fetch app_settings, or re-fetch every OTHER already-loaded
  // instructor, so it never triggers the full-page loading screen. Used
  // after a booking/override completes (only the affected instructor(s)
  // changed) and by the realtime subscription below (only the instructor
  // named in the changed row needs refreshing). Silently ignores any id not
  // currently in the roster -- nothing to refresh for those.
  const refreshInstructors = useCallback(
    (ids: string[]) => {
      const s = storeRef.current;
      const present = ids.filter((id) => s.instructors.has(id));
      if (present.length === 0) return;
      // Deleting first makes doLoad treat these as "not yet loaded" so it
      // re-fetches fresh data instead of skipping them as already-present.
      // This briefly shows the same per-row "Loading schedule..." skeleton
      // used when an instructor is first added.
      for (const id of present) s.instructors.delete(id);
      commit();
      void doLoad(present);
    },
    [commit, doLoad],
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
          const instrId =
            payload.new?.instructor_id ?? payload.old?.instructor_id;
          if (instrId) {
            refreshInstructors([instrId]);
            return;
          }
          // DELETE events only carry the deleted row's primary key in
          // payload.old by default (Postgres's REPLICA IDENTITY DEFAULT),
          // not the rest of the row -- so instructor_id is never available
          // here for a deletion, regardless of client-side code. Refreshing
          // every currently-loaded instructor is the safe fallback: it's
          // strictly more work than a targeted refresh, never less
          // correct, and the roster is normally a handful of instructors,
          // not the whole table. Fixed at the source (REPLICA IDENTITY
          // FULL on "Schedule") would let deletes be targeted too, but
          // that's a DB change requiring separate approval.
          const loadedIds = [...storeRef.current.instructors.keys()];
          if (loadedIds.length > 0) refreshInstructors(loadedIds);
        },
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [refreshInstructors]);

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
