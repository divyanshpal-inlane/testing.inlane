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
  /**
   * A provisional boundary drawn during onboarding, pending Ops review.
   *
   * Rough zones are NOT serviceability zones and must never reach customer- or
   * sales-facing matching. `fetchDbZones` excludes them by default, so the safe
   * behaviour is the default one and a new caller cannot leak them by omission.
   */
  isRough: boolean;
}

interface ZoneRow {
  id: string;
  instructor_id: string;
  coordinates: unknown;
  raw_name: string | null;
  /** Absent until migration 20261001_100000 is applied. */
  is_rough?: boolean | null;
  Instructor: { name: string } | null;
}

/**
 * Columns every zone read needs. `is_rough` is opt-in (see
 * `selectZoneColumns`) so a not-yet-migrated database still returns real
 * polygons instead of 400-ing the whole dashboard.
 */
const ZONE_COLUMNS_BASE =
  "id,instructor_id,coordinates,raw_name,Instructor(name)";

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
    isRough: row.is_rough === true,
  };
}

/**
 * Runs a zone read, retrying without `is_rough` when the column is missing.
 *
 * `is_rough` arrives with migration 20261001_100000, which is DDL and therefore
 * manual-apply only. If the frontend shipped first, PostgREST would reject the
 * whole select with 42703/PGRST204 and the sales dashboard — plus the zone
 * map — would show nothing. Retrying degrades to "no rough zones exist yet",
 * which is exactly correct for a database that has never stored one, so the app
 * can be deployed ahead of the migration. Never throws for this reason.
 */
async function selectZones(
  columns: string,
): Promise<{ data: ZoneRow[] | null; error: unknown }> {
  // `Instructor(name)` cannot be expressed in the generated types here — the
  // zone table's `Relationships` is empty, so supabase-js types the embed as a
  // relation error. Cast at the boundary rather than loosening the client.
  const run = (cols: string) =>
    supabase
      .from("instructor_service_zones")
      .select(cols)
      .eq("kind", "polygon") as unknown as Promise<{
      data: unknown;
      error: unknown;
    }>;

  const first = (await run(columns)) as {
    data: ZoneRow[] | null;
    error: unknown;
  };
  if (!first.error || first.data) return first;
  if (!columns.includes("is_rough")) return first;
  if (import.meta.env.DEV) {
    console.warn(
      "[zones-db] could not read instructor_service_zones.is_rough; treating " +
        "every polygon as a verified service area. Apply " +
        "supabase/migrations/20261001_100000_add_rough_polygon_flag.sql",
    );
  }
  return (await run(ZONE_COLUMNS_BASE)) as {
    data: ZoneRow[] | null;
    error: unknown;
  };
}

/**
 * Loads instructor service-area polygons. ~70 rows / ~40 KB, so this is a
 * single cheap query rather than a per-instructor fetch, and it is cached for
 * the lifetime of the module (the roster can be large).
 *
 * The module cache deliberately holds EVERY polygon, rough included, and the
 * `includeRough` filter is applied to the returned copy. Filtering after the
 * cache rather than before it means toggling the Zone Map's "Show Rough
 * Polygons" switch never re-queries, and there is still only one shape of row
 * in memory. Each call returns a fresh array, so a caller sorting or mutating
 * the result cannot corrupt the cache.
 *
 * `includeRough` defaults to FALSE. Rough polygons are provisional onboarding
 * boundaries, not serviceability zones, so the sales dashboard and every other
 * matching consumer must be able to call this plainly and be guaranteed not to
 * see one. Only the Zone Map opts in.
 *
 * Returns a flat array ordered by instructor name then creation time.
 */
export async function fetchDbZones(
  options: { includeRough?: boolean } | boolean = {},
  force = false,
): Promise<DbZone[]> {
  const includeRough =
    typeof options === "boolean" ? options : options.includeRough === true;
  const all = await fetchAllDbZones(force);
  return includeRough ? all : all.filter((z) => !z.isRough);
}

/** Every polygon, rough or verified. Prefer {@link fetchDbZones}. */
async function fetchAllDbZones(force = false): Promise<DbZone[]> {
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;

  const epoch = cacheEpoch;
  const run = (async () => {
    const { data, error } = await selectZones(`${ZONE_COLUMNS_BASE},is_rough`);
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
 * True when a write failed because migration 20261001_100000 has not been
 * applied yet. 42703 is `undefined_column`; PostgREST reports the same condition
 * as PGRST204 on the embedded `Instructor(name)` select.
 *
 * Only a write that *rejected the rough flag* should be retried or reported:
 * see {@link canDegradeWrite} for why a verified save is allowed to fall back and
 * a rough save is not.
 */
export function isMissingRoughColumnError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  // A bare 42703/PGRST204 is not enough on its own — it can name any column.
  // Require that the message actually implicate is_rough when there is a
  // message, so an unrelated schema problem is never silently retried.
  if (/is_rough/i.test(message)) return true;
  if (message) return false;
  return code === "42703" || code === "PGRST204";
}

/**
 * Whether a write may be retried without `is_rough` after a missing-column
 * error.
 *
 * ASYMMETRIC ON PURPOSE. The two cases must not be treated alike:
 *
 *   - `isRough === true` → NEVER degrade. Dropping the flag would store a rough
 *     boundary as a VERIFIED serviceability zone, so real customers could be
 *     auto-matched to an instructor Ops has never confirmed covers them. That is
 *     the exact harm the rough-polygon concept exists to prevent, so this fails
 *     loudly with actionable copy instead.
 *   - `isRough === false`/absent → safe to degrade. On a database that has never
 *     had the column there is no way to store a rough polygon at all, so every
 *     existing row is already a verified service area. Retrying without the
 *     column therefore stores exactly the intended state, and it keeps the
 *     existing "edit a polygon" path working during the window between deploying
 *     the frontend and manually applying the DDL.
 */
function canDegradeWrite(isRough: boolean | undefined): boolean {
  return isRough !== true;
}

/** Actionable copy when a ROUGH save is attempted before the migration exists. */
export const MISSING_ROUGH_COLUMN_MESSAGE =
  "Could not save the rough polygon: the database is missing " +
  "instructor_service_zones.is_rough, and saving without it would store an " +
  "unverified boundary as a real service area. Apply " +
  "supabase/migrations/20261001_100000_add_rough_polygon_flag.sql and retry.";

/** Re-throws a raw PostgREST error as actionable copy where we can. */
function rethrowZoneWriteError(
  error: unknown,
  isRough: boolean | undefined,
): never {
  if (isDuplicateZoneError(error)) throw new Error(DUPLICATE_ZONE_MESSAGE);
  if (isMissingRoughColumnError(error)) {
    throw new Error(
      canDegradeWrite(isRough)
        ? `Missing instructor_service_zones.is_rough (apply ` +
          `supabase/migrations/20261001_100000_add_rough_polygon_flag.sql): ${error}`
        : MISSING_ROUGH_COLUMN_MESSAGE,
    );
  }
  throw error;
}

/**
 * Creates the instructor's service-area polygon. Only valid for an instructor
 * who does not have one yet; `UNIQUE(instructor_id)` rejects a second.
 */
export async function insertZone(params: {
  instructorId: string;
  coordinates: GeoPoint[];
  rawName?: string | null;
  description?: string | null;
  /** Mark this boundary as rough/provisional (default false). */
  isRough?: boolean;
}): Promise<DbZone> {
  const row = {
    instructor_id: params.instructorId,
    kind: "polygon",
    // The generated types declare `coordinates` as `Json`, which does not
    // structurally admit a GeoPoint[] literal. This is the same cast the
    // original one-zone upsert used; toDbZone re-validates the shape on the
    // way out.
    coordinates: params.coordinates as unknown as never,
    raw_name: params.rawName ?? null,
    description: params.description ?? null,
  };
  const withFlag = { ...row, is_rough: params.isRough === true };
  const withoutFlag = row;

  let res = await supabase
    .from("instructor_service_zones")
    .insert(withFlag)
    .select(`${ZONE_COLUMNS_BASE},is_rough`)
    .single();
  if (
    res.error &&
    isMissingRoughColumnError(res.error) &&
    canDegradeWrite(params.isRough)
  ) {
    res = await supabase
      .from("instructor_service_zones")
      .insert(withoutFlag)
      .select(ZONE_COLUMNS_BASE)
      .single();
  }
  if (res.error) rethrowZoneWriteError(res.error, params.isRough);

  const zone = toDbZone(res.data as unknown as ZoneRow);
  if (!zone) throw new Error("Saved zone came back malformed.");
  invalidateDbZoneCache();
  return zone;
}

/** Updates ONE zone in place, addressed by its primary key. */
export async function updateZoneById(params: {
  zoneId: string;
  /**
   * Omit to leave the geometry untouched. Promotion (rough -> verified) passes
   * nothing, so it flips `is_rough` without rewriting `coordinates` — a
   * promotion must not restate the stored ring, or a round-trip through
   * `closeRing`/JSON could quietly alter an Ops-drawn boundary.
   */
  coordinates?: GeoPoint[];
  rawName?: string | null;
  description?: string | null;
  /**
   * Explicitly re-stamp the rough flag. Pass `false` to promote a rough
   * boundary to a verified service area; pass `true` to send a refined-on-
   * screen polygon back to provisional.
   */
  isRough?: boolean;
}): Promise<DbZone> {
  const patch: {
    /**
     * `never` rather than `GeoPoint[]`: PostgREST's generated type widens
     * `coordinates` to `Json`, and this is the one assignment that bridges the
     * two. The `never` makes the whole patch structurally assignable to the
     * generated update body without a cast at the call site.
     */
    coordinates?: never;
    raw_name?: string | null;
    description?: string | null;
    is_rough?: boolean;
  } = {};
  if (params.coordinates !== undefined) {
    patch.coordinates = params.coordinates as unknown as never;
  }
  if (params.rawName !== undefined) patch.raw_name = params.rawName;
  if (params.description !== undefined) patch.description = params.description;
  // Always sent when the caller states it, including `false`: an Ops edit that
  // refines a rough boundary into the real one has to clear the flag, and
  // omitting the key would leave is_rough = true behind.
  if (params.isRough !== undefined) patch.is_rough = params.isRough;

  const runUpdate = (body: typeof patch, columns: string) =>
    supabase
      .from("instructor_service_zones")
      .update(body)
      .eq("id", params.zoneId)
      .select(columns)
      .single();

  let res = await runUpdate(patch, `${ZONE_COLUMNS_BASE},is_rough`);
  if (
    res.error &&
    isMissingRoughColumnError(res.error) &&
    canDegradeWrite(params.isRough)
  ) {
    // Pre-migration database: retry without the column. See canDegradeWrite —
    // this is only reached when the row is being saved as verified. Rebuilt by
    // dropping the flag rather than re-listing the other keys, so an optional
    // `coordinates` cannot leak into this retry as `undefined`.
    const rest: typeof patch = { ...patch };
    delete rest.is_rough;
    res = await runUpdate(rest, ZONE_COLUMNS_BASE);
  }
  if (res.error) rethrowZoneWriteError(res.error, params.isRough);

  const zone = toDbZone(res.data as unknown as ZoneRow);
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
