// Pure availability engine for direct slot booking. No Deno imports — mirrors
// the web-app's instructor matching (enabled gate + service-area polygon, with
// legacy area/radius fallback) and isTimeUnavailable() semantics, expressed in
// integer minutes for determinism.
// Ported from supabase/functions/_shared/availability.ts (direct-booking
// backend) for client-side, read-only display in the sales dashboard.

import { isCompanyInstructor } from "./company-instructors";
import { type GeoPoint, pointInPolygon } from "./kml";
import { dateToWeekdayLower, timeToMinutes } from "./validation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstructorLike {
  id: string;
  /** Service-area polygon ring from instructor_service_zones.coordinates.
   *  Stored closed (first point repeated last). Takes precedence over the
   *  legacy fields below. */
  zone?: GeoPoint[] | null;
  /** @deprecated legacy name-list coverage, superseded by `zone`. */
  areas?: string[] | null;
  /** @deprecated legacy radius coverage, superseded by `zone`. */
  radiusKm?: number | null;
  /** @deprecated legacy centroid latitude, superseded by `zone`. */
  lat?: number | null;
  /** @deprecated legacy centroid longitude, superseded by `zone`. */
  lng?: number | null;
  gender?: string | null;
  /** Instructor display name. Used to exclude company instructors (Ops-assigned
   *  backups) from automatic area matching — see company-instructors.ts. */
  name?: string | null;
  /** `Instructor.is_company_instructor` — authoritative, rename-proof. No caller
   *  in this repo populates it yet: the live matching path is
   *  `SalesDashboard.locMatch`, which filters by the DB ids from
   *  `fetchCompanyInstructorIds()`, and this engine is currently unreferenced.
   *  Select the column when wiring a caller that does need this guard — but
   *  note `useSalesData`'s Instructor select already omits `gender` because a
   *  bad column makes PostgREST reject the whole query (400), so verify the
   *  column exists before adding it. `name` remains the fallback. */
  isCompany?: boolean | null;
  /**
   * `instructor_service_zones.is_rough` — the boundary is a provisional
   * onboarding approximation, not a verified serviceability zone.
   *
   * When true the instructor is excluded from ALL area matching
   * (`instructorServesArea`), so a rough polygon can never be the reason a
   * customer is matched to this instructor. Defaults to false when omitted, so
   * existing callers that do not pass the column keep their current behaviour
   * for the 66 verified polygons.
   */
  isRough?: boolean | null;
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

/** Rings are stored closed (first point repeated last, KML convention). The
 *  duplicate closing vertex is harmless for ray-casting but stripping it keeps
 *  the scan tight and avoids a degenerate final edge. */
function stripClosure(ring: GeoPoint[]): GeoPoint[] {
  if (ring.length < 4) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = first.lat === last.lat && first.lng === last.lng;
  return isClosed ? ring.slice(0, -1) : ring;
}

/** Ray-casting point-in-polygon against the instructor's drawn service area. */
function zoneContainsPoint(
  instructor: InstructorLike,
  learner?: { lat?: number | null; lng?: number | null } | null,
): boolean {
  const ring = instructor.zone;
  if (!Array.isArray(ring) || ring.length < 3) return false;
  if (
    !learner ||
    typeof learner.lat !== "number" ||
    typeof learner.lng !== "number"
  ) {
    return false;
  }
  return pointInPolygon(
    { lat: learner.lat, lng: learner.lng },
    stripClosure(ring),
  );
}

/** @deprecated legacy name-list matching, kept for instructors not yet
 *  migrated to a polygon. */
function hasArea(instructor: InstructorLike, learnerArea: string): boolean {
  const target = learnerArea.trim().toLowerCase();
  if (!target) return false;
  return (instructor.areas || []).some(
    (a) => typeof a === "string" && a.trim().toLowerCase() === target,
  );
}

/** @deprecated legacy centroid+radius matching, kept for instructors not yet
 *  migrated to a polygon. */
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
  // Company instructors are Ops-assigned backups: never auto-match them, even
  // though they carry legacy `areas`/`radius` values in the Instructor table.
  if (instructor.isCompany === true) return false;
  if (isCompanyInstructor(instructor.name)) return false;
  // A rough polygon is a provisional onboarding boundary that Operations has
  // not verified, so it must not count as serviceability — not through the
  // polygon path, and not through the legacy `areas`/`radius` fallbacks either.
  // An instructor whose only zone is rough therefore serves nobody until the
  // flag is cleared.
  if (instructor.isRough === true) return false;
  // Polygon first: once an instructor has a drawn zone it is authoritative.
  if (zoneContainsPoint(instructor, learner)) return true;
  return hasArea(instructor, learnerArea) || withinRadius(instructor, learner);
}

export function isInstructorActive(instructor: InstructorLike): boolean {
  if (instructor.enabled === false) return false;
  // Both columns are checked. They are only kept in sync by the admin UI, so a
  // row with status='inactive' and enabled=true — a direct write, an older
  // script, a partially-applied migration — must not be treated as bookable.
  if (instructor.status === "inactive") return false;
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
