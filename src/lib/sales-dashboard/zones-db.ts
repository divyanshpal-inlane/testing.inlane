import { supabase } from "@/lib/supabaseClient";

import {
  isCompanyInstructor,
  isCompanyInstructorId,
} from "./company-instructors";
import type { GeoPoint, KmlZone } from "./kml";

/**
 * A service area as stored in `instructor_service_zones`.
 *
 * `KmlZone` is reused purely as the in-memory shape so the existing map overlay
 * (`LocationSearch`) keeps working unchanged — the *source* of the data is the
 * database, not `public/instructors.kml`. The KML is now only a one-off
 * backfill input (see scripts/backfill-instructor-service-zones.mjs).
 *
 * `id` is the row's primary key. Business rule: an instructor has AT MOST ONE
 * service-area polygon. `UNIQUE(instructor_id)` (migration 20260928) enforces
 * that at the database level, and 0 instructors currently hold more than one.
 *
 * Writes are still keyed on `id` rather than `instructor_id`, because that is
 * the precise target: under the one-polygon rule it resolves to the same row an
 * `upsert(onConflict: 'instructor_id')` would have hit, but it cannot silently
 * overwrite a different row, and `deleteZoneById` cannot take out more than the
 * one polygon the admin is looking at. `insertZone` is for a first zone only.
 */
export interface DbZone extends KmlZone {
  id: string;
  instructorId: string;
}

interface ZoneRow {
  id: string;
  instructor_id: string;
  coordinates: unknown;
  raw_name: string | null;
  Instructor: { name: string } | null;
}

let cache: DbZone[] | null = null;
let inflight: Promise<DbZone[]> | null = null;
/**
 * Bumped by `invalidateDbZoneCache`. A fetch stamps the current value when it
 * starts and only publishes to `cache` if it is still current on completion, so
 * a read issued before a write can never install pre-write rows.
 */
let cacheEpoch = 0;
let companyCache: Set<string> | null = null;
let companyInflight: Promise<Set<string>> | null = null;

/**
 * Ids of instructors flagged `Instructor.is_company_instructor = true`.
 *
 * These are Ops-assigned backups and must never be auto-matched. The column
 * arrives with migration 20260929_100000, so this query is deliberately
 * tolerant: while the column is missing PostgREST rejects the whole select, and
 * we fall back to an empty set (callers then rely on the name list in
 * company-instructors.ts). Never throws, so a pending migration cannot take the
 * dashboard down.
 */
export async function fetchCompanyInstructorIds(
  force = false,
): Promise<Set<string>> {
  if (!force && companyCache) return companyCache;
  if (!force && companyInflight) return companyInflight;

  const run = (async () => {
    const { data, error } = await supabase
      .from("Instructor")
      .select("id_instructor")
      .eq("is_company_instructor", true);
    if (error) {
      // Column not migrated yet — degrade to the name-list fallback.
      if (import.meta.env.DEV) {
        console.warn(
          "[zones-db] could not read Instructor.is_company_instructor; " +
            "falling back to the hardcoded name list. Apply " +
            "supabase/migrations/20260929_100000_add_company_instructor_flag.sql",
        );
      }
      return new Set<string>();
    }
    return new Set(
      (data ?? []).map((r) => (r as { id_instructor: string }).id_instructor),
    );
  })();

  companyInflight = run;
  try {
    companyCache = await run;
    return companyCache;
  } finally {
    companyInflight = null;
  }
}

function isFinitePoint(p: unknown): p is GeoPoint {
  if (typeof p !== "object" || p === null) return false;
  const { lat, lng } = p as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

function toDbZone(row: ZoneRow): DbZone | null {
  const coords = Array.isArray(row.coordinates) ? row.coordinates : null;
  if (!coords || coords.length < 3 || !coords.every(isFinitePoint)) return null;
  const name = row.Instructor?.name?.trim();
  if (!name) return null;
  return {
    id: row.id,
    instructorId: row.instructor_id,
    // `name` is the authoritative Instructor.name, so downstream name lookups
    // are exact matches and no spelling-alias table is needed on this path.
    name,
    rawName: row.raw_name?.trim() || name,
    kind: "polygon",
    coords: coords as GeoPoint[],
  };
}

/**
 * Loads every instructor service-area polygon. ~70 rows / ~40 KB, so this is a
 * single cheap query rather than a per-instructor fetch, and it is cached for
 * the lifetime of the module (the roster can be large).
 *
 * Returns a flat array ordered by instructor name then creation time. Callers
 * that need "all zones for this instructor" should use `groupZonesByInstructor`
 * rather than assuming one row per instructor.
 */
export async function fetchDbZones(force = false): Promise<DbZone[]> {
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;

  const epoch = cacheEpoch;
  const run = (async () => {
    const { data, error } = await supabase
      .from("instructor_service_zones")
      .select("id,instructor_id,coordinates,raw_name,Instructor(name)")
      .eq("kind", "polygon");
    if (error) throw error;

    const out: DbZone[] = [];
    for (const row of (data ?? []) as unknown as ZoneRow[]) {
      const zone = toDbZone(row);
      if (zone) out.push(zone);
    }
    // Stale read: a write landed while this was in flight. Return the rows to
    // this caller (so an in-progress render is not left empty) but do not let
    // them become the cached value.
    if (epoch === cacheEpoch) cache = out;
    return out;
  })();

  inflight = run;
  try {
    return await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}

/** Call after saving/deleting a zone so the next fetch sees the change. */
export function invalidateDbZoneCache(): void {
  cache = null;
  companyCache = null;
  // Invalidate any read already in flight. It was issued before this write, so
  // when it resolves its rows are stale; bumping the epoch stops it from
  // installing itself as `cache` (and therefore from being served to the
  // caller's post-write refetch, which is what made a saved edit look like it
  // had snapped back). Clearing the handle cannot cancel that request — it
  // just stops the next fetch from joining the stale run.
  cacheEpoch += 1;
  inflight = null;
}

/**
 * True when a database error is `UNIQUE(instructor_id)` rejecting a second
 * polygon for an instructor who already has one.
 *
 * There is deliberately no "does this DB support multiple zones?" probe. Under
 * the one-polygon rule a 23505 here always means "this instructor already has a
 * service area", so it is translated into actionable copy rather than surfacing
 * a raw constraint name.
 */
export function isDuplicateZoneError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

/** Actionable copy when a second polygon is attempted for one instructor. */
export const DUPLICATE_ZONE_MESSAGE =
  "This instructor already has a service area. An instructor has one polygon — " +
  "edit the existing one instead of adding another.";

/**
 * Creates the instructor's service-area polygon. Only valid for an instructor
 * who does not have one yet; `UNIQUE(instructor_id)` rejects a second.
 */
export async function insertZone(params: {
  instructorId: string;
  coordinates: GeoPoint[];
  rawName?: string | null;
  description?: string | null;
}): Promise<DbZone> {
  const { data, error } = await supabase
    .from("instructor_service_zones")
    .insert({
      instructor_id: params.instructorId,
      kind: "polygon",
      // The generated types declare `coordinates` as `Json`, which does not
      // structurally admit a GeoPoint[] literal. This is the same cast the
      // original one-zone upsert used; toDbZone re-validates the shape on the
      // way out.
      coordinates: params.coordinates as unknown as never,
      raw_name: params.rawName ?? null,
      description: params.description ?? null,
    })
    .select("id,instructor_id,coordinates,raw_name,Instructor(name)")
    .single();
  if (error) {
    if (isDuplicateZoneError(error)) {
      throw new Error(DUPLICATE_ZONE_MESSAGE);
    }
    throw error;
  }

  const zone = toDbZone(data as unknown as ZoneRow);
  if (!zone) throw new Error("Saved zone came back malformed.");
  invalidateDbZoneCache();
  return zone;
}

/** Updates ONE zone in place, addressed by its primary key. */
export async function updateZoneById(params: {
  zoneId: string;
  coordinates: GeoPoint[];
  rawName?: string | null;
  description?: string | null;
}): Promise<DbZone> {
  const patch: {
    coordinates?: never;
    raw_name?: string | null;
    description?: string | null;
  } = {
    coordinates: params.coordinates as unknown as never,
  };
  if (params.rawName !== undefined) patch.raw_name = params.rawName;
  if (params.description !== undefined) patch.description = params.description;

  const { data, error } = await supabase
    .from("instructor_service_zones")
    .update(patch)
    .eq("id", params.zoneId)
    .select("id,instructor_id,coordinates,raw_name,Instructor(name)")
    .single();
  if (error) throw error;

  const zone = toDbZone(data as unknown as ZoneRow);
  if (!zone) throw new Error("Updated zone came back malformed.");
  invalidateDbZoneCache();
  return zone;
}

/**
 * Deletes the instructor's polygon, addressed by its primary key. Filtering on
 * `id` rather than `instructor_id` guarantees the delete touches exactly the row
 * the admin selected, even if the invariant were ever relaxed.
 */
export async function deleteZoneById(zoneId: string): Promise<void> {
  const { error } = await supabase
    .from("instructor_service_zones")
    .delete()
    .eq("id", zoneId);
  if (error) throw error;
  invalidateDbZoneCache();
}

/**
 * Ops sanity check, called from the sales dashboard after zones load.
 *
 * A company instructor with a polygon is the one way they could ever be
 * auto-assigned, so surface it loudly instead of failing silently.
 */
export function warnOnCompanyInstructorZones(
  zones: DbZone[],
  flaggedIds: ReadonlySet<string> | null,
): void {
  if (!import.meta.env.DEV) return;
  const bad = zones.filter(
    (z) =>
      flaggedIds?.has(z.instructorId) === true ||
      (isCompanyInstructor(z.name) &&
        !isCompanyInstructorId(z.instructorId, flaggedIds)),
  );
  if (!bad.length) return;
  console.warn(
    `[zones-db] company instructor(s) have a service-area polygon: ${bad
      .map((z) => z.name)
      .join(", ")}. They are excluded from location matching, but a backup ` +
      "instructor should not have a polygon at all — Ops assigns them by hand.",
  );
}
