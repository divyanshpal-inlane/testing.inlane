import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";
import { Database } from "@/types/database.types";
import { TimeSlot } from "@/types/schedule";

export function useSchedulePreferences(learnerId?: string) {
  return useQuery({
    queryKey: ["schedulePreferences", learnerId],
    queryFn: async () => {
      if (!learnerId) return [];

      const { data, error } = await supabase
        .from("schedule_preferences")
        .select("*")
        .eq("learner_id", learnerId);

      if (error) throw error;

      return data;
    },
    enabled: !!learnerId,
  });
}

export function useUpdatePreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      learnerId,
      preferences,
    }: {
      learnerId: string;
      preferences: {
        day: number;
        timeSlot: TimeSlot;
      }[];
    }) => {
      // First delete existing preferences
      const { error: deleteError } = await supabase
        .from("schedule_preferences")
        .delete()
        .eq("learner_id", learnerId);

      if (deleteError) throw deleteError;

      // Transform preferences to match the database schema
      const dbPreferences = preferences.map((pref) => ({
        learner_id: learnerId,
        day_of_week: pref.day,
        time_slot: pref.timeSlot,
      }));

      // Then insert new preferences
      const { data, error } = await supabase
        .from("schedule_preferences")
        .insert(dbPreferences);

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["schedulePreferences", variables.learnerId],
      });
    },
  });
}

export function useSchedulingRequests() {
  return useQuery({
    queryKey: ["scheduling-requests"],
    queryFn: async () => {
      // Get learners who need scheduling - only fetch needed columns
      const { data: learners, error: learnersError } = await supabase
        .from("reschedule_requests")
        .select(
          `id, learner_id, type, status, lesson_ids, amount, created_at,
          Learner(id, name, phone, email, area, pick_up_location, address_lat, address_lng,
            preferred_start_date, preferred_completion_days, prefers_two_hour_classes,
            two_hour_days, DL_test_date, pincode, signed_up, created_at)`,
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (learnersError) throw learnersError;
      if (!learners) return [];

      // Filter out learners who already have schedules created
      // This prevents already-scheduled learners from appearing in the "New Schedules" tab
      // BUT: Do NOT filter out reschedule/lesson10 requests - those are for learners who already have schedules!
      if (learners.length === 0) return [];

      const learnerIds = learners
        .map((r) => r.learner_id)
        .filter((id): id is string => !!id);

      if (learnerIds.length === 0) return [];

      // Check which learners already have schedules
      const { data: existingSchedules, error: scheduleError } = await supabase
        .from("Schedule")
        .select("learner_id, created_at")
        .in("learner_id", learnerIds)
        .neq("status", "paused"); // Exclude paused schedules

      if (scheduleError) {
        console.error("Error checking existing schedules:", scheduleError);
        // If query fails, return all pending requests to be safe
        return learners;
      }

      // Group each learner's non-paused schedule creation times so we can tell
      // whether a "new" request has effectively already been fulfilled.
      const scheduleTimesByLearner = new Map<string, number[]>();
      for (const s of existingSchedules || []) {
        if (!s.learner_id || !s.created_at) continue;
        const createdAt = new Date(s.created_at).getTime();
        const list = scheduleTimesByLearner.get(s.learner_id);
        if (list) list.push(createdAt);
        else scheduleTimesByLearner.set(s.learner_id, [createdAt]);
      }

      // How far before a request we still treat a schedule as "fulfilling" it.
      // Covers the common race where admin books the schedule slightly before
      // the payment webhook/callback inserts the (now-stale) scheduling request.
      const FULFILL_BACKDATE_MS = 24 * 60 * 60 * 1000;

      // Filter out learners who have already been scheduled, BUT keep reschedule
      // and lesson10 requests (those are specifically for already-scheduled
      // learners who want to change an existing lesson).
      const filteredLearners = learners.filter((request) => {
        const isRescheduleOrLesson10 =
          request.type === "reschedule" || request.type === "lesson10";
        if (isRescheduleOrLesson10) return true;

        const scheduleTimes =
          scheduleTimesByLearner.get(request.learner_id) ?? [];

        // No non-paused schedules at all → the learner genuinely needs one.
        if (scheduleTimes.length === 0) return true;
        if (!request.created_at) return false;

        // A "new" request asks for lesson_ids.length lessons. If the learner
        // already has at least that many non-paused schedules created around or
        // after the request, those schedules fulfill it and the request is a
        // stale leftover (duplicate insert, or a schedule booked outside the
        // New Schedules tab that never completed the request).
        //
        // We count only schedules created on/after (request - 1 day), NOT all
        // of them: a learner who finished a course weeks ago and just bought a
        // top-up has many OLD completed schedules but still legitimately needs
        // the top-up scheduled, so those old rows must not hide the request.
        // Likewise a single completed demo (1 schedule) can't fulfill a
        // 10-lesson course request.
        const reqAt = new Date(request.created_at).getTime();
        const windowStart = reqAt - FULFILL_BACKDATE_MS;
        const fulfillingCount = scheduleTimes.filter(
          (t) => t >= windowStart,
        ).length;
        const lessonsNeeded = Array.isArray(request.lesson_ids)
          ? request.lesson_ids.length
          : 1;

        // Show only while the learner does NOT yet have enough recent schedules
        // to cover the request.
        return fulfillingCount < Math.max(1, lessonsNeeded);
      });

      return filteredLearners;
    },
    staleTime: 30 * 1000,
  });
}

// Infinite scroll version of useSchedulingRequests
// Fetches requests in batches of 25 for incremental loading
export function useInfiniteSchedulingRequests() {
  return useInfiniteQuery({
    queryKey: ["scheduling-requests-infinite"],
    queryFn: async ({ pageParam = 0 }) => {
      const BATCH_SIZE = 25;
      const from = pageParam;
      const to = from + BATCH_SIZE - 1;

      // Get learners who need scheduling - fetch in batches
      const { data: learners, error: learnersError } = await supabase
        .from("reschedule_requests")
        .select(
          `id, learner_id, type, status, lesson_ids, amount, created_at,
          Learner(id, name, phone, email, area, pick_up_location, address_lat, address_lng,
            preferred_start_date, preferred_completion_days, prefers_two_hour_classes,
            two_hour_days, DL_test_date, pincode, signed_up, created_at)`,
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (learnersError) throw learnersError;

      // Track raw fetched count to determine if there are more pages
      const rawFetchedCount = learners?.length ?? 0;

      if (!learners || learners.length === 0) {
        return { data: [], hasMoreInDb: false };
      }

      // Apply the same schedule-checking logic as the original query
      const learnerIds = learners
        .map((r) => r.learner_id)
        .filter((id): id is string => !!id);

      if (learnerIds.length === 0) {
        return { data: [], hasMoreInDb: rawFetchedCount >= BATCH_SIZE };
      }

      // Check which learners already have schedules
      const { data: existingSchedules, error: scheduleError } = await supabase
        .from("Schedule")
        .select("learner_id, created_at")
        .in("learner_id", learnerIds)
        .neq("status", "paused");

      if (scheduleError) {
        console.error("Error checking existing schedules:", scheduleError);
        return { data: learners, hasMoreInDb: rawFetchedCount >= BATCH_SIZE };
      }

      // Group each learner's non-paused schedule creation times
      const scheduleTimesByLearner = new Map<string, number[]>();
      for (const s of existingSchedules || []) {
        if (!s.learner_id || !s.created_at) continue;
        const createdAt = new Date(s.created_at).getTime();
        const list = scheduleTimesByLearner.get(s.learner_id);
        if (list) list.push(createdAt);
        else scheduleTimesByLearner.set(s.learner_id, [createdAt]);
      }

      const FULFILL_BACKDATE_MS = 24 * 60 * 60 * 1000;

      // Filter out learners who have already been scheduled
      const filteredLearners = learners.filter((request) => {
        const isRescheduleOrLesson10 =
          request.type === "reschedule" || request.type === "lesson10";
        if (isRescheduleOrLesson10) return true;

        const scheduleTimes =
          scheduleTimesByLearner.get(request.learner_id) ?? [];

        if (scheduleTimes.length === 0) return true;
        if (!request.created_at) return false;

        const reqAt = new Date(request.created_at).getTime();
        const windowStart = reqAt - FULFILL_BACKDATE_MS;
        const fulfillingCount = scheduleTimes.filter(
          (t) => t >= windowStart,
        ).length;
        const lessonsNeeded = Array.isArray(request.lesson_ids)
          ? request.lesson_ids.length
          : 1;

        return fulfillingCount < Math.max(1, lessonsNeeded);
      });

      // Return both the filtered data and whether there are more records in the DB
      // We determine hasMoreInDb based on the RAW fetched count, not filtered count
      return {
        data: filteredLearners,
        hasMoreInDb: rawFetchedCount >= BATCH_SIZE,
      };
    },
    getNextPageParam: (lastPage, allPages) => {
      const BATCH_SIZE = 25;
      // Check hasMoreInDb flag based on RAW database count, not filtered results
      // This ensures we keep fetching even when many records are filtered out
      if (!lastPage || !lastPage.hasMoreInDb) return undefined;
      // Next offset is number of pages * batch size
      return allPages.length * BATCH_SIZE;
    },
    initialPageParam: 0,
    staleTime: 30 * 1000,
  });
}

// Fetches latest enrollment.progress.type per learner so the admin queue can
// sub-categorize "new" scheduling requests into course / demo / topup.
export function useEnrollmentTypesByLearner(learnerIds: string[]) {
  return useQuery({
    queryKey: ["enrollment-types-by-learner", [...learnerIds].sort()],
    enabled: learnerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrollment")
        .select("learner_id, course_id, progress, created_at")
        .in("learner_id", learnerIds)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const latestByLearner = new Map<
        string,
        { type: string | null; hours: number | null }
      >();
      for (const e of data || []) {
        if (latestByLearner.has(e.learner_id)) continue;
        const progress = e.progress as
          | { type?: string; total_hours?: number }
          | null
          | undefined;
        latestByLearner.set(e.learner_id, {
          type: progress?.type ?? (e.course_id ? "course" : null),
          hours: progress?.total_hours ?? null,
        });
      }
      return latestByLearner;
    },
    staleTime: 30 * 1000,
  });
}

export function useLearnerSchedulePreferences(learnerId: string | undefined) {
  return useQuery({
    queryKey: ["learnerSchedulePreferences", learnerId],
    queryFn: learnerId
      ? async () => {
          const { data, error } = await supabase
            .from("schedule_preferences")
            .select("*")
            .eq("learner_id", learnerId);

          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}

export function useLearnerRescheduleRequests(learnerId: string | undefined) {
  return useQuery({
    queryKey: ["learnerRescheduleRequests", learnerId],
    queryFn: learnerId
      ? async () => {
          const { data, error } = await supabase
            .from("reschedule_requests")
            .select("*")
            .eq("learner_id", learnerId)
            .eq("status", "pending");

          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}

export type SchedulingRequests = Exclude<
  Awaited<ReturnType<typeof useSchedulingRequests>>["data"],
  null | undefined
>;

type Preference = Database["public"]["Tables"]["schedule_preferences"]["Row"];

export function usePreferences(learnerId: string) {
  return useQuery({
    queryKey: ["preferences", learnerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_preferences")
        .select("*")
        .eq("learner_id", learnerId);

      if (error) throw error;
      return data as Preference[];
    },
  });
}
