import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";

export type FeedbackCheckpoint = "mid" | "final";

export interface PendingFeedback {
  enrollmentId: string;
  learnerId: string;
  courseId: string | null;
  courseName: string | null;
  totalLessons: number;
  completedHours: number;
  checkpoint: FeedbackCheckpoint;
}

interface ScheduleRow {
  start_time: string | null;
  end_time: string | null;
  status: string | null;
}

const hoursOf = (s: ScheduleRow): number => {
  if (!s.start_time || !s.end_time) return 1;
  const sMin =
    parseInt(s.start_time.split(":")[0] || "0", 10) * 60 +
    parseInt(s.start_time.split(":")[1] || "0", 10);
  const eMin =
    parseInt(s.end_time.split(":")[0] || "0", 10) * 60 +
    parseInt(s.end_time.split(":")[1] || "0", 10);
  return Math.max(1, Math.round((eMin - sMin) / 60));
};

// Returns the list of feedback checkpoints the learner still owes us.
// A checkpoint is "due" once completed-hour count crosses its threshold:
//   - mid (only for total_lessons > 4): completed_hours >= ceil(total_lessons / 2)
//   - final (always): completed_hours >= total_lessons
// Already-submitted checkpoints are filtered out via learner_course_feedback.
export function useLearnerPendingFeedback(learnerId?: string) {
  return useQuery<PendingFeedback[]>({
    queryKey: ["learner-pending-feedback", learnerId],
    enabled: !!learnerId,
    queryFn: async () => {
      if (!learnerId) return [];

      // Accept both "active" and "pending" — admin-created enrollments stay
      // "pending" until the payment webhook flips them, but the learner can
      // already be doing lessons (admin manually marks completed). We only
      // want to skip cancelled / completed enrollments.
      const { data: enrollments, error: enrErr } = await supabase
        .from("enrollment")
        .select("id, course_id, learner_id, Courses(id, name, total_lessons)")
        .eq("learner_id", learnerId)
        .in("status", ["active", "pending"])
        .not("course_id", "is", null);

      if (enrErr) throw enrErr;
      if (!enrollments?.length) return [];

      const enrollmentIds = enrollments.map((e) => e.id);

      const { data: existing, error: fbErr } = await supabase
        .from("learner_course_feedback" as any)
        .select("enrollment_id, checkpoint")
        .in("enrollment_id", enrollmentIds);
      if (fbErr) throw fbErr;

      const submitted = new Set(
        ((existing as any[]) || []).map(
          (r) => `${r.enrollment_id}|${r.checkpoint}`,
        ),
      );

      const pending: PendingFeedback[] = [];

      await Promise.all(
        enrollments.map(async (e: any) => {
          const totalLessons = e.Courses?.total_lessons ?? 0;
          if (!totalLessons || !e.course_id) return;

          const { data: schedules, error: schErr } = await supabase
            .from("Schedule")
            .select("start_time, end_time, status")
            .eq("learner_id", learnerId)
            .eq("course_id", e.course_id)
            .eq("status", "completed");
          if (schErr) throw schErr;

          const completedHours = (schedules || []).reduce(
            (sum, s) => sum + hoursOf(s as ScheduleRow),
            0,
          );

          const midThreshold = Math.ceil(totalLessons / 2);
          const finalThreshold = totalLessons;

          if (
            totalLessons > 4 &&
            completedHours >= midThreshold &&
            !submitted.has(`${e.id}|mid`)
          ) {
            pending.push({
              enrollmentId: e.id,
              learnerId,
              courseId: e.course_id,
              courseName: e.Courses?.name ?? null,
              totalLessons,
              completedHours,
              checkpoint: "mid",
            });
          }

          if (
            completedHours >= finalThreshold &&
            !submitted.has(`${e.id}|final`)
          ) {
            pending.push({
              enrollmentId: e.id,
              learnerId,
              courseId: e.course_id,
              courseName: e.Courses?.name ?? null,
              totalLessons,
              completedHours,
              checkpoint: "final",
            });
          }
        }),
      );

      return pending;
    },
    refetchOnWindowFocus: true,
  });
}

export interface SubmitFeedbackPayload {
  enrollmentId: string;
  learnerId: string;
  checkpoint: FeedbackCheckpoint;
  overallRating: number;
  instructorRating: number;
  courseRating: number;
  comment: string;
}

export function useSubmitLearnerFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SubmitFeedbackPayload) => {
      const { data, error } = await supabase
        .from("learner_course_feedback" as any)
        .insert({
          enrollment_id: payload.enrollmentId,
          learner_id: payload.learnerId,
          checkpoint: payload.checkpoint,
          overall_rating: payload.overallRating,
          instructor_rating: payload.instructorRating,
          course_rating: payload.courseRating,
          comment: payload.comment || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["learner-pending-feedback", variables.learnerId],
      });
      queryClient.invalidateQueries({ queryKey: ["admin-learner-feedback"] });
    },
  });
}

export interface AdminFeedbackRow {
  id: string;
  enrollment_id: string;
  learner_id: string;
  checkpoint: FeedbackCheckpoint;
  overall_rating: number;
  instructor_rating: number;
  course_rating: number;
  comment: string | null;
  created_at: string;
  Learner: { id: string; name: string | null; phone: string | null } | null;
  enrollment: {
    id: string;
    course_id: string | null;
    Courses: {
      id: string;
      name: string | null;
      total_lessons: number | null;
    } | null;
  } | null;
}

const ADMIN_FEEDBACK_PAGE_SIZE = 20;

export function useAdminLearnerFeedbackList(
  search = "",
  checkpointFilter: "all" | FeedbackCheckpoint = "all",
) {
  return useInfiniteQuery({
    queryKey: ["admin-learner-feedback", "list", search, checkpointFilter],
    // Returning to an earlier search/filter must restart at the first batch.
    gcTime: 0,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const { data, count, error } = await supabase
        .rpc(
          "get_course_feedback",
          {
            search_term: search.trim().toLowerCase(),
            checkpoint_filter: checkpointFilter,
          },
          { count: "exact" },
        )
        .select(
          "*, Learner(id, name, phone), enrollment(id, course_id, Courses(id, name, total_lessons))",
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + ADMIN_FEEDBACK_PAGE_SIZE - 1)
        .abortSignal(signal)
        .returns<AdminFeedbackRow[]>();
      // Deletions between batches can move the offset past the final record.
      if (error?.code === "PGRST103") {
        return { rows: [], nextOffset: pageParam, hasMore: false };
      }
      if (error) throw error;
      const rows = data || [];
      const nextOffset = pageParam + rows.length;
      return {
        rows,
        nextOffset,
        hasMore:
          rows.length === ADMIN_FEEDBACK_PAGE_SIZE &&
          nextOffset < (count ?? Infinity),
      };
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextOffset : undefined,
  });
}

export interface AdminFeedbackStats {
  total: number;
  mid: number;
  final: number;
  avgOverall: number;
}

export function useAdminLearnerFeedbackStats() {
  return useQuery({
    queryKey: ["admin-learner-feedback", "stats"],
    queryFn: async ({ signal }): Promise<AdminFeedbackStats> => {
      const { data, error } = await supabase
        .rpc("get_course_feedback_stats")
        .abortSignal(signal);
      if (error) throw error;
      return data as unknown as AdminFeedbackStats;
    },
  });
}
