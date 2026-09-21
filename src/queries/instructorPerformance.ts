import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/lib/supabaseClient";

// Per-instructor performance metrics computed over a date window from data we
// already record: Schedule (attendance / punctuality / completion via OTP
// started_at), learner_course_feedback (ratings) and schedule_no_show +
// safety misconduct-free complaints (instructor no-shows count as complaints).

export interface InstructorPerformanceRow {
  instructorId: string;
  name: string | null;
  phone: string | null;
  enabled: boolean | null;
  /** past, non-cancelled sessions in the window */
  sessions: number;
  /** % of past sessions that actually happened (OTP-started or completed) */
  attendanceRate: number | null;
  /** % of started sessions that began within the grace period */
  punctualityRate: number | null;
  /** avg learner "instructor_rating" attributed to this instructor */
  avgRating: number | null;
  ratingCount: number;
  /** confirmed instructor no-show cases in the window */
  complaints: number;
  /** complaints per past session, % */
  complaintRate: number | null;
  /** % of past sessions marked completed */
  completionRate: number | null;
}

// A lesson counts as on-time if OTP-started within 10 min of its slot start.
const PUNCTUALITY_GRACE_MIN = 10;

const isCancelled = (status: string | null) =>
  !!status && status.toLowerCase().includes("cancel");

const pct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 100) : null;

export function useInstructorPerformance(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ["instructor_performance", fromDate, toDate],
    enabled: !!fromDate && !!toDate && fromDate <= toDate,
    queryFn: async (): Promise<InstructorPerformanceRow[]> => {
      const [instrRes, schedRes, feedbackRes, noShowRes] = await Promise.all([
        supabase
          .from("Instructor")
          .select("id_instructor, name, phone, enabled"),
        supabase
          .from("Schedule")
          .select(
            "id, instructor_id, learner_id, date, start_time, status, started_at",
          )
          .gte("date", fromDate)
          .lte("date", toDate),
        supabase
          .from("learner_course_feedback" as never)
          .select("learner_id, instructor_rating, created_at")
          .gte("created_at", `${fromDate}T00:00:00`)
          .lte("created_at", `${toDate}T23:59:59`),
        supabase
          .from("schedule_no_show")
          .select("schedule_id, no_show_party, status")
          .eq("no_show_party", "instructor")
          .gte("created_at", `${fromDate}T00:00:00`)
          .lte("created_at", `${toDate}T23:59:59`),
      ]);
      if (instrRes.error) throw instrRes.error;
      if (schedRes.error) throw schedRes.error;

      const instructors = instrRes.data ?? [];
      const schedules = schedRes.data ?? [];
      const feedback = (feedbackRes.data ?? []) as unknown as Array<{
        learner_id: string | null;
        instructor_rating: number | null;
      }>;
      const noShows = (noShowRes.data ?? []).filter(
        (n) => n.status !== "dismissed",
      );

      const today = format(new Date(), "yyyy-MM-dd");
      const now = new Date();

      // Map each no-show back to its instructor via the schedule. Cases whose
      // schedule predates the window need a top-up fetch.
      const instructorBySchedule = new Map<number, string | null>(
        schedules.map((s) => [s.id, s.instructor_id]),
      );
      const missingIds = noShows
        .map((n) => n.schedule_id)
        .filter((id) => !instructorBySchedule.has(id));
      if (missingIds.length) {
        const { data: extra } = await supabase
          .from("Schedule")
          .select("id, instructor_id")
          .in("id", missingIds);
        for (const s of extra ?? [])
          instructorBySchedule.set(s.id, s.instructor_id);
      }

      // Attribute each learner's feedback to the instructor who taught them
      // most in this window (the feedback table doesn't store instructor_id).
      const lessonCount = new Map<string, Map<string, number>>();
      for (const s of schedules) {
        if (!s.learner_id || !s.instructor_id || isCancelled(s.status))
          continue;
        if (!lessonCount.has(s.learner_id))
          lessonCount.set(s.learner_id, new Map());
        const m = lessonCount.get(s.learner_id)!;
        m.set(s.instructor_id, (m.get(s.instructor_id) ?? 0) + 1);
      }
      const dominantInstructor = new Map<string, string>();
      for (const [learnerId, counts] of lessonCount) {
        let best: string | null = null;
        let bestN = 0;
        for (const [instrId, n] of counts)
          if (n > bestN) {
            best = instrId;
            bestN = n;
          }
        if (best) dominantInstructor.set(learnerId, best);
      }

      type Acc = {
        past: number;
        attended: number;
        started: number;
        onTime: number;
        completed: number;
        ratings: number[];
        complaints: number;
      };
      const acc = new Map<string, Acc>();
      const get = (id: string): Acc => {
        if (!acc.has(id))
          acc.set(id, {
            past: 0,
            attended: 0,
            started: 0,
            onTime: 0,
            completed: 0,
            ratings: [],
            complaints: 0,
          });
        return acc.get(id)!;
      };

      for (const s of schedules) {
        if (!s.instructor_id || isCancelled(s.status)) continue;
        // Only sessions whose slot has passed count toward the rates.
        const slotStart = s.start_time
          ? new Date(`${s.date}T${s.start_time}`)
          : null;
        const isPast = s.date < today || (slotStart != null && slotStart < now);
        if (!isPast) continue;
        const a = get(s.instructor_id);
        a.past += 1;
        const happened = s.started_at != null || s.status === "completed";
        if (happened) a.attended += 1;
        if (s.status === "completed") a.completed += 1;
        if (s.started_at && slotStart) {
          a.started += 1;
          const lateMin =
            (new Date(s.started_at).getTime() - slotStart.getTime()) / 60_000;
          if (lateMin <= PUNCTUALITY_GRACE_MIN) a.onTime += 1;
        }
      }

      for (const f of feedback) {
        if (!f.learner_id || f.instructor_rating == null) continue;
        const instrId = dominantInstructor.get(f.learner_id);
        if (instrId) get(instrId).ratings.push(f.instructor_rating);
      }

      for (const n of noShows) {
        const instrId = instructorBySchedule.get(n.schedule_id);
        if (instrId) get(instrId).complaints += 1;
      }

      return instructors
        .map((i): InstructorPerformanceRow => {
          const a = acc.get(i.id_instructor);
          const ratings = a?.ratings ?? [];
          return {
            instructorId: i.id_instructor,
            name: i.name,
            phone: i.phone,
            enabled: i.enabled,
            sessions: a?.past ?? 0,
            attendanceRate: a ? pct(a.attended, a.past) : null,
            punctualityRate: a ? pct(a.onTime, a.started) : null,
            avgRating: ratings.length
              ? Math.round(
                  (ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10,
                ) / 10
              : null,
            ratingCount: ratings.length,
            complaints: a?.complaints ?? 0,
            complaintRate: a ? pct(a.complaints, a.past) : null,
            completionRate: a ? pct(a.completed, a.past) : null,
          };
        })
        .sort((x, y) => y.sessions - x.sessions);
    },
  });
}
