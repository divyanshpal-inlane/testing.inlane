import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";

import { supabase } from "@/lib/supabaseClient";
import { isTimeUnavailable } from "@/utils/time";

export const MATRIX_DAY_START_HOUR = 6;
export const MATRIX_DAY_END_HOUR = 20;
export const MATRIX_HOURS_PER_DAY = MATRIX_DAY_END_HOUR - MATRIX_DAY_START_HOUR; // 14
export const MATRIX_INSTRUCTOR_BATCH_SIZE = 10;
const MATRIX_SCHEDULE_BATCH_SIZE = 1000;

// The grid is rendered in 30-minute slots so half-hour lessons map to a single
// block instead of bleeding across two whole-hour cells.
export const MATRIX_SLOT_MINUTES = 30;
export const MATRIX_DAY_START_MIN = MATRIX_DAY_START_HOUR * 60; // 06:00
export const MATRIX_DAY_END_MIN = MATRIX_DAY_END_HOUR * 60; // 20:00
export const MATRIX_SLOTS_PER_DAY =
  (MATRIX_DAY_END_MIN - MATRIX_DAY_START_MIN) / MATRIX_SLOT_MINUTES; // 28

export type SlotStatus =
  | "free"
  | "booked"
  | "unavailable"
  | "conflict"
  // A tentative hold that is NOT being counted as busy (only occurs in the
  // "exclude tentative" view). Held time shown faintly, but treated as free.
  | "tentative";

export type EnrollmentType = "course" | "demo" | "topup" | "tentative" | null;

export interface MatrixSchedule {
  id: number;
  start_time: string;
  end_time: string;
  startHour: number;
  endHour: number;
  startMin: number | null; // minutes from midnight
  endMin: number | null;
  status: string | null;
  isTentative: boolean | null;
  learnerId: string | null;
  learnerName: string | null;
  learnerPhone: string | null;
  lessonId: string | null;
  lessonNumber: number | null;
  enrollmentType: EnrollmentType;
}

export interface MatrixSlot {
  startMin: number; // minutes from midnight, start of the 30-min slot
  endMin: number; // minutes from midnight, end of the 30-min slot
  status: SlotStatus;
  schedules: MatrixSchedule[]; // counted schedules: usually 0 or 1; >1 means conflict
  // Tentative holds overlapping this slot that are NOT counted in the current
  // view (only populated in the "exclude tentative" view; empty otherwise).
  tentativeSchedules: MatrixSchedule[];
}

export interface MatrixDay {
  date: string; // yyyy-MM-dd
  weekday: string; // e.g., "Mon"
  dayOfMonth: number;
  slots: MatrixSlot[];
  bookedHours: number;
  unavailableHours: number;
  capacityHours: number; // hours actually offered (working window − unavailable)
  conflictCount: number;
  // Hours of tentative holds NOT counted in the current view (0 when tentative
  // is being counted as busy).
  tentativeHours: number;
}

export interface MatrixInstructor {
  id: string;
  name: string;
  phone: string | null;
}

export interface MatrixRow {
  instructor: MatrixInstructor;
  days: MatrixDay[];
  weekBookedHours: number;
  weekCapacityHours: number;
  weekConflictCount: number;
}

export interface InstructorMatrixData {
  from: string; // yyyy-MM-dd
  to: string; // yyyy-MM-dd (inclusive)
  dayHeaders: { date: string; weekday: string; dayOfMonth: number }[];
  rows: MatrixRow[];
  totals: {
    instructorCount: number;
    bookedHours: number;
    capacityHours: number;
    conflictCount: number;
  };
}

// An enriched schedule plus the keys needed to regroup it by instructor/day.
export interface MatrixRawSchedule extends MatrixSchedule {
  instructorId: string;
  date: string; // yyyy-MM-dd
}

export interface MatrixInstructorMeta {
  id: string;
  name: string;
  phone: string | null;
  unavailability: unknown[] | null;
}

// The raw, view-independent payload returned by the query. The expensive
// per-instructor/day computation lives in buildInstructorMatrix() so the UI can
// switch between counting / excluding tentative holds without re-fetching.
export interface MatrixRawData {
  from: string;
  to: string;
  dayHeaders: { date: string; weekday: string; dayOfMonth: number }[];
  instructors: MatrixInstructorMeta[];
  schedules: MatrixRawSchedule[];
}

const timeToMinutes = (t: string | null | undefined): number | null => {
  if (!t) return null;
  const [h, m = "0"] = t.split(":");
  return Number(h) * 60 + Number(m);
};

// Two half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap only if each
// starts strictly before the other ends. Touching ends (back-to-back lessons)
// do NOT count as overlapping.
const intervalsOverlap = (
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean => aStart < bEnd && bStart < aEnd;

const hoursBetween = (
  startTime: string | null,
  endTime: string | null,
): number => {
  if (!startTime || !endTime) return 0;
  const [sh, sm = "0"] = startTime.split(":");
  const [eh, em = "0"] = endTime.split(":");
  const startMin = Number(sh) * 60 + Number(sm);
  const endMin = Number(eh) * 60 + Number(em);
  return Math.max(0, (endMin - startMin) / 60);
};

export interface MatrixRawPage extends MatrixRawData {
  hasMore: boolean;
  nextOffset: number;
}

export function mergeInstructorMatrixPages(
  pages: MatrixRawData[],
): MatrixRawData {
  const { from, to, dayHeaders } = pages[0];
  const instructors = new Map<string, MatrixInstructorMeta>();
  const schedules = new Map<number, MatrixRawSchedule>();
  for (const page of pages) {
    for (const instructor of page.instructors) {
      instructors.set(instructor.id, instructor);
    }
    for (const schedule of page.schedules) schedules.set(schedule.id, schedule);
  }
  return {
    from,
    to,
    dayHeaders,
    instructors: Array.from(instructors.values()),
    schedules: Array.from(schedules.values()),
  };
}

// Keep the selector stable so loading indicators and drawer state don't cause
// React Query to rebuild the raw payload and recalculate every loaded row.
const selectInstructorMatrixData = (data: { pages: MatrixRawPage[] }) =>
  mergeInstructorMatrixPages(data.pages);

export function useInstructorMatrix(opts: {
  weekStart: Date; // Monday at 00:00 local
  selectedIds?: string[];
  hideOffDuty?: boolean;
  countTentative?: boolean;
  enabled?: boolean;
}) {
  const {
    weekStart,
    selectedIds = [],
    hideOffDuty = false,
    countTentative = true,
    enabled = true,
  } = opts;
  const from = format(weekStart, "yyyy-MM-dd");
  const to = format(addDays(weekStart, 6), "yyyy-MM-dd");

  return useInfiniteQuery({
    queryKey: [
      "instructor-matrix",
      from,
      to,
      [...selectedIds].sort(),
      hideOffDuty,
      countTentative,
    ],
    enabled,
    // Revisiting a week/filter starts at the first batch instead of restoring
    // (and refetching) every page loaded on the previous visit.
    gcTime: 0,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchInstructorMatrixPage({
        weekStart,
        selectedIds,
        offset: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextOffset : undefined,
    select: selectInstructorMatrixData,
  });
}

// The picker searches all enabled instructors on demand, independently of the
// matrix's loaded pages. Keep its existing limit of 40 suggestions.
export function useInstructorMatrixSuggestions(opts: {
  search: string;
  selectedIds: string[];
  enabled: boolean;
}) {
  const { search, selectedIds, enabled } = opts;
  return useQuery({
    queryKey: [
      "instructor-matrix-suggestions",
      search,
      [...selectedIds].sort(),
    ],
    enabled,
    gcTime: 0,
    queryFn: async ({ signal }): Promise<MatrixInstructor[]> => {
      let query = supabase
        .from("Instructor")
        .select("id_instructor, name, phone")
        .or("enabled.eq.true,enabled.is.null")
        .order("name", { ascending: true })
        .order("id_instructor", { ascending: true })
        .range(0, 39)
        .abortSignal(signal);
      if (selectedIds.length > 0) {
        query = query.not("id_instructor", "in", `(${selectedIds.join(",")})`);
      }
      if (search.trim()) {
        // Quote PostgREST values and escape LIKE wildcards so punctuation in
        // names/phone numbers is matched literally, as in the original picker.
        const pattern = `%${search.trim().replace(/[\\%_]/g, "\\$&")}%`;
        const value = `"${pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        query = query.or(`name.ilike.${value},phone.ilike.${value}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((instructor) => ({
        id: instructor.id_instructor,
        name: instructor.name ?? "(unnamed)",
        phone: instructor.phone,
      }));
    },
  });
}

export async function fetchInstructorMatrixPage(opts: {
  weekStart: Date;
  offset?: number;
  selectedIds?: string[];
  signal?: AbortSignal;
}): Promise<MatrixRawPage> {
  const { weekStart, offset = 0, selectedIds = [], signal } = opts;
  const from = format(weekStart, "yyyy-MM-dd");
  const to = format(addDays(weekStart, 6), "yyyy-MM-dd");
  // One lookahead row determines whether another batch exists. Only this
  // database-bounded batch is sliced; the full instructor list is never fetched.
  let instructorQuery = supabase
    .from("Instructor")
    .select("id_instructor, name, phone, unavailability")
    .or("enabled.eq.true,enabled.is.null")
    .order("name", { ascending: true })
    .order("id_instructor", { ascending: true })
    .range(offset, offset + MATRIX_INSTRUCTOR_BATCH_SIZE);
  if (selectedIds.length > 0) {
    instructorQuery = instructorQuery.in("id_instructor", selectedIds);
  }
  if (signal) instructorQuery = instructorQuery.abortSignal(signal);
  const { data: instructorRows, error: instructorErr } = await instructorQuery;

  if (instructorErr) throw instructorErr;

  const instructorBatch = (instructorRows ?? []).slice(
    0,
    MATRIX_INSTRUCTOR_BATCH_SIZE,
  );
  const instructorIds = instructorBatch.map((i) => i.id_instructor);

  const buildScheduleQuery = (scheduleOffset: number) => {
    let query = supabase
      .from("Schedule")
      .select(
        "id, instructor_id, learner_id, lesson_id, date, start_time, end_time, status, isTentative, Learner(id, name, phone), Lesson(id, number)",
      )
      .in("instructor_id", instructorIds)
      .gte("date", from)
      .lte("date", to)
      .not("status", "in", "(paused,pending_payment)")
      .order("id", { ascending: true })
      .range(scheduleOffset, scheduleOffset + MATRIX_SCHEDULE_BATCH_SIZE - 1);
    if (signal) query = query.abortSignal(signal);
    return query;
  };
  // A busy batch can exceed Supabase's response limit. Fetch all schedules
  // for these instructors so their hours/conflicts remain accurate.
  const scheduleData: NonNullable<
    Awaited<ReturnType<typeof buildScheduleQuery>>["data"]
  > = [];
  if (instructorIds.length > 0) {
    for (
      let scheduleOffset = 0;
      ;
      scheduleOffset += MATRIX_SCHEDULE_BATCH_SIZE
    ) {
      const { data: scheduleRows, error: scheduleErr } =
        await buildScheduleQuery(scheduleOffset);
      if (scheduleErr) throw scheduleErr;
      scheduleData.push(...(scheduleRows ?? []));
      if (!scheduleRows || scheduleRows.length < MATRIX_SCHEDULE_BATCH_SIZE)
        break;
    }
  }

  // Enrollment lookup for booked learners — to tag course / demo / topup.
  const uniqueLearnerIds = Array.from(
    new Set(
      scheduleData.map((s) => s.learner_id).filter((id): id is string => !!id),
    ),
  );

  const enrollmentTypeByLearner = new Map<string, EnrollmentType>();
  if (uniqueLearnerIds.length > 0) {
    let enrollmentQuery = supabase
      .from("enrollment")
      .select("learner_id, course_id, progress, created_at")
      .in("learner_id", uniqueLearnerIds)
      .order("created_at", { ascending: false });
    if (signal) enrollmentQuery = enrollmentQuery.abortSignal(signal);
    const { data: enrollmentRows } = await enrollmentQuery;

    for (const e of enrollmentRows ?? []) {
      if (enrollmentTypeByLearner.has(e.learner_id)) continue;
      const progress = e.progress as { type?: string } | null | undefined;
      const t = progress?.type ?? (e.course_id ? "course" : null);
      enrollmentTypeByLearner.set(
        e.learner_id,
        t === "course" || t === "demo" || t === "topup" ? t : null,
      );
    }
  }

  // Enrich + tag each schedule with its instructor/day so the builder can
  // regroup. View-independent — the tentative toggle is applied later.
  const schedules: MatrixRawSchedule[] = [];
  for (const s of scheduleData) {
    if (!s.instructor_id) continue;
    const learner = Array.isArray(s.Learner) ? s.Learner[0] : s.Learner;
    const lesson = Array.isArray(s.Lesson) ? s.Lesson[0] : s.Lesson;
    schedules.push({
      instructorId: s.instructor_id,
      date: s.date,
      id: s.id,
      start_time: s.start_time,
      end_time: s.end_time,
      startHour: Number(s.start_time?.slice(0, 2) ?? 0),
      endHour: Number(s.end_time?.slice(0, 2) ?? 0),
      startMin: timeToMinutes(s.start_time),
      endMin: timeToMinutes(s.end_time),
      status: s.status,
      isTentative: s.isTentative,
      learnerId: s.learner_id,
      learnerName: learner?.name ?? s["leadName" as keyof typeof s] ?? null,
      learnerPhone: learner?.phone ?? null,
      lessonId: s.lesson_id,
      lessonNumber: lesson?.number ?? null,
      enrollmentType: s.isTentative
        ? "tentative"
        : s.learner_id
          ? (enrollmentTypeByLearner.get(s.learner_id) ?? null)
          : null,
    });
  }

  // Build day headers
  const dayHeaders = Array.from({ length: 7 }).map((_, i) => {
    const d = addDays(weekStart, i);
    return {
      date: format(d, "yyyy-MM-dd"),
      weekday: format(d, "EEE"),
      dayOfMonth: d.getDate(),
    };
  });

  const instructors: MatrixInstructorMeta[] = instructorBatch.map((instr) => ({
    id: instr.id_instructor,
    name: instr.name ?? "(unnamed)",
    phone: instr.phone,
    unavailability: Array.isArray(instr.unavailability)
      ? (instr.unavailability as unknown[])
      : null,
  }));

  return {
    from,
    to,
    dayHeaders,
    instructors,
    schedules,
    hasMore: (instructorRows?.length ?? 0) > MATRIX_INSTRUCTOR_BATCH_SIZE,
    nextOffset: offset + MATRIX_INSTRUCTOR_BATCH_SIZE,
  };
}

// Full-week export is deliberately separate from the infinite query: download
// every enabled instructor only in response to the Export Excel action.
export async function fetchCompleteInstructorMatrix(
  weekStart: Date,
): Promise<MatrixRawData> {
  const pages: MatrixRawPage[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchInstructorMatrixPage({ weekStart, offset });
    pages.push(page);
    if (!page.hasMore) break;
    offset = page.nextOffset;
  }
  return mergeInstructorMatrixPages(pages);
}

// Pure computation of the matrix from the raw fetched data. The same builder
// applies the tentative view to both the loaded batches and full-week exports.
//
// View A (includeTentative=true): tentative holds count exactly like confirmed
//   bookings — block time, count toward conflicts and booked hours.
// View B (includeTentative=false): tentative holds are excluded from conflicts,
//   booked hours, and blocking, but kept aside (slot.tentativeSchedules /
//   day.tentativeHours / "tentative" slot status) so they can be shown faintly.
export function buildInstructorMatrix(
  raw: MatrixRawData,
  opts: { includeTentative: boolean },
): InstructorMatrixData {
  const { includeTentative } = opts;
  const { from, to, dayHeaders, instructors, schedules } = raw;

  // Group schedules: instructorId -> date -> list
  const byInstrDate = new Map<string, Map<string, MatrixRawSchedule[]>>();
  for (const s of schedules) {
    if (!byInstrDate.has(s.instructorId)) {
      byInstrDate.set(s.instructorId, new Map());
    }
    const dateMap = byInstrDate.get(s.instructorId)!;
    if (!dateMap.has(s.date)) dateMap.set(s.date, []);
    dateMap.get(s.date)!.push(s);
  }

  const rows: MatrixRow[] = instructors.map((instr) => {
    const unavailability = instr.unavailability;
    const dateMap =
      byInstrDate.get(instr.id) ?? new Map<string, MatrixRawSchedule[]>();
    let weekBookedHours = 0;
    let weekCapacityHours = 0;
    let weekConflictCount = 0;

    const days: MatrixDay[] = dayHeaders.map((header) => {
      const dayDate = parseISO(header.date);
      const allDaySchedules: MatrixRawSchedule[] =
        dateMap.get(header.date) ?? [];

      // Split into the schedules that count as busy and the tentative holds set
      // aside for display-only when excluding tentative.
      const counting = includeTentative
        ? allDaySchedules
        : allDaySchedules.filter((s) => !s.isTentative);
      const tentativeAside = includeTentative
        ? []
        : allDaySchedules.filter((s) => s.isTentative);

      // Conflicts are detected from real time-overlap between counted lessons,
      // independent of the display grid. Back-to-back lessons (e.g.
      // 12:00–12:30 and 12:30–13:00) do NOT conflict; genuinely overlapping
      // lessons do. conflictCount = number of lessons that clash with at least
      // one other counted lesson that day.
      const conflictIds = new Set<number>();
      for (let i = 0; i < counting.length; i++) {
        const a = counting[i];
        if (a.startMin == null || a.endMin == null) continue;
        for (let j = i + 1; j < counting.length; j++) {
          const b = counting[j];
          if (b.startMin == null || b.endMin == null) continue;
          if (intervalsOverlap(a.startMin, a.endMin, b.startMin, b.endMin)) {
            conflictIds.add(a.id);
            conflictIds.add(b.id);
          }
        }
      }
      const conflictCount = conflictIds.size;

      let unavailableSlots = 0;
      const slots: MatrixSlot[] = [];

      // 30-minute slots across the working window (06:00–20:00).
      for (
        let m = MATRIX_DAY_START_MIN;
        m < MATRIX_DAY_END_MIN;
        m += MATRIX_SLOT_MINUTES
      ) {
        const slotEnd = m + MATRIX_SLOT_MINUTES;
        const overlaps = (sch: MatrixRawSchedule) =>
          sch.startMin != null &&
          sch.endMin != null &&
          intervalsOverlap(m, slotEnd, sch.startMin, sch.endMin);
        const countingOverlap = counting.filter(overlaps);
        const tentativeOverlap = tentativeAside.filter(overlaps);
        const unavailable = isTimeUnavailable(
          unavailability,
          dayDate,
          Math.floor(m / 60),
          m % 60,
        );

        let status: SlotStatus;
        if (countingOverlap.length > 1) {
          status = "conflict";
        } else if (countingOverlap.length === 1) {
          status = "booked";
        } else if (tentativeOverlap.length >= 1) {
          // Only reachable in View B: held tentatively, but not counted busy.
          status = "tentative";
        } else if (unavailable) {
          status = "unavailable";
          unavailableSlots += 1;
        } else {
          status = "free";
        }

        slots.push({
          startMin: m,
          endMin: slotEnd,
          status,
          schedules: countingOverlap,
          tentativeSchedules: tentativeOverlap,
        });
      }

      // Each unavailable 30-min slot is half an hour of lost capacity.
      const unavailableHours = (unavailableSlots * MATRIX_SLOT_MINUTES) / 60;

      // Capacity uses the fixed working window minus unavailability.
      const capacityHours = Math.max(
        0,
        MATRIX_HOURS_PER_DAY - unavailableHours,
      );

      // Use schedule durations for a more accurate booked-hours count when
      // schedules don't align to the hour grid. Tentative holds only contribute
      // when they're being counted as busy.
      const exactBookedHours = counting.reduce(
        (sum, s) =>
          sum +
          Math.min(
            MATRIX_HOURS_PER_DAY,
            hoursBetween(s.start_time, s.end_time),
          ),
        0,
      );
      const tentativeHours = tentativeAside.reduce(
        (sum, s) =>
          sum +
          Math.min(
            MATRIX_HOURS_PER_DAY,
            hoursBetween(s.start_time, s.end_time),
          ),
        0,
      );

      weekBookedHours += exactBookedHours;
      weekCapacityHours += capacityHours;
      weekConflictCount += conflictCount;

      return {
        date: header.date,
        weekday: header.weekday,
        dayOfMonth: header.dayOfMonth,
        slots,
        bookedHours: exactBookedHours,
        unavailableHours,
        capacityHours,
        conflictCount,
        tentativeHours,
      };
    });

    return {
      instructor: { id: instr.id, name: instr.name, phone: instr.phone },
      days,
      weekBookedHours,
      weekCapacityHours,
      weekConflictCount,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      instructorCount: acc.instructorCount + 1,
      bookedHours: acc.bookedHours + r.weekBookedHours,
      capacityHours: acc.capacityHours + r.weekCapacityHours,
      conflictCount: acc.conflictCount + r.weekConflictCount,
    }),
    {
      instructorCount: 0,
      bookedHours: 0,
      capacityHours: 0,
      conflictCount: 0,
    },
  );

  return { from, to, dayHeaders, rows, totals };
}
