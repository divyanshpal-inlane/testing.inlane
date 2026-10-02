import { addDays, addHours, format, parseISO } from "date-fns";

export type BulkType = "single" | "daily" | "hourly";

export interface BulkSlotInput {
  bulkType: BulkType;
  /** yyyy-MM-dd */
  date: string;
  /** HH:mm */
  startTime: string;
  /** HH:mm */
  endTime: string;
  repeatCount: number;
}

export interface BulkSlot {
  date: string;
  startTime: string;
  endTime: string;
}

// Same generation rules as Instructor Management's "Bulk Add Schedules"
// (AddTentativeSchedule.handleApplyBulkSchedules in routes/admin/instructors):
//  - single: exactly the date/time entered
//  - daily:  the SAME time on each of the NEXT N days (day 1 = date + 1)
//  - hourly: the SAME day, each of the NEXT N hours (hour 1 = start + 1h)
// "Next", not "this", because that flow already holds the entered slot as the
// base; the copies continue after it.
//
// Kept as a pure function (no React, no Supabase) so the real thing - not a
// re-implementation - can be exercised by tests.
export function generateBulkSlots(input: BulkSlotInput): BulkSlot[] {
  const { bulkType, date, startTime, endTime } = input;
  const count =
    bulkType === "single"
      ? 1
      : Math.min(15, Math.max(1, Math.floor(input.repeatCount) || 1));
  const baseDate = parseISO(date);
  const out: BulkSlot[] = [];

  for (let i = 0; i < count; i++) {
    let sDate = date;
    let sStart = startTime;
    let sEnd = endTime;

    if (bulkType === "daily") {
      sDate = format(addDays(baseDate, i + 1), "yyyy-MM-dd");
    } else if (bulkType === "hourly") {
      sStart = format(
        addHours(parseISO(`${date}T${startTime}`), i + 1),
        "HH:mm",
      );
      sEnd = format(addHours(parseISO(`${date}T${endTime}`), i + 1), "HH:mm");
    }

    out.push({ date: sDate, startTime: sStart, endTime: sEnd });
  }
  return out;
}

// Why a generated slot cannot be added. Checked in this order, and only the
// first applicable reason is reported.
export type BulkSkipReason =
  | { kind: "invalid"; detail: string }
  | { kind: "in-batch"; detail: string }
  | { kind: "busy"; detail: string };

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Pure validity + overlap-with-batch checks. The instructor-busy check needs
// the database, so the caller layers checkInstructorAvailability on top.
export function screenBulkSlot(
  slot: BulkSlot,
  existing: BulkSlot[],
  requiredMinutes?: number,
): BulkSkipReason | null {
  const start = toMinutes(slot.startTime);
  const end = toMinutes(slot.endTime);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    slot.endTime <= slot.startTime
  ) {
    return {
      kind: "invalid",
      detail: `${slot.date} ${slot.startTime}-${slot.endTime}: end must be after start`,
    };
  }
  // Sales books fixed-length classes: availability (validateOneHourBlock)
  // and the grid only understand that length, so any other duration would be
  // checked as if it were the standard one and then stored as something else.
  if (requiredMinutes !== undefined && end - start !== requiredMinutes) {
    return {
      kind: "invalid",
      detail: `${slot.date} ${slot.startTime}-${slot.endTime}: classes must be exactly ${requiredMinutes} minutes`,
    };
  }
  const clash = existing.find(
    (e) =>
      e.date === slot.date &&
      start < toMinutes(e.endTime) &&
      toMinutes(e.startTime) < end,
  );
  if (clash) {
    return {
      kind: "in-batch",
      detail: `${slot.date} ${slot.startTime}-${slot.endTime}: overlaps ${clash.startTime}-${clash.endTime} already in this booking`,
    };
  }
  return null;
}
