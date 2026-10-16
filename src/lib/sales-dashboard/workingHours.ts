// Derives a human-readable "typical working hours" window for an
// instructor purely from their existing Instructor.unavailability data --
// there is no dedicated start_time/end_time column anywhere in the schema
// (see the Sales Dashboard's global app_settings.booking_flow.slot_start/
// slot_end for the one shared config every instructor is bounded by).
//
// In practice, many real instructor rows encode a personal daily window by
// pairing two long-lived "unavailability" range entries that bracket the
// hours OUTSIDE their real day -- e.g. one blocking 00:00-06:00 and another
// blocking 18:00-23:59, implying an effective 06:00-18:00 day. This module
// reverse-engineers that bracket instead of re-deriving unavailability
// parsing from scratch, by calling the SAME unavailabilityIntervalsForDate()
// the real availability engine uses (so this can never disagree with what's
// actually enforced -- e.g. an inverted range_start_time > range_end_time
// entry is inert there, and is correctly treated as inert here too).
//
// This is a display-only heuristic: it never changes availability math,
// only what's shown to a human ("Hours: 06:00-18:00").

import { unavailabilityIntervalsForDate } from "./availability";
import { minutesToTime, timeToMinutes } from "./validation";

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

// How close to midnight/end-of-day a block's own edge has to land to count
// as "bracketing the day" rather than an ordinary mid-day break -- real
// data uses "00:01"/"23:55"/"23:58" as well as exact "00:00"/"23:59".
const NEAR_MIDNIGHT_MIN = 5;
const NEAR_END_OF_DAY_MIN = 24 * 60 - 5;

// A block only counts as a standing daily-hours restriction, not a one-off
// leave request, if it's still in effect ~2 years out -- checked by
// re-evaluating the SAME weekday 104 weeks later and keeping only
// intervals present at both points.
const STABILITY_PROBE_DAYS = 728;

export interface InstructorWorkingHours {
  start: string; // "HH:MM", clamped within the global slot window
  end: string; // "HH:MM", clamped within the global slot window
  isDerived: boolean; // false => no instructor-specific bracket found, this is just the global window
  daysOff: string[]; // lowercase weekday names the instructor never works
}

function isoDatePlusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function inferInstructorWorkingHours(
  unavailability: unknown[] | null | undefined,
  globalSlotStart: string,
  globalSlotEnd: string,
  referenceDateIso: string,
): InstructorWorkingHours {
  const globalStartMin = timeToMinutes(globalSlotStart);
  const globalEndMin = timeToMinutes(globalSlotEnd);
  const fallback: InstructorWorkingHours = {
    start: globalSlotStart,
    end: globalSlotEnd,
    isDerived: false,
    daysOff: [],
  };

  if (
    !unavailability ||
    !Array.isArray(unavailability) ||
    unavailability.length === 0
  ) {
    return fallback;
  }

  const farDateIso = isoDatePlusDays(referenceDateIso, STABILITY_PROBE_DAYS);
  let dayStartCandidate: number | null = null;
  let dayEndCandidate: number | null = null;
  const daysOff = new Set<string>();

  for (const weekday of WEEKDAYS) {
    const near = unavailabilityIntervalsForDate(
      unavailability,
      referenceDateIso,
      weekday,
    );
    const far = unavailabilityIntervalsForDate(
      unavailability,
      farDateIso,
      weekday,
    );
    const stable = near.filter((n) =>
      far.some((f) => f.start === n.start && f.end === n.end),
    );

    for (const w of stable) {
      if (w.start === 0 && w.end === 24 * 60) {
        daysOff.add(weekday);
        continue;
      }
      if (w.start <= NEAR_MIDNIGHT_MIN) {
        dayStartCandidate =
          dayStartCandidate === null
            ? w.end
            : Math.max(dayStartCandidate, w.end);
      }
      if (w.end >= NEAR_END_OF_DAY_MIN) {
        dayEndCandidate =
          dayEndCandidate === null
            ? w.start
            : Math.min(dayEndCandidate, w.start);
      }
    }
  }

  if (dayStartCandidate === null && dayEndCandidate === null) {
    return { ...fallback, daysOff: Array.from(daysOff) };
  }

  const startMin = Math.max(
    globalStartMin,
    dayStartCandidate ?? globalStartMin,
  );
  const endMin = Math.min(globalEndMin, dayEndCandidate ?? globalEndMin);

  return {
    start: minutesToTime(Math.min(startMin, endMin)),
    end: minutesToTime(Math.max(startMin, endMin)),
    isDerived: true,
    daysOff: Array.from(daysOff),
  };
}
