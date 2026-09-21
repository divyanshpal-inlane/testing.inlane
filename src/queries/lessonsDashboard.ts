import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/lib/supabaseClient";

export type LessonStatus =
  | "active"
  | "completed"
  | "paused"
  | "pending_payment"
  | "cancelled"
  | string;

export type EnrollmentType = "course" | "demo" | "topup" | null;

export interface LessonRow {
  scheduleId: number;
  date: string; // yyyy-MM-dd
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  customerName: string | null;
  customerPhone: string | null;
  classNumber: number | null;
  enrollmentType: EnrollmentType;
  instructorId: string | null;
  instructorName: string | null;
  instructorPhone: string | null;
  vehicle: string | null; // car_make + car_mode
  kamId: string | null;
  kamName: string | null;
  status: LessonStatus | null;
  isTentative: boolean | null;
  pickupLocation: string | null;
}

export interface LessonsDashboardFilters {
  from: string; // yyyy-MM-dd
  to: string; // yyyy-MM-dd inclusive
  kamIds?: string[]; // empty/undefined = all
  instructorIds?: string[]; // empty/undefined = all
  classNumbers?: number[]; // empty/undefined = all
  statuses?: string[]; // empty/undefined = all (but defaults applied at call site)
  search?: string; // free-text on customer name/phone
}

const trimTime = (t: string | null | undefined) => (t ?? "").slice(0, 5) || "";

export function useLessonsDashboard(filters: LessonsDashboardFilters) {
  const { from, to, kamIds, instructorIds, classNumbers, statuses, search } =
    filters;

  return useQuery({
    queryKey: [
      "lessons-dashboard",
      from,
      to,
      kamIds?.slice().sort().join(",") ?? "",
      instructorIds?.slice().sort().join(",") ?? "",
      classNumbers?.slice().sort().join(",") ?? "",
      statuses?.slice().sort().join(",") ?? "",
      search ?? "",
    ],
    queryFn: async (): Promise<LessonRow[]> => {
      // statuses === undefined → no status filter (show every status, including
      // values not in STATUS_OPTIONS and null). statuses === [] → the user
      // deselected every status chip, so there is nothing to show.
      if (statuses && statuses.length === 0) return [];

      // 1. Base Schedule query — server-side filtering on date/status/instructor
      //    keeps the row count down before client-side KAM/class/search filters.
      //    PostgREST caps each response at 1000 rows, so page through the date
      //    range in 1000-row chunks; a wide range easily exceeds one page and
      //    would otherwise be silently truncated.
      const PAGE_SIZE = 1000;
      const buildScheduleQuery = () => {
        let q = supabase
          .from("Schedule")
          .select(
            "id, date, start_time, end_time, status, isTentative, instructor_id, learner_id, lesson_id, Learner(id, name, phone, pick_up_location), Lesson(id, number), Instructor(id_instructor, name, phone, car_make, car_mode)",
          )
          .gte("date", from)
          .lte("date", to)
          .order("date", { ascending: true })
          .order("start_time", { ascending: true })
          .order("id", { ascending: true }); // stable tiebreaker for paging
        if (statuses && statuses.length > 0) {
          q = q.in("status", statuses);
        }
        if (instructorIds && instructorIds.length > 0) {
          q = q.in("instructor_id", instructorIds);
        }
        return q;
      };

      const schedules: unknown[] = [];
      for (let page = 0; ; page++) {
        const start = page * PAGE_SIZE;
        const { data, error: schedErr } = await buildScheduleQuery().range(
          start,
          start + PAGE_SIZE - 1,
        );
        if (schedErr) throw schedErr;
        if (!data || data.length === 0) break;
        schedules.push(...data);
        if (data.length < PAGE_SIZE) break;
      }

      const scheduleRows = schedules as unknown as Array<{
        id: number;
        date: string;
        start_time: string;
        end_time: string;
        status: string | null;
        isTentative: boolean | null;
        instructor_id: string | null;
        learner_id: string | null;
        lesson_id: string | null;
        Learner:
          | {
              id: string;
              name: string | null;
              phone: string | null;
              pick_up_location: string | null;
            }
          | {
              id: string;
              name: string | null;
              phone: string | null;
              pick_up_location: string | null;
            }[]
          | null;
        Lesson:
          | { id: string; number: number | null }
          | { id: string; number: number | null }[]
          | null;
        Instructor:
          | {
              id_instructor: string;
              name: string | null;
              phone: string | null;
              car_make: string | null;
              car_mode: string | null;
            }
          | {
              id_instructor: string;
              name: string | null;
              phone: string | null;
              car_make: string | null;
              car_mode: string | null;
            }[]
          | null;
      }>;

      if (scheduleRows.length === 0) return [];

      // 2. KAM lookup per instructor.
      const uniqueInstructorIds = Array.from(
        new Set(
          scheduleRows
            .map((s) => s.instructor_id)
            .filter((id): id is string => !!id),
        ),
      );

      const kamByInstructor = new Map<
        string,
        { id: string; name: string } | null
      >();

      if (uniqueInstructorIds.length > 0) {
        // Step 2a: fetch raw instructor→kam_id links without embedding.
        // Using plain columns avoids PostgREST resource-embedding ambiguity
        // with the quoted "KAM" table name, which was silently returning null
        // for the embedded object and making the KAM filter show 0 results.
        const { data: links, error: linkErr } = await supabase
          .from("kam_instructor")
          .select("instructor_id, kam_id")
          .in("instructor_id", uniqueInstructorIds);
        if (linkErr) throw linkErr;

        const linkRows = (links ?? []) as Array<{
          instructor_id: string;
          kam_id: string;
        }>;

        // Build instructor → [kam_id, ...] map (M:N supported).
        const allKamIdsByInstructor = new Map<string, string[]>();
        for (const r of linkRows) {
          const list = allKamIdsByInstructor.get(r.instructor_id) ?? [];
          list.push(r.kam_id);
          allKamIdsByInstructor.set(r.instructor_id, list);
        }

        // Step 2b: fetch KAM names for the display column (separate query so
        // the filter logic never depends on the join working correctly).
        // This is non-fatal: if the KAM table query fails (e.g. transient
        // error or RLS) the filter still works by ID; names just won't show.
        const uniqueKamIds = Array.from(new Set(linkRows.map((r) => r.kam_id)));
        const kamNameById = new Map<string, string>();
        if (uniqueKamIds.length > 0) {
          const { data: kamData } = await supabase
            .from("KAM")
            .select("id, name")
            .in("id", uniqueKamIds);
          for (const k of (kamData ?? []) as Array<{
            id: string;
            name: string;
          }>) {
            kamNameById.set(k.id, k.name);
          }
        }

        // Build instructor → primary KAM display object (alphabetically first
        // when an instructor is linked to multiple KAMs).
        for (const [iid, kIds] of allKamIdsByInstructor) {
          const kams = kIds
            .map((kid) => ({ id: kid, name: kamNameById.get(kid) ?? "" }))
            .sort((a, b) => a.name.localeCompare(b.name));
          kamByInstructor.set(iid, kams[0] ?? null);
        }

        // For KAM filtering: build a Set<instructor_id> of instructors whose
        // KAMs intersect the filter, so we can check membership cheaply.
        if (kamIds && kamIds.length > 0) {
          const kamFilter = new Set(kamIds);
          const matchedInstructors = new Set<string>();
          for (const [iid, kIds] of allKamIdsByInstructor) {
            if (kIds.some((kid) => kamFilter.has(kid))) {
              matchedInstructors.add(iid);
            }
          }
          // Re-scope scheduleRows below via this matched set.
          // Stash on the closure for use after enrollment resolution.
          (kamByInstructor as unknown as Record<string, unknown>).__matched =
            matchedInstructors;
        }
      }

      // 3. Enrollment type lookup (course/demo/topup) per learner — matches the
      //    pattern in useInstructorScheduleData.
      const uniqueLearnerIds = Array.from(
        new Set(
          scheduleRows
            .map((s) => s.learner_id)
            .filter((id): id is string => !!id),
        ),
      );

      const enrollmentTypeByLearner = new Map<string, EnrollmentType>();
      if (uniqueLearnerIds.length > 0) {
        const { data: enrollmentRows } = await supabase
          .from("enrollment")
          .select("learner_id, course_id, progress, created_at")
          .in("learner_id", uniqueLearnerIds)
          .order("created_at", { ascending: false });

        for (const e of (enrollmentRows ?? []) as Array<{
          learner_id: string;
          course_id: string | null;
          progress: unknown;
        }>) {
          if (enrollmentTypeByLearner.has(e.learner_id)) continue;
          const progress = e.progress as { type?: string } | null | undefined;
          const t = progress?.type ?? (e.course_id ? "course" : null);
          enrollmentTypeByLearner.set(
            e.learner_id,
            t === "course" || t === "demo" || t === "topup" ? t : null,
          );
        }
      }

      // 3.5 Class number. The DB's Lesson.number is an unreliable per-course
      //     template counter — it's only renumbered on some schedule-create
      //     paths (skipped for reschedules, demo/top-up/virtual lessons, and
      //     when there's no course) and drifts out of sync (commonly stuck at
      //     1). Every other view (useLearnerSchedulesAdmin, the learner
      //     schedule view) instead derives the class number from the
      //     chronological position of the customer's schedules within a course.
      //     Mirror that here.
      //
      //     This needs each customer's FULL history in the course, not just the
      //     rows in the visible date range, so today's lesson can be ranked as
      //     e.g. their 5th. Fetch all schedules for the on-screen learners and
      //     number them per (learner, course) by date/time.
      type HistoryRow = {
        id: number;
        learner_id: string | null;
        course_id: string | null;
        date: string;
        start_time: string | null;
      };
      const classNumberBySchedule = new Map<number, number>();
      if (uniqueLearnerIds.length > 0) {
        const historyRows: HistoryRow[] = [];
        for (let page = 0; ; page++) {
          const start = page * PAGE_SIZE;
          const { data, error: histErr } = await supabase
            .from("Schedule")
            .select("id, learner_id, course_id, date, start_time")
            .in("learner_id", uniqueLearnerIds)
            .order("date", { ascending: true })
            .order("start_time", { ascending: true })
            .order("id", { ascending: true }) // stable tiebreaker for paging
            .range(start, start + PAGE_SIZE - 1);
          if (histErr) throw histErr;
          if (!data || data.length === 0) break;
          historyRows.push(...(data as HistoryRow[]));
          if (data.length < PAGE_SIZE) break;
        }

        // Group by (learner, course), sort chronologically, number 1..N — the
        // same grouping useLearnerSchedulesAdmin uses.
        const byLearnerCourse = new Map<string, HistoryRow[]>();
        for (const r of historyRows) {
          if (!r.learner_id) continue;
          const key = `${r.learner_id}|${r.course_id ?? "none"}`;
          const list = byLearnerCourse.get(key) ?? [];
          list.push(r);
          byLearnerCourse.set(key, list);
        }
        for (const list of byLearnerCourse.values()) {
          list.sort(
            (a, b) =>
              new Date(`${a.date}T${a.start_time || "00:00:00"}`).getTime() -
              new Date(`${b.date}T${b.start_time || "00:00:00"}`).getTime(),
          );
          list.forEach((r, i) => classNumberBySchedule.set(r.id, i + 1));
        }
      }

      // 4. Flatten into LessonRow list with all client-side filters applied.
      const kamMatchedInstructors = (
        kamByInstructor as unknown as { __matched?: Set<string> }
      ).__matched;

      const classNumberSet =
        classNumbers && classNumbers.length > 0 ? new Set(classNumbers) : null;
      const searchQ = (search ?? "").trim().toLowerCase();

      const rows: LessonRow[] = [];
      for (const s of scheduleRows) {
        if (kamIds && kamIds.length > 0) {
          if (!s.instructor_id) continue;
          if (!kamMatchedInstructors?.has(s.instructor_id)) continue;
        }

        const learner = Array.isArray(s.Learner) ? s.Learner[0] : s.Learner;
        const lesson = Array.isArray(s.Lesson) ? s.Lesson[0] : s.Lesson;
        const instructor = Array.isArray(s.Instructor)
          ? s.Instructor[0]
          : s.Instructor;

        // Computed chronological position within the customer's course; fall
        // back to the raw Lesson.number only when no computed value exists.
        const classNumber =
          classNumberBySchedule.get(s.id) ?? lesson?.number ?? null;
        if (classNumberSet) {
          if (classNumber == null || !classNumberSet.has(classNumber)) continue;
        }

        if (searchQ) {
          const hay =
            `${learner?.name ?? ""} ${learner?.phone ?? ""}`.toLowerCase();
          if (!hay.includes(searchQ)) continue;
        }

        const vehicle =
          instructor && (instructor.car_make || instructor.car_mode)
            ? [instructor.car_make, instructor.car_mode]
                .filter(Boolean)
                .join(" ")
            : null;

        const kam = s.instructor_id
          ? (kamByInstructor.get(s.instructor_id) ?? null)
          : null;

        rows.push({
          scheduleId: s.id,
          date: s.date,
          startTime: trimTime(s.start_time),
          endTime: trimTime(s.end_time),
          customerName: learner?.name ?? null,
          customerPhone: learner?.phone ?? null,
          classNumber,
          enrollmentType: s.learner_id
            ? (enrollmentTypeByLearner.get(s.learner_id) ?? null)
            : null,
          instructorId: s.instructor_id,
          instructorName: instructor?.name ?? null,
          instructorPhone: instructor?.phone ?? null,
          vehicle,
          kamId: kam?.id ?? null,
          kamName: kam?.name ?? null,
          status: s.status,
          isTentative: s.isTentative,
          pickupLocation: learner?.pick_up_location ?? null,
        });
      }

      return rows;
    },
  });
}

export function lessonsToCSV(rows: LessonRow[]): string {
  const headers = [
    "Date",
    "Start",
    "End",
    "Customer",
    "Customer Phone",
    "Class #",
    "Type",
    "Instructor",
    "Instructor Phone",
    "Vehicle",
    "KAM",
    "Status",
    "Pickup Location",
  ];
  const escape = (val: string | number | null | undefined) => {
    if (val == null) return "";
    const s = String(val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.startTime,
        r.endTime,
        r.customerName,
        r.customerPhone,
        r.classNumber,
        r.enrollmentType,
        r.instructorName,
        r.instructorPhone,
        r.vehicle,
        r.kamName,
        r.status,
        r.pickupLocation,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function defaultExportFilename(from: string, to: string): string {
  const safeFrom = from.replace(/\D/g, "");
  const safeTo = to.replace(/\D/g, "");
  return `lessons_${safeFrom}_${safeTo}.csv`;
}

// Helper for the page's KAM filter dropdown — reuses the existing KAM table.
export function useAllKAMsForFilter() {
  return useQuery({
    queryKey: ["kams", "filter-picker"],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase
        .from("KAM")
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    staleTime: 60_000,
  });
}

// Date preset helpers used by the page.
export function todayYmd(): string {
  return format(new Date(), "yyyy-MM-dd");
}
export function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return format(d, "yyyy-MM-dd");
}
export function plusDaysYmd(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return format(d, "yyyy-MM-dd");
}
