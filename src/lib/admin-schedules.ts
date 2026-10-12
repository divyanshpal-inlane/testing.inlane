import { supabase } from "@/lib/supabaseClient";

const PAGE_SIZE = 1000;

const SLOT_BOOKING_FUNCTION = "instructor-slot-booking";

// Left joins retain demo/custom/topup rows with no course/lesson, as well as
// unassigned classes. Never feed nullable foreign keys to UUID .in() lookups.
const SCHEDULE_SELECT = `
  *,
  Lesson(id, number),
  Instructor(id_instructor, name),
  Courses(id, name, total_lessons),
  learner:learner_id(id, name, phone, pick_up_location, address_lat, address_lng)
`;

export async function fetchAdminSchedules(
  column: "learner_id" | "instructor_id",
  id: string,
  signal?: AbortSignal,
) {
  const readPage = (offset: number) => {
    const query = supabase
      .from("Schedule")
      .select(SCHEDULE_SELECT)
      .eq(column, id)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    return signal ? query.abortSignal(signal) : query;
  };
  type Row = NonNullable<Awaited<ReturnType<typeof readPage>>["data"]>[number];
  const rows: Row[] = [];
  if (!id) return rows; // Never issue an unfiltered Schedule download.

  for (let offset = 0; ; offset += PAGE_SIZE) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const { data, error } = await readPage(offset);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

export type AdminSchedule = Awaited<
  ReturnType<typeof fetchAdminSchedules>
>[number];

// Instructor-module reads go through the slot-booking edge function instead of
// fetchAdminSchedules: it strips learner phone numbers (and tentative_details
// .phone) server-side, so no customer phone number ever reaches the browser.
export async function fetchInstructorModuleSchedules(
  instructorId: string,
  signal?: AbortSignal,
): Promise<AdminSchedule[]> {
  if (!instructorId) return [];
  const { data, error } = await supabase.functions.invoke(
    SLOT_BOOKING_FUNCTION,
    { body: { action: "schedules", instructorId }, signal },
  );
  if (error) throw error;
  const payload = data as {
    success?: boolean;
    rows?: AdminSchedule[];
    error?: string;
  } | null;
  if (payload?.success === false) {
    throw new Error(payload.error ?? "Failed to fetch schedules");
  }
  return payload?.rows ?? [];
}
