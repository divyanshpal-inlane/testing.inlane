import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useUser } from "@/context/auth-context";
import { supabase } from "@/lib/supabaseClient";
import { Database } from "@/types/database.types";
import { getAllPhoneFormats } from "@/utils/phoneNormalization";

export function useLearner() {
  const { phone } = useUser();
  return useQuery({
    queryKey: ["learner", phone],
    queryFn: async () => {
      if (!phone) throw new Error("phone is required");

      // Try all phone formats since auth context may return phone without +
      // e.g., auth returns "917368948038" but DB has "+917368948038"
      const phoneFormats = getAllPhoneFormats(phone);
      console.log(
        "[LEARNER] Trying phone formats to fetch learner:",
        phoneFormats,
      );

      for (const format of phoneFormats) {
        const { data: Learner, error } = await supabase
          .from("Learner")
          .select()
          .eq("phone", format)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.warn(
            "[LEARNER] Error with format",
            format,
            ":",
            error.message,
          );
          continue;
        }

        if (Learner) {
          console.log(
            "[LEARNER] ✅ Found learner with format:",
            format,
            "onboarding_completed:",
            Learner.onboarding_completed,
            "dob:",
            Learner.dob,
          );
          return Learner;
        }
      }

      console.log(
        "[LEARNER] No learner found with any phone format for:",
        phone,
      );
      return null;
    },
    staleTime: Infinity,
    enabled: !!phone,
  });
}

export function useLearnerId() {
  const queryClient = useQueryClient();
  const { phone } = useUser();

  const learnerData:
    | Database["public"]["Tables"]["Learner"]["Row"]
    | undefined = queryClient.getQueryData(["learner", phone]);

  if (!learnerData) {
    throw new Error("Learner data not found in cache");
  }

  return learnerData.id;
}

export function useSetLLTestDate() {
  const { phone } = useUser();
  return useMutation({
    mutationFn: async ({ LL_test_date }: { LL_test_date: Date }) => {
      const { data, error } = await supabase
        .from("Learner")
        .update({ LL_test_date: LL_test_date.toDateString() })
        .eq("phone", phone);
      if (error) throw new Error("Supabase error");
      return data;
    },
  });
}

export function useSetLLResult() {
  const { phone } = useUser();
  return useMutation({
    mutationFn: async ({
      LL_result,
    }: {
      LL_result: boolean | null | undefined;
    }) => {
      console.log("Phone:", phone);
      console.log("LL_result:", LL_result);

      const { error } = await supabase
        .from("Learner")
        .update({ LL_result: LL_result })
        .eq("phone", phone)
        .select();

      if (error) {
        console.error("Supabase error:", error);
        throw new Error("Supabase error");
      }
    },
  });
}

export function useUpcomingLesson() {
  const { phone } = useUser();
  const { data: learner } = useLearner();

  // show lessons from the last completed lessons, regardless of date
  return useQuery({
    queryKey: ["schedule", "upcomingLesson", phone, learner?.id],
    queryFn: async () => {
      if (!learner?.id) {
        return {
          upcomingSchedule: null,
          upcomingLesson: null,
          instructor: null,
          course: null,
        };
      }

      // First, fetch ALL schedules for this learner to calculate chronological position
      const { data: allSchedules, error: allError } = await supabase
        .from("Schedule")
        .select(
          `
          id,
          date,
          start_time,
          status,
          course_id
        `,
        )
        .eq("learner_id", learner.id)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });

      if (allError) {
        throw new Error(`Supabase error: ${allError.message}`);
      }

      // Now fetch non-completed schedules with full details
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          `
          *,
          Lesson (*),
          Instructor (
            id_instructor,
            name,
            phone,
            car_make,
            car_number
          ),
          Courses (*)
        `,
        )
        .eq("learner_id", learner.id)
        .neq("status", "completed")
        .neq("status", "paused")
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      if (!data || data.length === 0) {
        return {
          upcomingSchedule: null,
          upcomingLesson: null,
          instructor: null,
          course: null,
        };
      }

      const nextSchedule = data[0];

      // Calculate the chronological lesson number by finding this schedule's position
      // among ALL schedules for the same course, sorted by date/time
      let lessonNumber = 1;
      if (allSchedules) {
        // Filter to schedules for the same course (or null course for demo)
        const courseSchedules = allSchedules
          .filter((s) =>
            nextSchedule.course_id
              ? s.course_id === nextSchedule.course_id
              : s.course_id === null,
          )
          .sort((a, b) => {
            const dateTimeA = new Date(
              `${a.date}T${a.start_time || "00:00:00"}`,
            ).getTime();
            const dateTimeB = new Date(
              `${b.date}T${b.start_time || "00:00:00"}`,
            ).getTime();
            return dateTimeA - dateTimeB;
          });

        // Find the position of this schedule (1-indexed)
        const index = courseSchedules.findIndex(
          (s) => s.id === nextSchedule.id,
        );
        lessonNumber = index >= 0 ? index + 1 : 1;
      }

      // Calculate duration to determine if this covers multiple lessons
      const sMin =
        parseInt(nextSchedule.start_time?.split(":")[0] || "0") * 60 +
        parseInt(nextSchedule.start_time?.split(":")[1] || "0");
      const eMin =
        parseInt(nextSchedule.end_time?.split(":")[0] || "0") * 60 +
        parseInt(nextSchedule.end_time?.split(":")[1] || "0");
      const durHours = Math.max(1, Math.round((eMin - sMin) / 60));
      const endNumber = durHours > 1 ? lessonNumber + durHours - 1 : null;

      return {
        upcomingSchedule: nextSchedule,
        upcomingLesson: nextSchedule.Lesson
          ? {
              ...nextSchedule.Lesson,
              number: lessonNumber,
              endNumber,
            }
          : {
              id: null,
              number: lessonNumber,
              endNumber,
              description: "Demo Lesson",
            },
        instructor: nextSchedule.Instructor,
        course: nextSchedule.Courses,
      };
    },
    staleTime: 1000 * 60 * 30, // 30 minutes
    enabled: !!phone,
  });
}
type PartialLearner = Omit<
  Partial<Database["public"]["Tables"]["Learner"]["Row"]>,
  "phone"
>;

export function useLearnerUpdate() {
  const { phone } = useUser();
  const queryClient = useQueryClient();
  const mutate = useMutation({
    mutationFn: async (data: PartialLearner) => {
      if (!phone) throw new Error("Phone is required");

      // ── Try all phone formats to find and update the existing Learner record ──
      // The phone in auth context may differ in format from what's stored in the DB.
      // e.g., auth returns "917368948038" but DB has "+917368948038"
      const phoneFormats = getAllPhoneFormats(phone);
      console.log("[LEARNER_UPDATE] Trying phone formats:", phoneFormats);

      for (const format of phoneFormats) {
        const result = await supabase
          .from("Learner")
          .update(data)
          .eq("phone", format)
          .select();

        if (result.error) {
          console.warn(
            "[LEARNER_UPDATE] Error with format",
            format,
            ":",
            result.error.message,
          );
          continue;
        }

        if (result.data && result.data.length > 0) {
          console.log(
            "[LEARNER_UPDATE] ✅ Learner updated successfully with format:",
            format,
            result.data[0],
          );
          return result.data[0];
        }
      }

      // If no existing record found with any format, create one as fallback
      // This handles users who signed up before the trigger was in place
      console.warn(
        "[LEARNER_UPDATE] No existing record found. Creating new Learner record.",
      );
      const e164Phone = `+91${phone.replace(/\D/g, "").slice(-10)}`;
      const insertResult = await (supabase as any)
        .from("Learner")
        .insert({ ...data, phone: e164Phone })
        .select();

      if (insertResult.error) {
        // If insert fails due to unique constraint (already exists), try once more with correct format
        console.error(
          "[LEARNER_UPDATE] Insert failed:",
          insertResult.error.message,
        );
        throw new Error("Failed to update your profile. Please try again.");
      }

      console.log(
        "[LEARNER_UPDATE] ✅ Learner created as fallback:",
        insertResult.data?.[0],
      );
      return insertResult.data?.[0] ?? null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["learner", phone],
      });
    },
  });
  return mutate;
}

export function useUploadLLMutation() {
  const { phone } = useUser();
  return useMutation({
    mutationFn: async ({
      file,
      fileName = "ll",
    }: {
      file: File;
      fileName?: string;
    }) => {
      const { data, error } = await supabase.storage
        .from("LL")
        .upload(`${phone}/${fileName}.${file.type.split("/")[1]}`, file, {
          cacheControl: "3600",
          upsert: true,
        });
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useLessons({ courseId }: { courseId: string | undefined }) {
  return useQuery({
    queryKey: ["lessons", courseId],
    queryFn: courseId
      ? async () => {
          const { data, error } = await supabase
            .from("Lesson")
            .select("*")
            .eq("course_id", courseId)
            .order("number", { ascending: true });
          if (error) throw new Error(error.message);
          // Deduplicate lessons by number - keep only the first record per lesson number
          // This handles cases where duplicate lesson records exist for the same course
          const seen = new Set<number>();
          return (data ?? []).filter((lesson) => {
            if (seen.has(lesson.number)) return false;
            seen.add(lesson.number);
            return true;
          });
        }
      : skipToken,
  });
}

// TODO: fix this with lessonId
export function useLesson({
  id,
  refetchInterval = 0,
}: {
  id: string;
  refetchInterval?: number;
}) {
  return useQuery({
    queryKey: ["lesson", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Lesson")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    refetchInterval,
  });
}

export function useLessonSchedule({
  lessonId,
  refetchInterval = 0,
}: {
  lessonId: string | undefined;
  refetchInterval?: number;
}) {
  const { data: learner } = useLearner();
  return useQuery({
    queryKey: ["lessonSchedule", lessonId],
    queryFn:
      lessonId && learner?.id
        ? async () => {
            const { data, error } = await supabase
              .from("Schedule")
              .select("id, date, start_time, end_time, status")
              .eq("lesson_id", lessonId)
              .eq("learner_id", learner?.id)
              .single();
            if (error) throw error;
            return data;
          }
        : skipToken,
    refetchInterval,
    enabled: !!lessonId && !!learner?.id,
  });
}

export function useSchedule({
  lessonId,
  learnerId,
}: {
  lessonId: string;
  learnerId: string;
}) {
  return useQuery({
    queryKey: ["schedule", lessonId, learnerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          "id, date, start_time, end_time, Instructor (name, phone, car_make, car_number)",
        )
        .eq("lesson_id", lessonId)
        .eq("learner_id", learnerId)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: Infinity,
    enabled: !!learnerId,
  });
}

export type Schedule = {
  status: string;
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  lessonId: string | null;
  learnerId: string | null;
  lesson: {
    id: string;
    number: number | null;
    description: string | null;
  } | null;
};

export function useLearnerSchedule({
  learnerId,
  courseId,
  isDemo,
}: {
  learnerId?: string;
  courseId?: string;
  isDemo?: boolean;
}) {
  return useQuery<Schedule[]>({
    queryKey: ["schedule", learnerId, courseId, isDemo],
    queryFn: async () => {
      if (!learnerId) return [];
      // For demo enrollments, courseId is null — fetch schedules where course_id IS NULL
      if (isDemo) {
        const { data, error } = await supabase
          .from("Schedule")
          .select(
            "id, date, start_time, end_time, lesson_id, status, learner_id, started_at, ended_at, Lesson (id, number, description)",
          )
          .eq("learner_id", learnerId)
          .is("course_id", null)
          .order("date", { ascending: true })
          .order("start_time", { ascending: true });
        if (error) throw error;
        let demoCounter = 1;
        return (data || []).map((lesson) => {
          const sMin =
            parseInt(lesson.start_time?.split(":")[0] || "0") * 60 +
            parseInt(lesson.start_time?.split(":")[1] || "0");
          const eMin =
            parseInt(lesson.end_time?.split(":")[0] || "0") * 60 +
            parseInt(lesson.end_time?.split(":")[1] || "0");
          const dur = Math.max(1, Math.round((eMin - sMin) / 60));
          const start = demoCounter;
          demoCounter += dur;
          return {
            id: lesson.id,
            date: lesson.date,
            startTime: lesson.start_time,
            learnerId: lesson.learner_id,
            lessonId: lesson.lesson_id,
            endTime: lesson.end_time,
            lesson: {
              id: lesson.Lesson?.id ?? null,
              number: start,
              endNumber: dur > 1 ? start + dur - 1 : null,
              description: lesson.Lesson?.description ?? "Demo Lesson",
            },
            status: lesson.status,
            startedAt: lesson.started_at,
            endedAt: lesson.ended_at,
          };
        });
      }
      if (!courseId) return [];
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          "id, date, start_time, end_time, lesson_id, status, learner_id, started_at, ended_at, Lesson (id, number, description)",
        )
        .eq("learner_id", learnerId)
        .eq("course_id", courseId)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });

      if (error) throw error;

      // Sort schedules by date and time to ensure correct order
      const sortedData = [...data].sort((a, b) => {
        const dateTimeA = new Date(
          `${a.date}T${a.start_time || "00:00:00"}`,
        ).getTime();
        const dateTimeB = new Date(
          `${b.date}T${b.start_time || "00:00:00"}`,
        ).getTime();
        return dateTimeA - dateTimeB;
      });

      // Calculate lesson numbers based on chronological position
      // A 2hr class covers 2 lesson numbers
      let lessonCounter = 1;
      return sortedData.map((lesson) => {
        const startMin =
          parseInt(lesson.start_time?.split(":")[0] || "0") * 60 +
          parseInt(lesson.start_time?.split(":")[1] || "0");
        const endMin =
          parseInt(lesson.end_time?.split(":")[0] || "0") * 60 +
          parseInt(lesson.end_time?.split(":")[1] || "0");
        const durHours = Math.max(1, Math.round((endMin - startMin) / 60));
        const startLesson = lessonCounter;
        lessonCounter += durHours;

        return {
          id: lesson.id,
          date: lesson.date,
          startTime: lesson.start_time,
          learnerId: lesson.learner_id,
          lessonId: lesson.lesson_id,
          endTime: lesson.end_time,
          lesson: {
            id: lesson.Lesson?.id ?? null,
            number: startLesson,
            endNumber: durHours > 1 ? startLesson + durHours - 1 : null,
            description:
              lesson.Lesson?.description ??
              (lesson.lesson_id === null ? "Topup Lesson" : null),
          },
          status: lesson.status,
          startedAt: lesson.started_at,
          endedAt: lesson.ended_at,
        };
      });
    },
    staleTime: Infinity,
    enabled: !!learnerId,
  });
}
export function useUpdateScheduleStatus() {
  return useMutation({
    mutationFn: async ({
      scheduleId,
      status,
    }: {
      scheduleId: number;
      status: string;
    }) => {
      const { data, error } = await supabase
        .from("Schedule")
        .update({ status: status })
        .eq("id", scheduleId)
        .select();

      if (error) {
        console.error("Supabase error:", error);
        throw new Error("Failed to update schedule status");
      }

      return data;
    },
    onSuccess: () => {
      // Optionally, you can invalidate and refetch related queries here
      // queryClient.invalidateQueries(["schedule"]);
    },
  });
}

export function useLearnerEnrollmentCourse({
  learnerId,
}: {
  learnerId: string;
}) {
  return useQuery({
    queryKey: ["course", learnerId],
    queryFn: learnerId
      ? async () => {
          const { data, error } = await supabase
            .from("enrollment")
            .select("*, Courses(*)")
            .eq("learner_id", learnerId)
            .in("status", ["pending", "active"]);

          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}

export function useMutationRescheduleRequest() {
  return useMutation({
    mutationFn: async ({
      learnerId,
      totalFee = 0,
      lessonIds,
      paymentId = null,
      type = "reschedule",
    }: {
      learnerId: string;
      totalFee?: number;
      lessonIds: string[];
      paymentId?: string | null;
      type?: Database["public"]["Tables"]["reschedule_requests"]["Row"]["type"];
    }) => {
      const status = totalFee > 0 ? "pending_payment" : "pending";

      // A demo/custom/topup payment pre-creates the pending "new" request so
      // admin knows how many hours to book (there is no course_id to count
      // lessons from). The learner then finishes onboarding and lands here —
      // inserting a second one would show the same learner twice in admin's
      // New Schedules tab, so refresh the existing request instead.
      if (type === "new" && status === "pending") {
        const { data: existingRequest } = await supabase
          .from("reschedule_requests")
          .select("id")
          .eq("learner_id", learnerId)
          .eq("type", "new")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingRequest) {
          const { data: updatedRequest, error: updateError } = await supabase
            .from("reschedule_requests")
            .update({
              amount: totalFee,
              lesson_ids: lessonIds,
              payment_id: paymentId,
            })
            .eq("id", existingRequest.id)
            .select()
            .single();
          if (updateError) throw updateError;
          return updatedRequest;
        }
      }

      const { data: rescheduleRequest, error: rescheduleError } = await supabase
        .from("reschedule_requests")
        .insert({
          amount: totalFee,
          status,
          learner_id: learnerId,
          lesson_ids: lessonIds,
          payment_id: paymentId,
          type,
        })
        .select()
        .single();
      if (rescheduleError) throw rescheduleError;
      return rescheduleRequest;
    },
  });
}

export function useMutationCompleteRescheduleRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId }: { requestId: string }) => {
      const { data, error } = await supabase
        .from("reschedule_requests")
        .update({ status: "completed" })
        .eq("id", requestId)
        .select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["scheduling-requests"],
      });
    },
  });
}

export function useLearnerEnrollment({ learnerId }: { learnerId?: string }) {
  return useQuery({
    queryKey: ["enrollment", learnerId],
    queryFn: async () => {
      if (!learnerId) return null;
      const { data, error } = await supabase
        .from("enrollment")
        .select("*, Courses(*, Lesson(*))")
        .eq("learner_id", learnerId)
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!data || data.length === 0) return null;

      // Pick the enrollment that should drive the learner's experience.
      // A stray demo/topup enrollment must never shadow a real course
      // enrollment, so rank by intent (course > topup > demo) rather than
      // just recency. `data` is newest-first and Array.sort is stable, so
      // the most recent enrollment within the top tier wins.
      const rows = data;
      const tier = (e: (typeof rows)[number]) => {
        const t = (e.progress as { type?: string } | null)?.type;
        if (e.course_id || t === "course" || t === "custom") return 0;
        if (t === "topup") return 1;
        return 2;
      };
      return [...rows].sort((a, b) => tier(a) - tier(b))[0];
    },
    staleTime: 0, // Always refetch to get latest enrollment status
    enabled: !!learnerId,
  });
}

// ==================== ADMIN ISSUE FIXER QUERIES ====================

export const LEARNER_ISSUE_PAGE_SIZE = 15;

export type LearnerIssueFilter =
  | "all"
  | "has-issues"
  | "no-issues"
  | "enrollment"
  | "payment"
  | "schedule"
  | "learner";

type LearnerWithIssueData = Database["public"]["Tables"]["Learner"]["Row"] & {
  enrollment: (Database["public"]["Tables"]["enrollment"]["Row"] & {
    Courses: Database["public"]["Tables"]["Courses"]["Row"] | null;
  })[];
  payment: Database["public"]["Tables"]["payment"]["Row"][];
};

const LEARNER_ISSUE_SELECT = "*, enrollment (*, Courses(*)), payment (*)";

// Quote PostgREST values and escape regex syntax to preserve literal substring
// search, including commas, parentheses, quotes and wildcard characters.
function learnerIssueSearchFilter(searchQuery: string) {
  const pattern = JSON.stringify(
    searchQuery.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"),
  );
  return `name.imatch.${pattern},phone.match.${pattern},area.imatch.${pattern}`;
}

// Filter in the database before requesting exactly one page of learners.
export function useLearnersWithIssues({
  page = 1,
  searchQuery = "",
  issueFilter = "all",
}: {
  page?: number;
  searchQuery?: string;
  issueFilter?: LearnerIssueFilter;
} = {}) {
  const buildQuery = (head = false) => {
    if (issueFilter !== "all") {
      return supabase
        .rpc(
          "get_learners_with_issues",
          { search_term: searchQuery, issue_filter: issueFilter },
          { count: "exact", head },
        )
        .select(LEARNER_ISSUE_SELECT);
    }

    // Ordinary listing/search uses the existing table immediately, without
    // depending on deployment of the issue-filter RPC.
    let query = supabase
      .from("Learner")
      .select(LEARNER_ISSUE_SELECT, { count: "exact", head });
    if (searchQuery) query = query.or(learnerIssueSearchFilter(searchQuery));
    return query;
  };

  return useQuery({
    queryKey: ["learners-with-issues", "page", page, searchQuery, issueFilter],
    queryFn: async ({ signal }) => {
      const from = (page - 1) * LEARNER_ISSUE_PAGE_SIZE;
      const { data, count, error } = await buildQuery()
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .order("created_at", {
          referencedTable: "enrollment",
          ascending: false,
        })
        .order("id", { referencedTable: "enrollment", ascending: false })
        .order("created_at", { referencedTable: "payment", ascending: false })
        .order("id", { referencedTable: "payment", ascending: false })
        .range(from, from + LEARNER_ISSUE_PAGE_SIZE - 1)
        .abortSignal(signal)
        .returns<LearnerWithIssueData[]>();

      // PostgREST reports an out-of-range offset after a fix/deletion shrinks
      // the results. Fetch only the count so the page can move back in bounds.
      if (error?.code === "PGRST103" && from > 0) {
        const { count: remainingCount, error: countError } =
          await buildQuery(true).abortSignal(signal);
        if (countError) throw countError;
        return { learners: [], totalCount: remainingCount ?? 0 };
      }
      if (error?.code === "PGRST202") {
        throw new Error(
          "Issue filters require the learner issue fixer database migration " +
            "(20260917000000_learner_issue_fixer_pagination.sql). " +
            "Apply it in Supabase, or select All Learners to view learners.",
        );
      }
      if (error) throw error;
      return { learners: data || [], totalCount: count ?? 0 };
    },
    // Missing schema/permissions will not be fixed by retrying the same request.
    retry: (failureCount, error) => {
      const code = (error as { code?: string }).code;
      return !(error instanceof Error) && code !== "42501" && failureCount < 2;
    },
    // Keep background refresh with the query and stop polling after errors so
    // failed requests remain visible until the user retries or changes filters.
    refetchInterval: (query) =>
      query.state.status === "success" ? 5000 : false,
  });
}

// Keep the editor available even when its learner is outside the current page.
// The shared query-key prefix preserves all existing issue-fixer invalidations.
export function useLearnerWithIssuesAdmin(learnerId: string | null) {
  return useQuery({
    queryKey: ["learners-with-issues", "learner", learnerId],
    queryFn: async ({ signal }) => {
      if (!learnerId) return null;
      const { data, error } = await supabase
        .from("Learner")
        .select(LEARNER_ISSUE_SELECT)
        .eq("id", learnerId)
        .order("created_at", {
          referencedTable: "enrollment",
          ascending: false,
        })
        .order("id", { referencedTable: "enrollment", ascending: false })
        .order("created_at", { referencedTable: "payment", ascending: false })
        .order("id", { referencedTable: "payment", ascending: false })
        .abortSignal(signal)
        .returns<LearnerWithIssueData[]>()
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!learnerId,
    refetchInterval: (query) =>
      query.state.status === "success" ? 5000 : false,
  });
}

// Fetch schedules for a specific learner
export function useLearnerSchedulesAdmin({
  learnerId,
}: {
  learnerId?: string;
}) {
  return useQuery({
    queryKey: ["learner-schedules-admin", learnerId],
    queryFn: async () => {
      if (!learnerId) return [];
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          `
          *,
          Lesson (*),
          Instructor (id_instructor, name)
        `,
        )
        .eq("learner_id", learnerId)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });

      if (error) throw error;

      // Group schedules by course_id to calculate lesson numbers per course
      const schedulesByCourse: Record<string, typeof data> = {};
      (data || []).forEach((schedule) => {
        const courseId = schedule.course_id;
        if (!schedulesByCourse[courseId]) {
          schedulesByCourse[courseId] = [];
        }
        schedulesByCourse[courseId].push(schedule);
      });

      // Sort each group by date/time and create a map of schedule_id -> lesson_number
      const scheduleToLessonNumber: Record<string, number> = {};
      Object.values(schedulesByCourse).forEach((schedules) => {
        // Sort by date and time
        const sorted = [...schedules].sort((a, b) => {
          const dateTimeA = new Date(
            `${a.date}T${a.start_time || "00:00:00"}`,
          ).getTime();
          const dateTimeB = new Date(
            `${b.date}T${b.start_time || "00:00:00"}`,
          ).getTime();
          return dateTimeA - dateTimeB;
        });
        // Assign chronological lesson numbers (per course)
        sorted.forEach((schedule, index) => {
          scheduleToLessonNumber[schedule.id] = index + 1;
        });
      });

      // Sort all schedules by date and time for display, with updated lesson numbers
      const sortedData = [...(data || [])].sort((a, b) => {
        const dateTimeA = new Date(
          `${a.date}T${a.start_time || "00:00:00"}`,
        ).getTime();
        const dateTimeB = new Date(
          `${b.date}T${b.start_time || "00:00:00"}`,
        ).getTime();
        return dateTimeA - dateTimeB;
      });

      // Apply calculated lesson numbers per course
      return sortedData.map((schedule) => ({
        ...schedule,
        Lesson: schedule.Lesson
          ? {
              ...schedule.Lesson,
              number: scheduleToLessonNumber[schedule.id] || 1,
            }
          : null,
      }));
    },
    enabled: !!learnerId,
  });
}

// Update learner data (admin version)
export function useUpdateLearnerAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Database["public"]["Tables"]["Learner"]["Update"]>;
    }) => {
      const { data, error } = await supabase
        .from("Learner")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learners-with-issues"] });
    },
  });
}

// Update enrollment data
export function useUpdateEnrollmentAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Database["public"]["Tables"]["enrollment"]["Update"]>;
    }) => {
      const { data, error } = await supabase
        .from("enrollment")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learners-with-issues"] });
    },
  });
}

// Create enrollment
export function useCreateEnrollmentAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      enrollment: Database["public"]["Tables"]["enrollment"]["Insert"],
    ) => {
      const { data, error } = await supabase
        .from("enrollment")
        .insert(enrollment)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learners-with-issues"] });
    },
  });
}

// Update payment data
export function useUpdatePaymentAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Database["public"]["Tables"]["payment"]["Update"]>;
    }) => {
      const { data, error } = await supabase
        .from("payment")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learners-with-issues"] });
    },
  });
}

// Create payment
export function useCreatePaymentAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      payment: Database["public"]["Tables"]["payment"]["Insert"],
    ) => {
      const { data, error } = await supabase
        .from("payment")
        .insert(payment)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learners-with-issues"] });
    },
  });
}

// Bulk delete all learner data (schedules, enrollments, payments, learner)
// Order matters due to foreign key constraints:
// - Schedules reference learner_id
// - Enrollments reference payment_id (so enrollments must be deleted before payments)
// - Reschedule_requests reference payment_id (so reschedule_requests must be deleted before payments)
// - Payments reference learner_id
// - Learner is deleted last
export function useDeleteLearnerAllData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      learnerId,
      counts,
    }: {
      learnerId: string;
      counts: { schedules: number; enrollments: number; payments: number };
    }) => {
      // 1. Delete all schedules for this learner
      const { error: scheduleError } = await supabase
        .from("Schedule")
        .delete()
        .eq("learner_id", learnerId);

      if (scheduleError)
        throw new Error(`Failed to delete schedules: ${scheduleError.message}`);

      // 2. Delete all enrollments for this learner (must be before payments due to FK)
      const { error: enrollmentError } = await supabase
        .from("enrollment")
        .delete()
        .eq("learner_id", learnerId);

      if (enrollmentError)
        throw new Error(
          `Failed to delete enrollments: ${enrollmentError.message}`,
        );

      // 3. Delete all reschedule_requests for this learner (must be before payments due to FK)
      const { error: rescheduleError } = await supabase
        .from("reschedule_requests")
        .delete()
        .eq("learner_id", learnerId);

      if (rescheduleError)
        throw new Error(
          `Failed to delete reschedule requests: ${rescheduleError.message}`,
        );

      // 4. Delete all payments for this learner (after enrollments and reschedule_requests)
      const { error: paymentError } = await supabase
        .from("payment")
        .delete()
        .eq("learner_id", learnerId);

      if (paymentError)
        throw new Error(`Failed to delete payments: ${paymentError.message}`);

      // 5. Delete the learner record
      const { error: learnerError } = await supabase
        .from("Learner")
        .delete()
        .eq("id", learnerId);

      if (learnerError)
        throw new Error(`Failed to delete learner: ${learnerError.message}`);

      // Return the counts that were passed in (we know them from the UI)
      return {
        schedules: counts.schedules,
        enrollments: counts.enrollments,
        payments: counts.payments,
        learner: true,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learners-with-issues"] });
      queryClient.invalidateQueries({ queryKey: ["learner-schedules-admin"] });
    },
  });
}

// ============================================================================
// Enrollment plan-edit audit log (PRD-ADMIN-004 §5.4)
// Append-only history of payment-plan edits. Table created in
// 20260630_add_enrollment_plan_audit.sql. Not yet in the generated
// database.types.ts, so the supabase client is cast for these two calls only —
// regenerate types with `supabase gen types` to drop the casts.
// ============================================================================

export interface EnrollmentPlanAuditChange {
  field: string;
  label: string;
  old: string | number | null;
  new: string | number | null;
}

export interface EnrollmentPlanAuditRow {
  id: string;
  enrollment_id: string | null;
  learner_id: string | null;
  editor_id: string | null;
  editor_name: string | null;
  reason: string | null;
  changes: EnrollmentPlanAuditChange[];
  created_at: string;
}

// Read the edit history for one enrollment, newest first.
export function useEnrollmentPlanAudit(enrollmentId?: string) {
  return useQuery({
    queryKey: ["enrollment-plan-audit", enrollmentId],
    queryFn: async () => {
      if (!enrollmentId) return [] as EnrollmentPlanAuditRow[];
      const { data, error } = await (supabase as any)
        .from("enrollment_plan_audit")
        .select("*")
        .eq("enrollment_id", enrollmentId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as EnrollmentPlanAuditRow[];
    },
    enabled: !!enrollmentId,
  });
}

// Append one audit row for a plan edit.
export function useCreateEnrollmentPlanAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entry: {
      enrollment_id: string;
      learner_id: string;
      editor_id?: string | null;
      editor_name?: string | null;
      reason?: string | null;
      changes: EnrollmentPlanAuditChange[];
    }) => {
      const { data, error } = await (supabase as any)
        .from("enrollment_plan_audit")
        .insert(entry)
        .select()
        .single();

      if (error) throw error;
      return data as EnrollmentPlanAuditRow;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["enrollment-plan-audit", variables.enrollment_id],
      });
    },
  });
}
