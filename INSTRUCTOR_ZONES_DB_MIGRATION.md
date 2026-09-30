# Instructor Location Zones: Current Storage & DB Migration Plan

> **STATUS (2026-09-30): mostly shipped. Sections 1-6 below are the original plan and are kept as the design rationale — read them as history, not as instructions. For what is actually true now:**
>
> - **Table is live.** `instructor_service_zones` exists (`supabase/migrations/20260928_create_instructor_service_zones.sql`) and is the only read path. Sales Dashboard matching is **polygon-only**: `src/lib/sales-dashboard/zones-db.ts` loads rings from Postgres and `SalesDashboard.locMatch` ray-casts them with `pointInPolygon()`. There is **no proximity/centroid fallback** — it was deliberately deleted because it told users a proximity search happened when it never did.
> - **`public/instructors.kml` is backfill input only.** It is never fetched by the app (verified: 0 requests). `KML_ALIASES` / `matchLocation()` / `PROXIMITY_RADIUS_KM` are off the read path; `resolveInstructorName()` survives only for the backfill/audit scripts.
> - **One polygon per instructor.** `UNIQUE(instructor_id)` is the authoritative invariant (see below), enforced by the DB. Writes are `insertZone` (first polygon) / `updateZoneById` / `deleteZoneById` in `zones-db.ts`, **keyed on the zone row's primary key** — not an upsert on `instructor_id`.
> - **No `DrawingManager`.** The standard polygon-drawing library caused a white-screen crash and was dropped. `src/components/instructor-zones/ZoneDrawingEditor.tsx` draws by listening for map clicks and offers coordinate entry, per-vertex numeric editing, midpoint insertion, and undo/redo. Saved rings use Google's native editable handles.
> - **Editing surfaces**: the Instructor Service Zone Map (`/admin/instructor-zone-map`, `src/routes/admin/InstructorZoneMap.tsx`) is the primary authoring UI; `instructors.tsx` (Edit Details) and the onboarding wizard's Service Area step also write.
> - **Live data**: 131 `Instructor` rows; `instructor_service_zones` holds 67 rows, all `kind='polygon'`, 0 instructors with more than one. Verify with `node scripts/verify-instructor-service-zones.mjs` (dry run, exits 1 on drift).
>
> Section 7 (PostGIS) remains a genuine future plan and is still accurate.

## 1. Original state (static KML file)

- **File**: `public/instructors.kml` (~150KB, 137 `<Placemark>` entries: 68 polygons + 69 points), exported from Google My Maps.
- **Parser**: `src/lib/sales-dashboard/kml.ts`
  - `fetchKmlData()` — fetches the file, parses XML, extracts one `KmlZone` per Placemark: `{ name (normalized), rawName, kind: "polygon"|"point", coords: {lat,lng}[] }`. Cached in-memory (`cachedZones` module var) after first load.
  - Each instructor typically has **two** Placemarks: a `Point` (marker) and a `Polygon` (service area boundary), same `name`. Polygon `<description>` has free-text (timings/vehicle/languages) that is **not parsed** today — dropped.
  - `pointInPolygon()` (ray-casting) / `haversineKm()` — pure math, no DB/API calls.
  - `matchLocation(zones, point)` — polygon match first, falls back to nearest point within `PROXIMITY_RADIUS_KM` (3km).
  - `KML_ALIASES` — hardcoded map fixing ~14 known spelling mismatches between the KML placemark names and real `Instructor.name` values (e.g. `"adnan"` → `"adnan shama"`).
  - `resolveInstructorName(kmlName, dbNames)` — looks up the (possibly aliased) KML name against a `Set` of normalized DB instructor names.
- **Used only by**: Sales Dashboard's "Search by location" (`SalesDashboard.tsx` + `LocationSearch.tsx`). Loaded once on mount via `Promise.all([fetchKmlData(), loadInstructorIndex()])`. Also used to draw polygons/markers on the Google Map in `LocationSearch.tsx` (same `zones` array, both matching and rendering).
- **Separate, unrelated mechanisms** (for context — not touched by this plan):
  - `Instructor.areas: string[]` — flat exact-name list, used by the real learner-facing direct-booking engine (`src/lib/sales-dashboard/availability.ts::hasArea()`).
  - `Instructor.latitude/longitude` + `Instructor.radius` (km) — haversine fallback in the same engine (`withinRadius()`).
  - Neither of these two is polygon-based or wired to the KML file. The Sales Dashboard's location search is the _only_ consumer of KML polygons today.

**Pain points with the file-based approach**: any zone edit requires re-exporting from Google My Maps and redeploying; name mismatches only caught by manually maintaining `KML_ALIASES`; no per-instructor CRUD UI; not queryable/joinable; whole 150KB file re-fetched by every dashboard load.

**Two known data-quality issues to carry into the migration, not introduce there**:

1. Counts don't pair evenly: 69 points vs 68 polygons — at least one instructor has only one of the two placemarks. Not a bug to fix now, just don't assume 1:1 pairing when writing the backfill script.
2. `dbByName` (`SalesDashboard.tsx`) is built with `if (!map.has(key)) map.set(key, i)` — if two instructors normalize to the same name, the _first_ one in the query result silently wins; the KML zone can never resolve to the second. Check for duplicate normalized `Instructor.name` values before backfilling (`select name, count(*) from "Instructor" group by name having count(*) > 1`) — the migration is a natural point to surface/fix this ambiguity rather than carry it forward unexamined.

## 2. Target design

New dedicated table (normalized, FK to `Instructor` — removes the fuzzy name-matching entirely since the link becomes a real foreign key, resolved once at migration time instead of on every lookup):

```sql
create table instructor_service_zones (
  id bigint generated always as identity primary key,
  instructor_id uuid not null references "Instructor"(id_instructor) on delete cascade,
  kind text not null check (kind in ('polygon', 'point')),
  -- [{lat, lng}, ...] in ring order (open or closed, matching KML's own
  -- convention of repeating the first point last); single-element for points.
  coordinates jsonb not null,
  raw_name text,          -- original KML placemark name, kept for audit/debugging
  description text,       -- optional: the KML polygon's free-text description
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on instructor_service_zones (instructor_id);

alter table instructor_service_zones enable row level security;
-- Matches this app's existing model: no per-user Supabase Auth session exists
-- for admin tools (anon key + app-layer role checks), so RLS here mirrors
-- Instructor/Schedule's existing anon-permissive policies rather than
-- inventing a stricter one this app can't otherwise enforce.
create policy "anon can read instructor zones"
  on instructor_service_zones for select
  to anon, authenticated
  using (true);
create policy "anon can write instructor zones"
  on instructor_service_zones for all
  to anon, authenticated
  using (true) with check (true);
```

**Why JSONB coordinates, not PostGIS**: 137 zones is tiny; client-side ray-casting (`pointInPolygon`) already runs in <1ms and needs zero infra changes. PostGIS (`geography(Polygon)`, `ST_Contains`) would let matching move server-side (smaller payload, indexable spatial queries) but requires enabling a new extension and rewriting `matchLocation` as SQL/RPC — worth doing later if zone count grows into the hundreds/thousands or search moves to the learner-facing app; not needed for this migration.

## 3. Data migration steps (one-time bootstrap of existing KML data)

1. **Run the new migration SQL** above manually in the Supabase SQL editor (per this project's existing manual-migration convention — see `sql/override_tentative_slot.sql` for the pattern).
2. **One-off backfill script** (Node, mirrors `tests/backend-suite.mjs`'s connection pattern):
   - Parse `public/instructors.kml` with the existing `kml.ts` logic (reuse `fetchKmlData`'s parsing — extract into a shared function callable from Node, or duplicate the ~30 lines of DOM parsing using `jsdom`).
   - For each `KmlZone`, resolve `instructor_id` via `resolveInstructorName(zone.name, dbNormNames)` (reuse as-is) against a fresh `select id_instructor, name from "Instructor"` query.
   - Insert one row per zone with the resolved `instructor_id`, `kind`, `coordinates` (map `{lat,lng}[]` → JSONB as-is), `raw_name`.
   - The `description` column needs a small parser addition — `kml.ts` currently only reads `name`/`Polygon`/`Point`, never `<description>` (see section 1). Add one line to the backfill script's own parsing pass (not `kml.ts` itself, since the live app never needed this field): `pm.querySelector("description")?.textContent`. Without this the column is added but stays null for every row.
   - **Log every unresolved zone name** (no match even after `KML_ALIASES`) to a report — these need manual reconciliation (likely a handful, same ones the current alias list doesn't cover) before/after migration; do not silently drop them.
3. **Verify row counts**: `select count(*) from instructor_service_zones` should equal `137 - (unresolved count)`; spot-check 3-5 instructors' polygons against the map visually.

## 4. Code changes (after data is verified in the DB)

- `src/lib/sales-dashboard/kml.ts`: replace `fetchKmlData()`'s `fetch(...)` + XML parse with a Supabase query (`select instructor_id, kind, coordinates, raw_name from instructor_service_zones`), mapping rows back into the same `KmlZone`-shaped array (`name` becomes unnecessary — return `instructor_id` directly instead of a name needing later resolution). Keep `pointInPolygon`, `haversineKm`, `matchLocation` untouched (pure functions, storage-agnostic).
- `SalesDashboard.tsx`: since zones now carry `instructor_id` directly, **delete** the `resolveInstructorName`/`dbNormNames`/`KML_ALIASES` fuzzy-matching step in the `locMatch` memo — it becomes a direct `Map` lookup by id. This is a net simplification, not just a swap.
- `LocationSearch.tsx`: no change (still consumes `zones: KmlZone[]`, just sourced differently upstream).
- Keep `public/instructors.kml` in the repo (not deleted) for one release cycle as a rollback reference, then remove — superseded once section 6 ships (no file left to fall back to at all).

## 5. Rollout & rollback

- **Rollout**: apply migration SQL → run backfill script → resolve any unmatched names → flip `kml.ts` to query the DB (single PR) → verify Sales Dashboard location search live against 3-5 known addresses → remove the KML file in a follow-up PR once confirmed stable for a few days.
- **Rollback**: revert the `kml.ts`/`SalesDashboard.tsx` PR (file-based path still works unchanged, since the file isn't deleted until the follow-up); the new table can stay unused with no harm.

## 6. Making it fully dynamic (admin draws/edits zones in-app — no more KML ever)

**Direct answer**: yes, DB — not a file. A file can never be admin-editable at runtime (any edit needs a re-export + redeploy); the DB table from section 2 already removes that entirely once wired up. **Is it scalable?** For this use case, yes: ~70-150 instructors today, realistically growing to maybe a few hundred — a JSONB polygon (10-20 points, a few hundred bytes) per row, matched client-side in under 1ms, has no scaling ceiling worth worrying about until zone count reaches the thousands or matching needs to run server-side (PostGIS note in section 2 — still not needed here).

### 6.1 Drawing UI

Google Maps JS API is already loaded in this app (`src/utils/googleMaps.ts`, which injects the script itself — do **not** reintroduce `@googlemaps/js-api-loader`'s `Loader`, whose v1 `__onCallback` never fires on the `v=weekly` bootstrap). Note `window.google.maps` exists as an _empty_ namespace before classes attach, so readiness must check `typeof gm.Map === "function"`; components needing extra classes call `loadMaps(["Polygon", "Circle"])`. ~~The `drawing` library (`google.maps.drawing.DrawingManager`, the standard polygon-draw tool) isn't loaded yet.~~ **Superseded**: `DrawingManager` was tried and caused a white-screen crash, so it is deliberately not used. `ZoneDrawingEditor.tsx` draws from map clicks instead.

- **Where**: the existing per-instructor edit form in `src/routes/admin/instructors.tsx` (same dialog that already has a plain-text "areas" tag editor, around lines 900-935) — add a new "Service Area" field: a small embedded map + a "Draw service area" button.
- **Draw new**: `DrawingManager` in polygon mode → admin clicks points on the map → `overlaycomplete` event gives the finished `google.maps.Polygon` → read `.getPath()` → array of `{lat,lng}`.
- **Edit existing**: fetch the instructor's current row from `instructor_service_zones`, render it as a normal `google.maps.Polygon` with `editable: true, draggable: true` — admin drags vertices directly; listen for `path.insert_at` / `path.set_at` / `path.remove_at` on the polygon's path to capture the updated coordinate array live.
- **Save**: `insertZone()` when the instructor has no polygon yet, otherwise `updateZoneById()` addressed by the zone row's `id` (`kind: 'polygon'`) — no fuzzy name matching, no file, no redeploy. `UNIQUE(instructor_id)` guarantees exactly one polygon per instructor, so there is never a second row to create for the same person; a duplicate insert is rejected with actionable copy rather than merged. The point placemark (marker) is dropped in favour of `Instructor.latitude/longitude` (already exists) rather than a separate `kind:'point'` row. See the status note at the top for what actually shipped — notably this is **not** an upsert on `instructor_id`, and `DrawingManager` was dropped after it crashed.
- **Who can edit**: matches this app's existing model — any admin/team-member account that can already open the instructor edit dialog can save a zone (same as editing `areas`, `car_number`, etc. today); no new permission needed unless zone-editing should be gated separately (would reuse the `ADMIN_PERMISSIONS` pattern documented in `SALES_DASHBOARD_ACCESS_CONTROL.md`).

### 6.2 End state

Once 6.1 ships: `public/instructors.kml` is retired for good — not just unused, there's no "source of truth" file at all anymore. Every instructor's polygon lives in `instructor_service_zones`, editable by any admin in real time, zero manual export/import step. Sections 3-5 (backfill the _existing_ KML data once) still apply as the one-time bootstrap; after that the table is the only source of truth, and new or changed instructors are drawn directly in the app.

### 6.3 Implementation order

1. Ship sections 2-5 first (table + backfill + read-path switch) — feature keeps working exactly as today, now sourced from the DB.
2. Add `drawing` library loading + the draw/edit UI in `instructors.tsx`, writing to the same table.
3. Remove `public/instructors.kml` and the one-off backfill script — no longer needed once every zone can be created directly in-app.

## 7. Scaling past thousands of zones (PostGIS migration path)

Not needed at current/near-term scale (section 6) — this is the plan to have ready if zone count (or lookup volume) grows enough that client-side JS matching stops being the right tradeoff. Concrete trigger points, not vague "someday":

- **Zone count**: client fetches _every_ zone on load today (whole table, ~150KB-equivalent at 137 rows) so matching can run in JS. That payload scales linearly — a few thousand zones is a few MB, still fine; tens of thousands is where a full-table fetch on every dashboard load becomes the actual bottleneck, not the point-in-polygon math itself (that stays sub-millisecond per check regardless of table size, since you're only ever testing one point against however many zones are already in memory).
- **Query volume**: if location search moves beyond the admin Sales Dashboard into a learner-facing, high-traffic flow (many concurrent lookups/sec), server-side spatial indexing starts mattering even at moderate zone counts, because now it's about not re-shipping the whole zone table to every client, not just about local compute time.

Either trigger → move matching server-side with PostGIS:

1. **Enable the extension** (Supabase supports it as a standard add-on): `create extension if not exists postgis;` — first time this project would use it (confirmed no existing migration does).
2. **Add a geometry column** alongside the existing JSONB one (dual-write during transition, don't drop `coordinates` yet):
   ```sql
   alter table instructor_service_zones add column geom geography(Polygon, 4326);
   -- One-off backfill from the existing JSONB for every row:
   update instructor_service_zones
   set geom = ST_SetSRID(ST_GeomFromGeoJSON(
     json_build_object('type','Polygon','coordinates',
       json_build_array(coordinates))::text), 4326)::geography
   where kind = 'polygon';
   create index on instructor_service_zones using gist (geom);
   ```
3. **Move matching into an RPC** (same pattern this repo already uses for `override_tentative_slot` — a Postgres function called via `supabase.rpc(...)`), so the client sends one `{lat,lng}` point instead of downloading every zone:
   ```sql
   create or replace function match_instructor_zones(p_lat double precision, p_lng double precision)
   returns table(instructor_id uuid) language sql stable as $$
     select instructor_id from instructor_service_zones
     where kind = 'polygon'
       and ST_Contains(geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography::geometry);
   $$;
   ```
   `ST_Contains` uses the new GiST index automatically — O(log n) instead of scanning every zone in JS.
4. **Update `matchLocation`'s call site** (`SalesDashboard.tsx`'s `locMatch` memo): replace the client-side `matchLocation(zones, point)` call with `supabase.rpc("match_instructor_zones", {...})`; `pointInPolygon`/`haversineKm` in `kml.ts` become dead code at that point (fine to delete, or keep as a documented fallback path).
5. **Point/proximity fallback** (today's `PROXIMITY_RADIUS_KM` nearest-point logic) becomes `ST_DWithin(geom, point, radius_meters)` on a `geography(Point, 4326)` column, same GiST index serves both.
6. **Cut over, then drop the JSONB column** once the RPC path is verified against the same 3-5 known addresses used in section 5's rollout check.

This is a pure backend/read-path swap — the section 6 admin drawing UI doesn't change at all (it can keep writing plain `{lat,lng}` JSONB; step 2's `ST_GeomFromGeoJSON` backfill/trigger keeps `geom` in sync, or write both columns directly from the save handler once this ships).

## 8. Out of scope (noted, not part of this plan)

- Unifying this with `Instructor.areas`/`radius` (the separate learner-facing mechanism) — a bigger, separate architectural decision.
