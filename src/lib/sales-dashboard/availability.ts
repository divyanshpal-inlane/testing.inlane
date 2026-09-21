// Pure availability engine for direct slot booking. No Deno imports — mirrors
// the web-app's instructor matching (enabled gate + area/radius) and
// isTimeUnavailable() semantics, expressed in integer minutes for determinism.
// Ported from supabase/functions/_shared/availability.ts (direct-booking
// backend) for client-side, read-only display in the sales dashboard.

import { dateToWeekdayLower, minutesToTime, timeToMinutes } from "./validation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstructorLike {
  id: string;
  areas?: string[] | null;
  radiusKm?: number | null;
  lat?: number | null;
  lng?: number | null;
  gender?: string | null;
  status?: string | null; // 'active' | 'on_break' | 'inactive'
  enabled?: boolean | null;
  unavailability?: unknown[] | null;
}

export interface ScheduleBlock {
  instructorId: string;
  date: string; // yyyy-mm-dd
  startMinute: number;
  endMinute: number;
  status: string; // 'booked' | 'pending_payment' | ...
  bookingCreatedAt?: string | null; // ISO timestamp holding the slot, if pending_payment
  ownerBookingId?: string | null; // booking that owns this row (for the travel-gap exemption)
}

export interface SlotConfig {
  slotStart: string; // '06:00'
  slotEnd: string; // '20:00'
  gridMinutes: number; // 30
  slotDurationMinutes: number; // 60
}

export interface AvailabilityInput {
  instructors: InstructorLike[];
  learnerArea: string;
  learner?: { lat?: number | null; lng?: number | null } | null;
  blocks?: ScheduleBlock[] | null;
  dates?: string[] | null; // yyyy-mm-dd
  slotConfig: SlotConfig;
  femalePreference?: boolean;
  femaleMode?: "off" | "preference" | "mandatory";
  holdMinutes?: number | null;
  now?: Date;
  // 30-min travel gap an instructor needs BETWEEN classes: every OTHER
  // booking's active block is treated as occupying [start-gap, end+gap]. The
  // learner's own booking (compare block.ownerBookingId against
  // excludeBookingId) gets NO gap so consecutive lessons can sit back-to-back.
  gapMinutes?: number | null;
  excludeBookingId?: string | null;
}

export interface SlotPointer {
  date: string;
  start: string; // HH:MM
}

export interface AvailableSlot extends SlotPointer {
  end: string; // HH:MM
  day: string;
  femaleCovered: boolean;
  femaleOnly: boolean;
  instructors: string[];
}

export interface AvailabilityResult {
  schedulingMode: "direct" | "assign_later";
  femaleInstructorAvailable: boolean;
  dates: { date: string; day: string; slots: AvailableSlot[] }[];
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------
// Instructor matching
// ---------------------------------------------------------------------------

export function isFemale(gender?: string | null): boolean {
  if (!gender) return false;
  const g = gender.trim().toLowerCase();
  return g === "female" || g === "f";
}

function hasArea(instructor: InstructorLike, learnerArea: string): boolean {
  const target = learnerArea.trim().toLowerCase();
  if (!target) return false;
  return (instructor.areas || []).some(
    (a) => typeof a === "string" && a.trim().toLowerCase() === target,
  );
}

function withinRadius(
  instructor: InstructorLike,
  learner?: { lat?: number | null; lng?: number | null } | null,
): boolean {
  if (
    !learner ||
    typeof learner.lat !== "number" ||
    typeof learner.lng !== "number"
  ) {
    return false;
  }
  if (
    typeof instructor.lat !== "number" ||
    typeof instructor.lng !== "number"
  ) {
    return false;
  }
  const radius = instructor.radiusKm == null ? 0 : Number(instructor.radiusKm);
  if (radius <= 0) return false;
  return (
    haversineKm(learner.lat, learner.lng, instructor.lat, instructor.lng) <=
    radius
  );
}

export function instructorServesArea(
  instructor: InstructorLike,
  learnerArea: string,
  learner?: { lat?: number | null; lng?: number | null } | null,
): boolean {
  return hasArea(instructor, learnerArea) || withinRadius(instructor, learner);
}

export function isInstructorActive(instructor: InstructorLike): boolean {
  if (instructor.enabled === false) return false;
  return (instructor.status ?? "active") === "active";
}

export function areaEligibleInstructors(
  input: Pick<AvailabilityInput, "instructors" | "learnerArea" | "learner">,
): InstructorLike[] {
  return input.instructors.filter(
    (i) =>
      isInstructorActive(i) &&
      instructorServesArea(i, input.learnerArea, input.learner),
  );
}

// ---------------------------------------------------------------------------
// Unavailability (port of src/utils/time.js isTimeUnavailable, minute-based)
// ---------------------------------------------------------------------------

export function isTimeUnavailable(
  unavailability: unknown[] | null | undefined,
  dateIso: string,
  dayOfWeekLower: string,
  currentMinutes: number,
): boolean {
  if (
    !unavailability ||
    !Array.isArray(unavailability) ||
    unavailability.length === 0
  ) {
    return false;
  }

  return unavailability.some((raw) => {
    const u = (raw ?? {}) as Record<string, unknown>;

    if (u.booked_date && u.all_day) {
      return dateIso === u.booked_date;
    }

    // All-day block by exact date without any all_day flag (admin sometimes
    // stores just {"booked_date": "YYYY-MM-DD"}).
    if (
      u.booked_date &&
      !u.all_day &&
      !u.booked_start_time &&
      !u.booked_end_time
    ) {
      return dateIso === u.booked_date;
    }

    if (
      u.booked_date &&
      u.booked_start_time &&
      u.booked_end_time &&
      !u.all_day
    ) {
      if (dateIso !== u.booked_date) return false;
      return (
        currentMinutes >= timeToMinutes(String(u.booked_start_time)) &&
        currentMinutes < timeToMinutes(String(u.booked_end_time))
      );
    }

    if (u.day_of_week && u.all_day) {
      return u.day_of_week === dayOfWeekLower;
    }

    if (
      u.day_of_week &&
      u.booked_start_time &&
      u.booked_end_time &&
      !u.all_day
    ) {
      if (u.day_of_week !== dayOfWeekLower) return false;
      return (
        currentMinutes >= timeToMinutes(String(u.booked_start_time)) &&
        currentMinutes < timeToMinutes(String(u.booked_end_time))
      );
    }

    // Recurring multi-day blocks stored as an array: {"type": "recurring",
    // "days_of_week": ["monday", ...], "booked_start_time": "...",
    // "booked_end_time": "...", "all_day": true/false}.
    if (Array.isArray(u.days_of_week) && u.days_of_week.length > 0) {
      if (
        !u.days_of_week.some((d) => String(d).toLowerCase() === dayOfWeekLower)
      )
        return false;
      if (u.all_day) return true;
      if (u.booked_start_time && u.booked_end_time) {
        return (
          currentMinutes >= timeToMinutes(String(u.booked_start_time)) &&
          currentMinutes < timeToMinutes(String(u.booked_end_time))
        );
      }
      return true;
    }

    if (u.start_date && u.end_date && u.range_all_day) {
      return dateIso >= String(u.start_date) && dateIso <= String(u.end_date);
    }

    if (
      u.start_date &&
      u.end_date &&
      !u.range_all_day &&
      u.range_start_time &&
      u.range_end_time
    ) {
      if (dateIso < String(u.start_date) || dateIso > String(u.end_date))
        return false;
      return (
        currentMinutes >= timeToMinutes(String(u.range_start_time)) &&
        currentMinutes < timeToMinutes(String(u.range_end_time))
      );
    }

    // Date-range block that only specifies a start time (rest of the day
    // blocked until the end of the booking window).
    if (
      u.start_date &&
      u.end_date &&
      !u.range_all_day &&
      u.range_start_time &&
      !u.range_end_time
    ) {
      if (dateIso < String(u.start_date) || dateIso > String(u.end_date))
        return false;
      return currentMinutes >= timeToMinutes(String(u.range_start_time));
    }

    if (u.start_date && u.end_date && !u.range_all_day && !u.range_start_time) {
      return dateIso >= String(u.start_date) && dateIso <= String(u.end_date);
    }

    return false;
  });
}

/**
 * Same entry shapes as isTimeUnavailable(), but returns the concrete
 * [start, end) minute intervals (0-1440) that apply on this specific date,
 * instead of a single point-in-time boolean.
 *
 * isTimeUnavailable() is a point check, so buildFreeGrid() used to sample it
 * at a handful of grid-aligned minutes (e.g. every 30) across a candidate's
 * duration. That missed real unavailability windows whose boundary falls on
 * a non-grid-aligned minute (this data has plenty: 12:18, 16:16, 20:30 is
 * fine but 03:30 lines up, real examples include ranges ending at :16, :18,
 * :51) -- a class could straddle the boundary and get sampled only at points
 * on the free side of it, showing as bookable when it genuinely overlaps.
 * Returning real intervals lets the caller do exact interval-overlap math
 * instead of point sampling, and also lets it apply the same instructor
 * travel-gap buffer already given to real Schedule blocks (see
 * blockCoversCandidate) to unavailability windows too.
 */
export function unavailabilityIntervalsForDate(
  unavailability: unknown[] | null | undefined,
  dateIso: string,
  dayOfWeekLower: string,
): Array<{ start: number; end: number }> {
  if (!unavailability || !Array.isArray(unavailability)) return [];
  const DAY_START = 0;
  const DAY_END = 24 * 60;
  const out: Array<{ start: number; end: number }> = [];

  for (const raw of unavailability) {
    const u = (raw ?? {}) as Record<string, unknown>;

    if (u.booked_date && u.all_day) {
      if (dateIso === u.booked_date)
        out.push({ start: DAY_START, end: DAY_END });
      continue;
    }

    if (
      u.booked_date &&
      !u.all_day &&
      !u.booked_start_time &&
      !u.booked_end_time
    ) {
      if (dateIso === u.booked_date)
        out.push({ start: DAY_START, end: DAY_END });
      continue;
    }

    if (
      u.booked_date &&
      u.booked_start_time &&
      u.booked_end_time &&
      !u.all_day
    ) {
      if (dateIso === u.booked_date) {
        out.push({
          start: timeToMinutes(String(u.booked_start_time)),
          end: timeToMinutes(String(u.booked_end_time)),
        });
      }
      continue;
    }

    if (u.day_of_week && u.all_day) {
      if (u.day_of_week === dayOfWeekLower)
        out.push({ start: DAY_START, end: DAY_END });
      continue;
    }

    if (
      u.day_of_week &&
      u.booked_start_time &&
      u.booked_end_time &&
      !u.all_day
    ) {
      if (u.day_of_week === dayOfWeekLower) {
        out.push({
          start: timeToMinutes(String(u.booked_start_time)),
          end: timeToMinutes(String(u.booked_end_time)),
        });
      }
      continue;
    }

    if (Array.isArray(u.days_of_week) && u.days_of_week.length > 0) {
      if (
        !u.days_of_week.some((d) => String(d).toLowerCase() === dayOfWeekLower)
      )
        continue;
      if (u.all_day) {
        out.push({ start: DAY_START, end: DAY_END });
      } else if (u.booked_start_time && u.booked_end_time) {
        out.push({
          start: timeToMinutes(String(u.booked_start_time)),
          end: timeToMinutes(String(u.booked_end_time)),
        });
      } else {
        out.push({ start: DAY_START, end: DAY_END });
      }
      continue;
    }

    if (u.start_date && u.end_date && u.range_all_day) {
      if (dateIso >= String(u.start_date) && dateIso <= String(u.end_date))
        out.push({ start: DAY_START, end: DAY_END });
      continue;
    }

    if (
      u.start_date &&
      u.end_date &&
      !u.range_all_day &&
      u.range_start_time &&
      u.range_end_time
    ) {
      if (dateIso >= String(u.start_date) && dateIso <= String(u.end_date)) {
        out.push({
          start: timeToMinutes(String(u.range_start_time)),
          end: timeToMinutes(String(u.range_end_time)),
        });
      }
      continue;
    }

    if (
      u.start_date &&
      u.end_date &&
      !u.range_all_day &&
      u.range_start_time &&
      !u.range_end_time
    ) {
      if (dateIso >= String(u.start_date) && dateIso <= String(u.end_date)) {
        out.push({
          start: timeToMinutes(String(u.range_start_time)),
          end: DAY_END,
        });
      }
      continue;
    }

    if (u.start_date && u.end_date && !u.range_all_day && !u.range_start_time) {
      if (dateIso >= String(u.start_date) && dateIso <= String(u.end_date))
        out.push({ start: DAY_START, end: DAY_END });
      continue;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Blocking (schedule overlaps, treating expired pending holds as free)
// ---------------------------------------------------------------------------

function isExpiredHold(
  block: ScheduleBlock,
  holdMinutes: number | null | undefined,
  now: Date,
): boolean {
  if (block.status !== "pending_payment") return false;
  if (!holdMinutes || holdMinutes <= 0 || !block.bookingCreatedAt) return false;
  const created = new Date(block.bookingCreatedAt).getTime();
  return now.getTime() - created > holdMinutes * 60 * 1000;
}

function blockCoversCandidate(
  block: ScheduleBlock,
  instructorId: string,
  date: string,
  startMinute: number,
  endMinute: number,
  holdMinutes: number | null | undefined,
  now: Date,
  gapMinutes: number,
  excludeBookingId?: string | null,
): boolean {
  if (block.instructorId !== instructorId) return false;
  if (block.date !== date) return false;
  if (isExpiredHold(block, holdMinutes, now)) return false;
  if (block.status === "cancelled" || block.status === "rejected") return false;
  const isOwn = Boolean(
    excludeBookingId && block.ownerBookingId === excludeBookingId,
  );
  const gap = isOwn ? 0 : Math.max(0, Math.floor(gapMinutes));
  return (
    block.startMinute - gap < endMinute && startMinute < block.endMinute + gap
  );
}

/**
 * Active class count per instructor (excluding cancelled/rejected rows and
 * expired pending holds) — the "how many classes have they got booked" load
 * used to prefer the least-loaded instructor when several serve a slot.
 */
export function instructorBookingLoad(
  blocks: ScheduleBlock[] | null | undefined,
  holdMinutes: number | null | undefined,
  now: Date,
): Record<string, number> {
  const load: Record<string, number> = {};
  for (const b of blocks || []) {
    if (b.status === "cancelled" || b.status === "rejected") continue;
    if (isExpiredHold(b, holdMinutes, now)) continue;
    load[b.instructorId] = (load[b.instructorId] ?? 0) + 1;
  }
  return load;
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

export function candidateStartMinutes(config: SlotConfig): number[] {
  const start = timeToMinutes(config.slotStart);
  const end = timeToMinutes(config.slotEnd);
  const round = Math.max(1, Math.floor(config.gridMinutes));
  const duration = Math.max(1, Math.floor(config.slotDurationMinutes));
  const out: number[] = [];
  for (let m = start; m + duration <= end; m += round) {
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Single-slot evaluation + deterministic instructor pick
// ---------------------------------------------------------------------------

export function evaluateSlot(
  input: AvailabilityInput,
  pointer: SlotPointer,
): {
  ok: boolean;
  instructors: string[];
  femaleCovered: boolean;
  femaleOnly: boolean;
} {
  const eligible = areaEligibleInstructors(input);
  const duration = Math.floor(input.slotConfig.slotDurationMinutes);
  const startMinute = timeToMinutes(pointer.start);
  const endMinute = startMinute + duration;
  const day = dateToWeekdayLower(pointer.date);
  const femaleMode = input.femaleMode ?? "off";
  const femalePreference = Boolean(input.femalePreference);
  const holdMinutes = input.holdMinutes;
  const now = input.now ?? new Date();
  const gapMinutes = Math.max(0, Math.floor(input.gapMinutes ?? 0));
  const excludeBookingId = input.excludeBookingId ?? null;
  const loadById = instructorBookingLoad(input.blocks, holdMinutes, now);

  const candidates = eligible.filter((instr) => {
    const blocked = (input.blocks || []).some((b) =>
      blockCoversCandidate(
        b,
        instr.id,
        pointer.date,
        startMinute,
        endMinute,
        holdMinutes,
        now,
        gapMinutes,
        excludeBookingId,
      ),
    );
    if (blocked) return false;
    if (isTimeUnavailable(instr.unavailability, pointer.date, day, startMinute))
      return false;
    return true;
  });

  const femaleCovered = candidates.some((i) => isFemale(i.gender));

  let usable = candidates;
  let femaleOnly = false;
  if (femaleMode === "mandatory" && femalePreference) {
    usable = candidates.filter((i) => isFemale(i.gender));
    femaleOnly = true;
  }

  if (usable.length === 0) {
    return {
      ok: false,
      instructors: [],
      femaleCovered,
      femaleOnly: femaleCovered && femaleOnly,
    };
  }

  const instructorId = pickBestInstructor(usable, {
    femalePreference,
    femaleMode,
    learner: input.learner ?? null,
    learnerArea: input.learnerArea,
    loadById,
  });

  return {
    ok: true,
    instructors: [instructorId],
    femaleCovered,
    femaleOnly: femaleCovered && femaleOnly,
  };
}

export function pickBestInstructor(
  candidates: InstructorLike[],
  opts: {
    femalePreference?: boolean;
    femaleMode?: "off" | "preference" | "mandatory";
    learner?: { lat?: number | null; lng?: number | null } | null;
    learnerArea: string;
    loadById?: Record<string, number>;
  },
): string {
  const femalePreference = Boolean(opts.femalePreference);
  const femaleMode = opts.femaleMode ?? "off";

  let pool = candidates;
  if (femaleMode === "mandatory" && femalePreference) {
    pool = candidates.filter((i) => isFemale(i.gender));
    if (pool.length === 0) pool = candidates;
  } else if (femaleMode === "preference" && femalePreference) {
    const females = candidates.filter((i) => isFemale(i.gender));
    if (females.length > 0) pool = females;
  }

  const area = opts.learnerArea.trim().toLowerCase();

  const scored = pool.map((i) => {
    const areaMatch = (i.areas || []).some(
      (a) => typeof a === "string" && a.trim().toLowerCase() === area,
    );
    let distance = -1;
    if (
      opts.learner &&
      typeof i.lat === "number" &&
      typeof i.lng === "number"
    ) {
      distance = haversineKm(
        opts.learner.lat ?? 0,
        opts.learner.lng ?? 0,
        i.lat,
        i.lng,
      );
    }
    const load = opts.loadById ? (opts.loadById[i.id] ?? 0) : 0;
    return { i, areaMatch, distance, load };
  });

  scored.sort((a, b) => {
    if (a.areaMatch !== b.areaMatch) return a.areaMatch ? -1 : 1;
    // Prefer the instructor with fewer classes already booked.
    if (a.load !== b.load) return a.load - b.load;
    if (a.distance >= 0 && b.distance >= 0 && a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return a.i.id.localeCompare(b.i.id);
  });

  return scored[0].i.id;
}

// ---------------------------------------------------------------------------
// Full grid
// ---------------------------------------------------------------------------

export function computeAvailableSlots(
  input: AvailabilityInput,
): AvailabilityResult {
  const eligible = areaEligibleInstructors(input);
  const femaleInstructorAvailable = eligible.some((i) => isFemale(i.gender));

  const dates = (input.dates || []).map((date) => {
    const slots: AvailableSlot[] = [];
    for (const start of candidateStartMinutes(input.slotConfig)) {
      const pointer: SlotPointer = { date, start: minutesToTime(start) };
      const res = evaluateSlot(input, pointer);
      if (!res.ok) continue;
      slots.push({
        date,
        start: pointer.start,
        end: minutesToTime(start + input.slotConfig.slotDurationMinutes),
        day: dateToWeekdayLower(date),
        femaleCovered: res.femaleCovered,
        femaleOnly: res.femaleOnly,
        instructors: res.instructors,
      });
    }
    return { date, day: dateToWeekdayLower(date), slots };
  });

  return {
    schedulingMode: "direct",
    femaleInstructorAvailable,
    dates,
  };
}

// ---------------------------------------------------------------------------
// Course-feasibility engine (one instructor for the whole course).
//
// A "first lesson" slot is only offered if at least one instructor serving the
// area can teach that 1-hour slot AND find Courses.total_lessons - 1 more
// free 1-hour slots within the booking window. The instructor that completes
// the course is chosen deterministically and stays server-side; the customer
// only ever sees date/time.
// ---------------------------------------------------------------------------

export interface CoursePlanLesson {
  lesson: number;
  date: string;
  start_time: string;
  end_time: string;
}

export interface CoursePlan {
  ok: boolean;
  instructorId?: string;
  totalLessons: number;
  lessons?: CoursePlanLesson[];
}

/**
 * For every eligible instructor, the set of free grid start minutes per date.
 * Free == no schedule overlap (expired pending holds are free again), no
 * instructor unavailability, instructor active + area eligible.
 */
export function buildInstructorFreeGrid(
  input: AvailabilityInput,
  eligible: InstructorLike[],
): Map<string, Map<string, number[]>> {
  return buildFreeGrid(input, eligible, input.slotConfig.slotDurationMinutes);
}

/**
 * Build a free grid for display purposes, checking each gridMinutes slot
 * (e.g., 30-min) against blocks+gap and unavailability.
 * This ensures buffer slots display correctly at 30-min granularity.
 */
export function buildDisplayFreeGrid(
  input: AvailabilityInput,
  eligible: InstructorLike[],
): Map<string, Map<string, number[]>> {
  return buildFreeGrid(input, eligible, input.slotConfig.gridMinutes);
}

function buildFreeGrid(
  input: AvailabilityInput,
  eligible: InstructorLike[],
  checkDuration: number,
): Map<string, Map<string, number[]>> {
  const now = input.now ?? new Date();
  const holdMinutes = input.holdMinutes;
  const duration = Math.floor(checkDuration);
  const starts = candidateStartMinutes(input.slotConfig);
  const dates = input.dates || [];
  const blocks = input.blocks || [];
  const gapMinutes = Math.max(0, Math.floor(input.gapMinutes ?? 0));
  const excludeBookingId = input.excludeBookingId ?? null;

  const out = new Map<string, Map<string, number[]>>();
  for (const instr of eligible) {
    const perDate = new Map<string, number[]>();
    for (const date of dates) {
      const day = dateToWeekdayLower(date);
      // Computed once per instructor/date, not per candidate: exact
      // [start, end) windows instead of isTimeUnavailable()'s point-in-time
      // check, so a candidate straddling a window's boundary (which often
      // isn't grid-aligned -- e.g. 12:18, 16:16, 20:51 in real data) is
      // caught by real interval overlap instead of being missed by sampling
      // only at grid-step offsets from the candidate's own start.
      const unavailableWindows = unavailabilityIntervalsForDate(
        instr.unavailability,
        date,
        day,
      );
      const free: number[] = [];
      for (const m of starts) {
        const blocked = blocks.some((b) =>
          blockCoversCandidate(
            b,
            instr.id,
            date,
            m,
            m + duration,
            holdMinutes,
            now,
            gapMinutes,
            excludeBookingId,
          ),
        );
        if (blocked) continue;
        // Unavailability gets the same instructor travel-gap buffer as a
        // real Schedule block already does above (gapMinutes on both
        // sides) -- a class shouldn't start the instant an unavailability
        // window ends, or end the instant one begins, any more than it
        // should for a real booked class. Overlapping buffer zones from
        // adjacent blocks/unavailability aren't double-counted since this
        // is just an OR across all blocking sources, so "there's already a
        // buffer from something else" falls out for free -- no special
        // case needed.
        const hitsUnavailability = unavailableWindows.some(
          (w) => m - gapMinutes < w.end && w.start < m + duration + gapMinutes,
        );
        if (hitsUnavailability) continue;
        free.push(m);
      }
      perDate.set(date, free);
    }
    out.set(instr.id, perDate);
  }
  return out;
}

/**
 * Greedy, deterministic plan for one instructor following the consecutive-slot
 * booking rule: at most 2 lessons per learner per day, and when 2 lessons land
 * on the same day they must be back-to-back (a single continuous session, one
 * start + the immediately next grid start). A day that can't host a second
 * consecutive lesson gets a single lesson; the rest flows to the next day.
 *
 * Lesson 1 is the customer's picked first slot; on the first lesson's own day
 * only strictly-later times are collected, so the pick can never be bumped out
 * of position 1 by an earlier lesson on that same day.
 * Returns null when fewer than `totalLessons` slots fit.
 */
export function planLessonsForInstructor(
  freeByDate: Map<string, number[]>,
  dates: string[],
  firstDate: string,
  firstStartMinute: number,
  totalLessons: number,
  duration: number,
): CoursePlanLesson[] | null {
  const sortedDates = [...dates].sort();
  const dayIndex = sortedDates.indexOf(firstDate);
  if (dayIndex < 0) return null;

  const picked: Array<{ date: string; start: number; end: number }> = [];
  const rows: Array<{ date: string; start: number; end: number }> = [];
  // Lessons only compete on the SAME date; the same time-of-day on a later
  // date is always free.
  const overlaps = (
    a: { date: string; start: number; end: number },
    b: { date: string; start: number; end: number },
  ) => a.date === b.date && a.start < b.end && b.start < a.end;

  const first: { date: string; start: number; end: number } = {
    date: firstDate,
    start: firstStartMinute,
    end: firstStartMinute + duration,
  };
  picked.push(first);
  rows.push({
    date: firstDate,
    start: firstStartMinute,
    end: firstStartMinute + duration,
  });

  for (let d = dayIndex; d < sortedDates.length; d++) {
    const date = sortedDates[d];
    const starts = (freeByDate.get(date) || []).slice().sort((a, b) => a - b);
    // The first lesson already occupies one slot on its own day.
    let placedOnDay = date === firstDate ? 1 : 0;
    // An already-placed lesson on this day pins the only legal second slot:
    // it must start exactly when the previous one ends (back-to-back).
    let anchorEnd: number | null =
      date === firstDate ? firstStartMinute + duration : null;
    for (const m of starts) {
      if (rows.length >= totalLessons) break;
      if (placedOnDay >= 2) break; // at most 2 lessons per learner per day
      // Lesson 1 is the customer's picked first slot; the pick can never be
      // bumped out of position 1 by an earlier lesson on the same day.
      if (date === firstDate && m <= firstStartMinute) continue;
      const interval = { date, start: m, end: m + duration };
      if (picked.some((p) => overlaps(p, interval))) continue;

      if (placedOnDay === 1) {
        // This day already has one lesson; a second is allowed ONLY if it is
        // adjacent (consecutive-slot rule: max 2/day, back-to-back, no gap).
        if (m !== anchorEnd) continue;
        picked.push(interval);
        rows.push({ date, start: m, end: m + duration });
        placedOnDay += 1;
        if (rows.length >= totalLessons) break;
        continue;
      }

      // First lesson of a fresh day: anchor the day, then only the adjacent
      // slot may follow.
      picked.push(interval);
      rows.push({ date, start: m, end: m + duration });
      placedOnDay += 1;
      anchorEnd = m + duration;
      if (rows.length >= totalLessons) break;
    }
    if (rows.length >= totalLessons) break;
  }

  if (rows.length < totalLessons) return null;

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  return rows.map((r, i) => ({
    lesson: i + 1,
    date: r.date,
    start_time: minutesToTime(r.start),
    end_time: minutesToTime(r.end),
  }));
}

/**
 * Returns null when the given lessons obey the consecutive-slot booking rule
 * (max 2 per day, same-day lessons back-to-back; no overlaps between any two),
 * otherwise a human-readable reason. Accepts CoursePlanLesson-shaped rows
 * ({date, start_time, end_time}).
 */
export function validateConsecutiveRule(
  lessons: Array<{
    date: string;
    start_time?: string;
    end_time?: string;
    start?: number;
    end?: number;
  }>,
): string | null {
  const minuteOf = (l: {
    date: string;
    start_time?: string;
    end_time?: string;
    start?: number;
    end?: number;
  }) => {
    const start =
      typeof l.start === "number"
        ? l.start
        : timeToMinutes(String(l.start_time ?? ""));
    const end =
      typeof l.end === "number"
        ? l.end
        : timeToMinutes(String(l.end_time ?? ""));
    return { date: l.date, start, end };
  };
  const byDate = new Map<string, Array<{ start: number; end: number }>>();
  for (const l of lessons) {
    const slot = minuteOf(l);
    const daySlots = byDate.get(slot.date) ?? [];
    daySlots.push({ start: slot.start, end: slot.end });
    byDate.set(slot.date, daySlots);
  }
  for (const [date, daySlots] of byDate) {
    if (daySlots.length > 2) return `More than 2 lessons on ${date}.`;
    if (daySlots.length === 2) {
      const [a, b] = daySlots;
      const first = a.start < b.start ? a : b;
      const second = first === a ? b : a;
      const over = first.start < second.end && second.start < first.end;
      if (over) return `Lessons overlap on ${date}.`;
      if (second.start !== first.end)
        return `Same-day lessons on ${date} are not consecutive.`;
    }
  }
  for (let i = 0; i < lessons.length; i++) {
    for (let j = i + 1; j < lessons.length; j++) {
      const a = minuteOf(lessons[i]);
      const b = minuteOf(lessons[j]);
      if (a.date !== b.date) continue;
      if (a.start < b.end && b.start < a.end)
        return `Lessons overlap on ${a.date}.`;
    }
  }
  return null;
}

function feasibleInstructorsAt(
  input: AvailabilityInput,
  free: Map<string, Map<string, number[]>>,
  date: string,
  startMinute: number,
  totalLessons: number,
): InstructorLike[] {
  const eligible = areaEligibleInstructors(input);
  const duration = Math.floor(input.slotConfig.slotDurationMinutes);
  const dates = input.dates || [];
  const out: InstructorLike[] = [];
  for (const instr of eligible) {
    const starts = free.get(instr.id)?.get(date) ?? [];
    if (!starts.includes(startMinute)) continue;
    if (
      planLessonsForInstructor(
        free.get(instr.id)!,
        dates,
        date,
        startMinute,
        totalLessons,
        duration,
      )
    ) {
      out.push(instr);
    }
  }
  return out;
}

/**
 * Full course plan starting from a specific first lesson slot. The chosen
 * instructor is the deterministically best one who can complete the course.
 */
export function computeCoursePlan(
  input: AvailabilityInput,
  pointer: SlotPointer,
  totalLessons: number,
): CoursePlan {
  const eligible = areaEligibleInstructors(input);
  const duration = Math.floor(input.slotConfig.slotDurationMinutes);
  const startMinute = timeToMinutes(pointer.start);
  const free = buildInstructorFreeGrid(input, eligible);
  const feasible = feasibleInstructorsAt(
    input,
    free,
    pointer.date,
    startMinute,
    totalLessons,
  );

  if (feasible.length === 0) {
    return { ok: false, totalLessons };
  }

  const instructorId = pickBestInstructor(feasible, {
    femalePreference: input.femalePreference,
    femaleMode: input.femaleMode ?? "off",
    learner: input.learner ?? null,
    learnerArea: input.learnerArea,
    loadById: instructorBookingLoad(
      input.blocks,
      input.holdMinutes,
      input.now ?? new Date(),
    ),
  });

  return {
    ok: true,
    instructorId,
    totalLessons,
    lessons: planLessonsForInstructor(
      free.get(instructorId)!,
      input.dates || [],
      pointer.date,
      startMinute,
      totalLessons,
      duration,
    )!,
  };
}

/**
 * Grid of feasible FIRST lessons. Only slots that some instructor can extend
 * into a full course are offered; identical date/time slots are deduplicated
 * (the slot is emitted once, mapped to the single chosen instructor).
 */
export function computeFeasibleFirstSlots(
  input: AvailabilityInput,
  totalLessons: number,
): AvailabilityResult {
  const eligible = areaEligibleInstructors(input);
  const femaleInstructorAvailable = eligible.some((i) => isFemale(i.gender));
  const duration = Math.floor(input.slotConfig.slotDurationMinutes);
  const free = buildInstructorFreeGrid(input, eligible);
  const loadById = instructorBookingLoad(
    input.blocks,
    input.holdMinutes,
    input.now ?? new Date(),
  );

  const dates = (input.dates || []).map((date) => {
    const slots: AvailableSlot[] = [];
    for (const start of candidateStartMinutes(input.slotConfig)) {
      const feasible = feasibleInstructorsAt(
        input,
        free,
        date,
        start,
        totalLessons,
      );
      if (feasible.length === 0) continue;
      const picked = pickBestInstructor(feasible, {
        femalePreference: input.femalePreference,
        femaleMode: input.femaleMode ?? "off",
        learner: input.learner ?? null,
        learnerArea: input.learnerArea,
        loadById,
      });
      const pickedInstr = feasible.find((f) => f.id === picked);
      slots.push({
        date,
        start: minutesToTime(start),
        end: minutesToTime(start + duration),
        day: dateToWeekdayLower(date),
        femaleCovered: isFemale(pickedInstr?.gender),
        femaleOnly: false,
        instructors: [picked],
      });
    }
    return { date, day: dateToWeekdayLower(date), slots };
  });

  return {
    schedulingMode: "direct",
    femaleInstructorAvailable,
    dates,
  };
}

// ---------------------------------------------------------------------------
// Sales Dashboard: Tentative Block Validator
// ---------------------------------------------------------------------------

// `freeGrid` here is built by buildInstructorFreeGrid(), which checks each
// candidate start minute against a full slotDurationMinutes-long window
// (60 min — a full class length), not a 30-min window. So
// freeSlotsForDate.includes(startMinute) already means "a full 60-minute
// class starting at startMinute is completely unblocked" — that's the
// entire check needed.
//
// A previous version of this function additionally required
// freeSlotsForDate.includes(startMinute + 30), which checks a DIFFERENT,
// later 60-minute window ([startMinute+30, startMinute+90)) — e.g. for a
// 07:00 booking it would also demand 07:30-08:30 be free, which is
// unrelated to the actual 07:00-08:00 slot being booked. Any unrelated
// booking/gap-buffer sitting in that later window caused this to reject
// slots that were genuinely fully free, matching the "shows green in the
// grid but double-click says not available" reports.
export function validateOneHourBlock(
  instructorId: string,
  date: string,
  startMinute: number,
  freeGrid: Map<string, Map<string, number[]>> | null,
): boolean {
  if (!freeGrid) return false;

  const instructorGrid = freeGrid.get(instructorId);
  if (!instructorGrid) return false;

  const freeSlotsForDate = instructorGrid.get(date);
  if (!freeSlotsForDate) return false;

  return freeSlotsForDate.includes(startMinute);
}
