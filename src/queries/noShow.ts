import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";

import { supabase } from "@/lib/supabaseClient";

export type NoShowParty = "learner" | "instructor";
export type NoShowStatus = "open" | "resolved" | "dismissed";

export interface NoShowCase {
  id: string;
  schedule_id: number;
  no_show_party: NoShowParty;
  reported_by: string;
  reporter_instructor_id: string | null;
  note: string | null;
  status: NoShowStatus;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string | null;
  // enriched from Schedule
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  learnerName: string | null;
  learnerPhone: string | null;
  instructorName: string | null;
  lessonNumber: number | null;
}

export interface InstructorLesson {
  scheduleId: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string | null;
  learnerName: string | null;
  learnerPhone: string | null;
  lessonNumber: number | null;
  alreadyReported: boolean;
}

export interface PotentialInstructorNoShow {
  scheduleId: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  instructorId: string | null;
  instructorName: string | null;
  learnerName: string | null;
  lessonNumber: number | null;
}

const first = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const today = () => format(new Date(), "yyyy-MM-dd");

// ---------------------------------------------------------------------------
// Instructor-facing
// ---------------------------------------------------------------------------

// Recent lessons (last 14 days incl. today) the instructor can flag a learner
// no-show against. `alreadyReported` disables ones already reported.
export function useInstructorRecentLessons(instructorId: string | undefined) {
  return useQuery({
    queryKey: ["instructor_recent_lessons", instructorId],
    enabled: !!instructorId,
    queryFn: async (): Promise<InstructorLesson[]> => {
      const from = format(subDays(new Date(), 14), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          "id, date, start_time, end_time, status, Learner(name, phone), Lesson(number)",
        )
        .eq("instructor_id", instructorId!)
        .gte("date", from)
        .lte("date", today())
        .order("date", { ascending: false });
      if (error) throw error;
      const rows = data ?? [];

      const ids = rows.map((r) => r.id);
      const reported = new Set<number>();
      if (ids.length) {
        const { data: ns } = await supabase
          .from("schedule_no_show")
          .select("schedule_id")
          .eq("no_show_party", "learner")
          .in("schedule_id", ids);
        for (const n of ns ?? []) reported.add(n.schedule_id);
      }

      return rows.map((s) => {
        const learner = first<{ name: string | null; phone: string | null }>(
          s.Learner as never,
        );
        const lesson = first<{ number: number | null }>(s.Lesson as never);
        return {
          scheduleId: s.id,
          date: s.date,
          startTime: s.start_time,
          endTime: s.end_time,
          status: s.status,
          learnerName: learner?.name ?? null,
          learnerPhone: learner?.phone ?? null,
          lessonNumber: lesson?.number ?? null,
          alreadyReported: reported.has(s.id),
        };
      });
    },
  });
}

export function useReportLearnerNoShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scheduleId: number;
      reporterInstructorId: string;
      note?: string | null;
    }) => {
      const { error } = await supabase.from("schedule_no_show").insert({
        schedule_id: input.scheduleId,
        no_show_party: "learner",
        reported_by: "instructor",
        reporter_instructor_id: input.reporterInstructorId,
        note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instructor_recent_lessons"] });
      qc.invalidateQueries({ queryKey: ["no_show_cases"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Admin-facing
// ---------------------------------------------------------------------------

// Enrich raw no-show rows with their Schedule / Learner / Instructor details.
async function enrichNoShows(
  rows: Array<Omit<NoShowCase, keyof EnrichedFields> & Partial<EnrichedFields>>,
): Promise<NoShowCase[]> {
  const scheduleIds = Array.from(new Set(rows.map((r) => r.schedule_id)));
  const byId = new Map<number, EnrichedFields>();
  if (scheduleIds.length) {
    const { data: scheds } = await supabase
      .from("Schedule")
      .select(
        "id, date, start_time, end_time, Learner(name, phone), Instructor(name), Lesson(number)",
      )
      .in("id", scheduleIds);
    for (const s of scheds ?? []) {
      const learner = first<{ name: string | null; phone: string | null }>(
        s.Learner as never,
      );
      const instr = first<{ name: string | null }>(s.Instructor as never);
      const lesson = first<{ number: number | null }>(s.Lesson as never);
      byId.set(s.id, {
        date: s.date,
        startTime: s.start_time,
        endTime: s.end_time,
        learnerName: learner?.name ?? null,
        learnerPhone: learner?.phone ?? null,
        instructorName: instr?.name ?? null,
        lessonNumber: lesson?.number ?? null,
      });
    }
  }
  return rows.map((r) => ({
    ...(r as NoShowCase),
    ...(byId.get(r.schedule_id) ?? {
      date: null,
      startTime: null,
      endTime: null,
      learnerName: null,
      learnerPhone: null,
      instructorName: null,
      lessonNumber: null,
    }),
  }));
}

type EnrichedFields = {
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  learnerName: string | null;
  learnerPhone: string | null;
  instructorName: string | null;
  lessonNumber: number | null;
};

export function useNoShowCases(filters?: {
  status?: NoShowStatus;
  party?: NoShowParty;
}) {
  return useQuery({
    queryKey: [
      "no_show_cases",
      filters?.status ?? "any",
      filters?.party ?? "any",
    ],
    queryFn: async (): Promise<NoShowCase[]> => {
      let q = supabase
        .from("schedule_no_show")
        .select("*")
        .order("created_at", { ascending: false });
      if (filters?.status) q = q.eq("status", filters.status);
      if (filters?.party) q = q.eq("no_show_party", filters.party);
      const { data, error } = await q;
      if (error) throw error;
      return enrichNoShows((data ?? []) as never);
    },
  });
}

// Past 'booked' lessons that never started (no OTP) — likely instructor
// no-shows the admin can confirm. Derived, not persisted.
export function usePotentialInstructorNoShows() {
  return useQuery({
    queryKey: ["potential_instructor_no_shows"],
    queryFn: async (): Promise<PotentialInstructorNoShow[]> => {
      const from = format(subDays(new Date(), 30), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          "id, date, start_time, end_time, instructor_id, started_at, status, Instructor(name), Learner(name), Lesson(number)",
        )
        .eq("status", "booked")
        .is("started_at", null)
        .gte("date", from)
        .lt("date", today())
        .order("date", { ascending: false });
      if (error) throw error;
      const rows = data ?? [];

      // Exclude ones already flagged as an instructor no-show.
      const ids = rows.map((r) => r.id);
      const flagged = new Set<number>();
      if (ids.length) {
        const { data: ns } = await supabase
          .from("schedule_no_show")
          .select("schedule_id")
          .eq("no_show_party", "instructor")
          .in("schedule_id", ids);
        for (const n of ns ?? []) flagged.add(n.schedule_id);
      }

      return rows
        .filter((r) => !flagged.has(r.id))
        .map((s) => {
          const instr = first<{ name: string | null }>(s.Instructor as never);
          const learner = first<{ name: string | null }>(s.Learner as never);
          const lesson = first<{ number: number | null }>(s.Lesson as never);
          return {
            scheduleId: s.id,
            date: s.date,
            startTime: s.start_time,
            endTime: s.end_time,
            instructorId: s.instructor_id,
            instructorName: instr?.name ?? null,
            learnerName: learner?.name ?? null,
            lessonNumber: lesson?.number ?? null,
          };
        });
    },
  });
}

export function useResolveNoShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: "resolved" | "dismissed";
      resolution?: string;
      resolverName?: string;
    }) => {
      const { error } = await supabase
        .from("schedule_no_show")
        .update({
          status: input.status,
          resolution: input.resolution ?? null,
          resolved_by: input.resolverName ?? null,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["no_show_cases"] }),
  });
}

export function useFlagInstructorNoShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scheduleId: number; note?: string }) => {
      const { error } = await supabase.from("schedule_no_show").insert({
        schedule_id: input.scheduleId,
        no_show_party: "instructor",
        reported_by: "admin",
        note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["no_show_cases"] });
      qc.invalidateQueries({ queryKey: ["potential_instructor_no_shows"] });
    },
  });
}
