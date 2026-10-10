import {
  QueryClient,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { filterUnfulfilledSchedulingRequests } from "@/lib/scheduling-requests";
import { supabase } from "@/lib/supabaseClient";
import { Database } from "@/types/database.types";
import { TimeSlot } from "@/types/schedule";

// Admin uses the infinite queue; other screens still use the regular query.
export function invalidateSchedulingRequestQueries(
  queryClient: QueryClient,
  learnerId?: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["scheduling-requests"] }),
    queryClient.invalidateQueries({
      queryKey: ["scheduling-requests-infinite"],
    }),
    queryClient.invalidateQueries({
      queryKey: learnerId
        ? ["learnerRescheduleRequests", learnerId]
        : ["learnerRescheduleRequests"],
    }),
  ]);
}

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
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

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

      // Include lesson/status metadata so unrelated or cancelled classes
      // cannot incorrectly hide a learner who still needs scheduling.
      const { data: existingSchedules, error: scheduleError } = await supabase
        .from("Schedule")
        .select("learner_id, lesson_id, created_at, status")
        .in("learner_id", learnerIds);

      if (scheduleError) {
        console.error("Error checking existing schedules:", scheduleError);
        // If query fails, return all pending requests to be safe
        return learners;
      }

      return filterUnfulfilledSchedulingRequests(
        learners,
        existingSchedules ?? [],
      );
    },
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
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
        .order("id", { ascending: false })
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

      // Same fulfillment rules as the regular queue.
      const { data: existingSchedules, error: scheduleError } = await supabase
        .from("Schedule")
        .select("learner_id, lesson_id, created_at, status")
        .in("learner_id", learnerIds);

      if (scheduleError) {
        console.error("Error checking existing schedules:", scheduleError);
        return { data: learners, hasMoreInDb: rawFetchedCount >= BATCH_SIZE };
      }

      const filteredLearners = filterUnfulfilledSchedulingRequests(
        learners,
        existingSchedules ?? [],
      );

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
    refetchInterval: 30 * 1000,
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
          { type?: string; total_hours?: number } | null | undefined;
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
