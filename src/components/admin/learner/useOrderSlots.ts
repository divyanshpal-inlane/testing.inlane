import { useQuery } from "@tanstack/react-query";

import {
  assignSlotsToOrders,
  type OrderRef,
  type OrderSlot,
  type OrderSlotRow,
  parseOrderSlot,
} from "@/lib/sales-dashboard/orderSlots";
import { tenDigitPhone } from "@/lib/sales-dashboard/serviceBooking";
import { supabase } from "@/lib/supabaseClient";

const COLUMNS =
  "id, instructor_id, date, start_time, end_time, status, isTentative, course_id, tentative_details, lesson:lesson_id(number)";
// Same default the dashboard uses for classes that no longer count.
const EXCLUDED = "(cancelled,rejected)";

type Rows = { data: OrderSlotRow[] | null; error: { message: string } | null };

/**
 * The classes booked against each of a learner's orders (services), keyed by
 * enrollment id. A class belongs to an order when
 *  - it is linked: `tentative_details.enrollment_id` is the order (every Sales
 *    Dashboard booking), or
 *  - it was booked before linking existed: it belongs to the learner (by
 *    `learner_id`, or for Instructor Management holds by the phone saved on
 *    the hold) and carries the order's course id.
 * Past dates count as booked. Whether a class can be edited is the caller's
 * business (only tentative ones can).
 */
export async function fetchOrderSlots(
  learnerId: string,
  learnerPhone: string | null | undefined,
  orders: readonly OrderRef[],
): Promise<Map<string, OrderSlot[]>> {
  const ids = orders.map((o) => o.id);
  const courseIds = [
    ...new Set(orders.map((o) => o.courseId).filter(Boolean)),
  ] as string[];
  const p10 = tenDigitPhone(learnerPhone);
  const phones = p10 ? [p10, `91${p10}`, `+91${p10}`] : [];

  const base = () =>
    supabase
      .from("Schedule" as never)
      .select(COLUMNS)
      .not("status", "in", EXCLUDED);

  const queries: PromiseLike<unknown>[] = [
    // 1. linked to one of the orders
    base().in("tentative_details->>enrollment_id", ids),
  ];
  if (courseIds.length > 0) {
    // 2. older classes of this learner, by course
    queries.push(base().eq("learner_id", learnerId).in("course_id", courseIds));
    // 3. older Instructor Management holds, by the phone saved on the hold
    if (phones.length > 0) {
      queries.push(
        base()
          .eq("isTentative", true)
          .in("tentative_details->>phone", phones)
          .in("course_id", courseIds),
      );
    }
  }

  const results = (await Promise.all(queries)) as Rows[];
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;

  const slots = results
    .flatMap((r) => r.data ?? [])
    .map(parseOrderSlot)
    .filter((s): s is OrderSlot => s !== null);
  return assignSlotsToOrders(slots, orders);
}

export function useOrderSlots(
  learnerId: string,
  learnerPhone: string | null | undefined,
  orders: readonly OrderRef[],
) {
  const key = `${learnerId}:${learnerPhone ?? ""}:${orders
    .map((o) => `${o.id}/${o.courseId ?? ""}`)
    .sort()
    .join(",")}`;
  return useQuery<Map<string, OrderSlot[]>>({
    queryKey: ["order-slots", key],
    enabled: orders.length > 0,
    staleTime: 0,
    queryFn: () => fetchOrderSlots(learnerId, learnerPhone, orders),
  });
}

/** Instructor names for some ids (id -> name), for showing who teaches a class. */
export function useInstructorNames(ids: readonly string[]) {
  const unique = [...new Set(ids)].sort();
  return useQuery<Map<string, string>>({
    queryKey: ["instructor-names", unique.join(",")],
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Instructor")
        .select("id_instructor, name")
        .in("id_instructor", unique);
      if (error) throw error;
      return new Map(
        (data ?? []).map((r) => [
          String(r.id_instructor),
          String(r.name ?? ""),
        ]),
      );
    },
  });
}
