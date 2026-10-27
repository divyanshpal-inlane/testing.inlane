import { useQuery } from "@tanstack/react-query";

import { fetchOrderSlots } from "@/components/admin/learner/useOrderSlots";
import {
  type ClassBudget,
  classBudget,
} from "@/lib/sales-dashboard/orderSlots";
import { supabase } from "@/lib/supabaseClient";

const UNKNOWN: ClassBudget = {
  total: null,
  bookedElsewhere: 0,
  remaining: null,
};

interface EnrollmentRow {
  id: string;
  learner_id: string;
  course_id: string | null;
  progress: { total_hours?: number } | null;
  Courses: { duration: number | null } | null;
}

/**
 * How many classes an order (service) covers and how many are already booked
 * against it, read fresh from the database. `ownRowIds` are the classes of
 * the booking being edited, which do not count against themselves.
 *
 * The size is the same figure History & orders shows: the enrollment's own
 * `progress.total_hours` (top-ups, add-on courses), else the course's duration.
 * If neither is known the budget is "unknown" and nothing is limited.
 */
export async function fetchOrderBudget(
  enrollmentId: string,
  ownRowIds: readonly number[],
): Promise<ClassBudget> {
  const { data, error } = (await supabase
    .from("enrollment")
    .select("id, learner_id, course_id, progress, Courses(duration)")
    .eq("id", enrollmentId)
    .maybeSingle()) as unknown as {
    data: EnrollmentRow | null;
    error: { message: string } | null;
  };
  if (error) throw error;
  if (!data) return UNKNOWN;

  const total = data.progress?.total_hours ?? data.Courses?.duration ?? null;
  const { data: learner } = await supabase
    .from("Learner")
    .select("phone")
    .eq("id", data.learner_id)
    .maybeSingle();

  const slots = await fetchOrderSlots(data.learner_id, learner?.phone, [
    { id: data.id, courseId: data.course_id },
  ]);
  return classBudget(total, slots.get(data.id) ?? [], ownRowIds);
}

/** The live class budget of the order a booking is linked to. */
export function useOrderBudget(
  enrollmentId: string | undefined,
  ownRowIds: readonly number[],
) {
  const own = [...ownRowIds].sort((a, b) => a - b).join(",");
  const q = useQuery<ClassBudget>({
    queryKey: ["order-budget", enrollmentId, own],
    enabled: !!enrollmentId,
    staleTime: 0,
    queryFn: () => fetchOrderBudget(enrollmentId!, ownRowIds),
  });
  return {
    /** null until it is known: nothing is limited while it loads. */
    budget: enrollmentId ? (q.data ?? null) : null,
    loading: !!enrollmentId && q.isLoading,
  };
}
