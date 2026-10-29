// The classes (Schedule rows) booked against one order (a service / enrollment).
// Pure helpers, so they are unit tested.
//
// A class belongs to an order in one of two ways:
//  1. LINKED: it is a tentative slot with `tentative_details.enrollment_id` =
//     the order (every Sales Dashboard booking made since linking exists).
//  2. BY COURSE: it was booked before linking existed (Instructor Management,
//     older bookings, or classes Operations confirmed). It belongs to the
//     learner and carries the order's course id, so it is attributed to that
//     order. A top-up has no course, so only a link can attach classes to it.

/** One class, as needed to show it and to open it for editing. */
export interface OrderSlot {
  id: number;
  instructorId: string;
  /** YYYY-MM-DD */
  date: string;
  startMinute: number;
  endMinute: number;
  /** A tentative hold (editable here); false = confirmed by Operations. */
  tentative: boolean;
  status: string;
  courseId: string | null;
  /** The lesson (class) number within the course, when the class has one. */
  lessonNumber: number | null;
  details: Record<string, unknown> | null;
}

/** The Schedule columns the order-slots queries select. */
export interface OrderSlotRow {
  id: number;
  instructor_id: string;
  date: string;
  start_time: string;
  end_time: string;
  status?: string | null;
  isTentative?: boolean | null;
  course_id?: string | null;
  /** Joined `lesson:lesson_id(number)`. */
  lesson?: { number?: number | null } | null;
  tentative_details: Record<string, unknown> | null;
}

/** "17:30" / "17:30:00" -> minutes since midnight, or null. */
export function hhmmToMinutes(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function parseOrderSlot(row: OrderSlotRow): OrderSlot | null {
  const start = hhmmToMinutes(row.start_time);
  const end = hhmmToMinutes(row.end_time);
  if (start === null || end === null) return null;
  return {
    id: row.id,
    instructorId: row.instructor_id,
    date: String(row.date).slice(0, 10),
    startMinute: start,
    endMinute: end,
    tentative: row.isTentative === true,
    status: row.status ?? "",
    courseId: row.course_id ?? null,
    lessonNumber:
      typeof row.lesson?.number === "number" && row.lesson.number > 0
        ? row.lesson.number
        : null,
    details: row.tentative_details ?? null,
  };
}

const bySlotTime = (a: OrderSlot, b: OrderSlot) =>
  a.date === b.date ? a.startMinute - b.startMinute : a.date < b.date ? -1 : 1;

export interface OrderRef {
  id: string;
  /** The enrollment's course; null for a top-up / custom order. */
  courseId: string | null;
}

/**
 * Every class assigned to its order, each list in time order.
 * A class with an explicit link goes to that order (and only that one). A class
 * without a link goes to the order with the same course id; if several orders
 * share the course, to the first listed (callers pass newest first).
 */
export function assignSlotsToOrders(
  slots: readonly OrderSlot[],
  orders: readonly OrderRef[],
): Map<string, OrderSlot[]> {
  const orderIds = new Set(orders.map((o) => o.id));
  const byCourse = new Map<string, string>();
  for (const o of orders) {
    if (o.courseId && !byCourse.has(o.courseId)) byCourse.set(o.courseId, o.id);
  }
  const out = new Map<string, OrderSlot[]>();
  const seen = new Set<number>();
  for (const s of slots) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const linked = s.details?.enrollment_id;
    let target: string | undefined;
    if (typeof linked === "string" && linked !== "") {
      target = orderIds.has(linked) ? linked : undefined;
    } else if (s.courseId) {
      target = byCourse.get(s.courseId);
    }
    if (!target) continue;
    const list = out.get(target) ?? [];
    list.push(s);
    out.set(target, list);
  }
  for (const list of out.values()) list.sort(bySlotTime);
  return out;
}

export interface BookedSummary {
  /** Every booked class: past or upcoming, tentative or confirmed. */
  total: number;
  /** The tentative ones: the only ones that can be edited here. */
  tentative: OrderSlot[];
  /** Classes Operations has confirmed (counted, not editable here). */
  confirmed: number;
  /** The earliest class on or after `today`, if any. */
  next: OrderSlot | null;
}

export function summarizeBooked(
  slots: readonly OrderSlot[],
  today: string,
): BookedSummary {
  const sorted = [...slots].sort(bySlotTime);
  const tentative = sorted.filter((s) => s.tentative);
  return {
    total: sorted.length,
    tentative,
    confirmed: sorted.length - tentative.length,
    next: sorted.find((s) => s.date >= today) ?? null,
  };
}

/** The date span of some classes, so a loader can fetch exactly that range. */
export function dateRangeOf(
  slots: readonly OrderSlot[],
): { from: string; to: string } | null {
  if (slots.length === 0) return null;
  let from = slots[0].date;
  let to = slots[0].date;
  for (const s of slots) {
    if (s.date < from) from = s.date;
    if (s.date > to) to = s.date;
  }
  return { from, to };
}

export type SlotPayment = "unpaid" | "half_paid" | "full_paid";

/**
 * A tentative slot's payment label from its details. Sales bookings write
 * `payment_status`; Instructor Management writes `paid_info` ("Full paid");
 * a slot with neither counts as unpaid.
 */
export function slotPaymentStatus(
  details: Record<string, unknown> | null | undefined,
): SlotPayment {
  const raw =
    (typeof details?.payment_status === "string" && details.payment_status) ||
    (typeof details?.paid_info === "string" && details.paid_info) ||
    "";
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "full_paid") return "full_paid";
  if (v === "half_paid") return "half_paid";
  return "unpaid";
}

/** How many classes an order has and how many are already used elsewhere. */
export interface ClassBudget {
  /** Classes the order covers; null when it is not known (then nothing is limited). */
  total: number | null;
  /** Classes booked against the order that are NOT part of the booking being edited. */
  bookedElsewhere: number;
  /** total - bookedElsewhere, never below 0; null when total is unknown. */
  remaining: number | null;
}

/**
 * The class budget of an order. `ownRowIds` are the classes of the booking
 * being edited: they are part of the form, not "booked elsewhere", so editing a
 * booking never counts its own classes against itself.
 */
export function classBudget(
  total: number | null | undefined,
  slots: readonly OrderSlot[],
  ownRowIds: readonly number[],
): ClassBudget {
  const own = new Set(ownRowIds);
  const bookedElsewhere = slots.filter((s) => !own.has(s.id)).length;
  const known = typeof total === "number" && total > 0;
  return {
    total: known ? total : null,
    bookedElsewhere,
    remaining: known ? Math.max(0, total - bookedElsewhere) : null,
  };
}

/**
 * How many MORE classes can be added to a booking that already has `selected`
 * classes in the form. null = no limit (the order's size is unknown); 0 = full;
 * never negative.
 */
export function moreAllowed(
  budget: ClassBudget | null | undefined,
  selected: number,
): number | null {
  if (!budget || budget.remaining === null) return null;
  return Math.max(0, budget.remaining - selected);
}

/** How many classes the form holds beyond what the order allows (0 when fine). */
export function overBy(
  budget: ClassBudget | null | undefined,
  selected: number,
): number {
  if (!budget || budget.remaining === null) return 0;
  return Math.max(0, selected - budget.remaining);
}

export type SlotTone =
  | "tentative"
  | "booked"
  | "completed"
  | "paused"
  | "other";

/**
 * A class's state in plain words, for the schedule list: a tentative hold is
 * "Tentative"; otherwise the Schedule status ("completed", "paused", "booked"/
 * "confirmed"/"hold" all read as "Booked"); anything else is shown as written.
 */
export function slotStatus(slot: Pick<OrderSlot, "tentative" | "status">): {
  label: string;
  tone: SlotTone;
} {
  if (slot.tentative) return { label: "Tentative", tone: "tentative" };
  const s = (slot.status ?? "").trim().toLowerCase();
  if (s === "completed") return { label: "Completed", tone: "completed" };
  if (s === "paused") return { label: "Paused", tone: "paused" };
  if (s === "" || s === "booked" || s === "confirmed" || s === "hold") {
    return { label: "Booked", tone: "booked" };
  }
  return { label: s.charAt(0).toUpperCase() + s.slice(1), tone: "other" };
}

/** "2026-10-26" -> a local Date at midnight (no UTC shift), or null. */
export function localDateOf(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
