// booking_flow app_settings parsing shared by all booking edge functions.
// Pure (no Deno imports) so the Node test harness can exercise it.
//
// Every business value is read strictly from the DB row. There are NO
// hardcoded fallbacks: if a required field is missing or invalid, the flow is
// treated as NOT configured (enabled:false) so booking fails closed instead of
// silently running on a value that doesn't exist in the DB.

export interface BookingFlowConfig {
  enabled: boolean;
  gateway: string;
  hold_minutes: number;
  max_slots_per_booking: number;
  booking_days_ahead: number;
  view_days_ahead: number | null;
  excluded_schedule_statuses: string[] | null;
  slotStart: string;
  slotEnd: string;
  gridMinutes: number;
  slotDurationMinutes: number;
  instructor_gap_minutes: number;
  female_instructor_mode: "off" | "preference" | "mandatory";
  installment_modes: string[];
}

export const FEMALE_MODES = ["off", "preference", "mandatory"] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function intInRange(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  if (r < min || r > max) return null;
  return r;
}

function timeString(value: unknown): string | null {
  return typeof value === "string" && TIME_RE.test(value) ? value : null;
}

export function readBookingFlowConfig(raw: unknown): BookingFlowConfig {
  const v = (raw ?? {}) as Record<string, unknown>;

  const gateway =
    typeof v.gateway === "string" && v.gateway.trim() ? v.gateway.trim() : null;
  const hold_minutes = intInRange(v.hold_minutes, 5, 1440);
  const max_slots_per_booking = intInRange(v.max_slots_per_booking, 1, 100);
  const booking_days_ahead = intInRange(v.booking_days_ahead, 1, 60);
  const slotStart = timeString(v.slot_start);
  const slotEnd = timeString(v.slot_end);
  const gridMinutes = intInRange(v.slot_grid_minutes, 5, 60);
  const slotDurationMinutes = intInRange(v.slot_duration_minutes, 15, 240);
  const instructor_gap_minutes = intInRange(v.instructor_gap_minutes, 0, 240);
  const view_days_ahead = intInRange(v.view_days_ahead, 1, 730);
  const excluded_schedule_statuses =
    Array.isArray(v.excluded_schedule_statuses) &&
    v.excluded_schedule_statuses.length > 0 &&
    v.excluded_schedule_statuses.every(
      (s) => typeof s === "string" && s.trim() !== "",
    )
      ? (v.excluded_schedule_statuses as string[])
      : null;
  const female_instructor_mode = (FEMALE_MODES as readonly string[]).includes(
    String(v.female_instructor_mode),
  )
    ? (v.female_instructor_mode as BookingFlowConfig["female_instructor_mode"])
    : null;
  const installment_modes =
    Array.isArray(v.installment_modes) &&
    v.installment_modes.length > 0 &&
    v.installment_modes.every((m) => typeof m === "string" && m.trim() !== "")
      ? (v.installment_modes as string[])
      : null;

  const complete =
    gateway !== null &&
    hold_minutes !== null &&
    max_slots_per_booking !== null &&
    booking_days_ahead !== null &&
    slotStart !== null &&
    slotEnd !== null &&
    gridMinutes !== null &&
    slotDurationMinutes !== null &&
    instructor_gap_minutes !== null &&
    female_instructor_mode !== null &&
    installment_modes !== null;

  const enabledRaw = v.enabled === true;
  const enabled = enabledRaw && complete;

  return {
    enabled,
    gateway: gateway ?? "",
    hold_minutes: hold_minutes ?? 0,
    max_slots_per_booking: max_slots_per_booking ?? 0,
    booking_days_ahead: booking_days_ahead ?? 0,
    slotStart: slotStart ?? "",
    slotEnd: slotEnd ?? "",
    gridMinutes: gridMinutes ?? 0,
    slotDurationMinutes: slotDurationMinutes ?? 0,
    instructor_gap_minutes: instructor_gap_minutes ?? 0,
    female_instructor_mode: female_instructor_mode ?? "off",
    installment_modes: installment_modes ?? [],
    view_days_ahead,
    excluded_schedule_statuses,
  };
}
