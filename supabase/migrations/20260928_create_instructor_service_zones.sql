-- Instructor service zones
-- Adds:
--   1. instructor_service_zones table — per-instructor service-area geometry
--      (polygon rings and single-point markers) as JSONB coordinate arrays.
--
-- Purpose: replace the runtime dependency on public/instructors.kml for the
-- Sales Dashboard "search by location" flow, and let ops draw/edit zones
-- in-app during instructor onboarding instead of re-exporting Google My Maps.
--
-- This migration is SCHEMA ONLY. It creates an empty table and inserts no
-- rows — the KML backfill is a separate, deliberate step.
--
-- Relationship: KML file (static)            -> this table (source of truth)
--               Instructor.areas text[]       -> untouched, still the
--                                                learner-facing match input
--               Serviceable_Areas (taxonomy)  -> untouched, area-name list
--
-- RLS: admins AND team members (ops) may read and write, because the drawing
-- UI lives in the onboarding flow which ops staff use. Authorization reuses
-- public.is_admin_or_team_member() from 20260809_fix_kam_rls_policies.sql,
-- which already normalises the E.164-vs-10-digit phone mismatch.

-- Fail fast with an actionable message if the required RLS helper is absent
-- (i.e. an earlier migration was not applied to this database).
DO $$
BEGIN
  IF to_regprocedure('public.is_admin_or_team_member()') IS NULL THEN
    RAISE EXCEPTION
      'Required helper public.is_admin_or_team_member() is missing. Apply 20260809_fix_kam_rls_policies.sql before this migration.';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.instructor_service_zones (
  -- uuid (not bigint identity) to match every other table added to this
  -- project since the initial schema dump (KAM, kam_instructor, ...).
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  instructor_id uuid NOT NULL
    REFERENCES public."Instructor"(id_instructor) ON DELETE CASCADE,

  -- 'polygon' rows hold a ring in draw order (KML repeats the first point
  -- last; that is preserved as-is so a backfilled row is byte-identical to
  -- the file it came from). 'point' rows hold a single marker coordinate.
  kind text NOT NULL DEFAULT 'polygon'
    CHECK (kind IN ('polygon', 'point')),

  -- [{lat, lng}, ...]. No default and NOT NULL: a zone row without geometry
  -- is meaningless, so the writer must always supply coordinates.
  coordinates jsonb NOT NULL,

  -- Original placemark name from the KML export, kept for audit/debugging.
  raw_name text,

  -- KML <description> free text (timings / vehicle / languages), unused by the
  -- app today but preserved so the backfill is lossless.
  description text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- AND short-circuits, so jsonb_array_length is never reached for a
  -- non-array value. A polygon needs >= 3 vertices; a point needs exactly 1.
  CONSTRAINT instructor_service_zones_coordinates_valid CHECK (
    jsonb_typeof(coordinates) = 'array'
    AND jsonb_array_length(coordinates) > 0
    AND (
      (kind = 'point'   AND jsonb_array_length(coordinates) = 1)
      OR (kind = 'polygon' AND jsonb_array_length(coordinates) >= 3)
    )
  )
);

-- Primary access pattern is "the zone for this instructor" (drawing UI edit,
-- backfill verification, and per-instructor zone rendering).
-- UNIQUE (not a plain index) because the drawing UI saves with
-- upsert(onConflict: 'instructor_id'), which needs a unique conflict target.
-- This also serves the same lookups the plain index did, so it replaces it.
DROP INDEX IF EXISTS public.idx_instructor_service_zones_instructor_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_instructor_service_zones_instructor_id
  ON public.instructor_service_zones (instructor_id);

-- updated_at maintenance, reusing the project's existing trigger function.
DROP TRIGGER IF EXISTS trg_instructor_service_zones_updated_at
  ON public.instructor_service_zones;
CREATE TRIGGER trg_instructor_service_zones_updated_at
  BEFORE UPDATE ON public.instructor_service_zones
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- RLS ---------------------------------------------------------------------
-- The client is the anon-key supabase-js instance (src/lib/supabaseClient.ts),
-- so privileges alone would expose the table to anyone with the public key.
-- Policies below are the actual gate; anon is revoked outright.
ALTER TABLE public.instructor_service_zones ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.instructor_service_zones FROM anon;
GRANT ALL ON public.instructor_service_zones TO authenticated;
GRANT ALL ON public.instructor_service_zones TO service_role;

DROP POLICY IF EXISTS "Admins and team members can view instructor zones"
  ON public.instructor_service_zones;
CREATE POLICY "Admins and team members can view instructor zones"
  ON public.instructor_service_zones
  FOR SELECT
  USING (public.is_admin_or_team_member());

-- Ops staff draw new zones during onboarding and edit pre-existing ones, so
-- write access is intentionally available to team members, not just admins.
DROP POLICY IF EXISTS "Admins and team members can create instructor zones"
  ON public.instructor_service_zones;
CREATE POLICY "Admins and team members can create instructor zones"
  ON public.instructor_service_zones
  FOR INSERT
  WITH CHECK (public.is_admin_or_team_member());

DROP POLICY IF EXISTS "Admins and team members can update instructor zones"
  ON public.instructor_service_zones;
CREATE POLICY "Admins and team members can update instructor zones"
  ON public.instructor_service_zones
  FOR UPDATE
  USING (public.is_admin_or_team_member())
  WITH CHECK (public.is_admin_or_team_member());

DROP POLICY IF EXISTS "Admins and team members can delete instructor zones"
  ON public.instructor_service_zones;
CREATE POLICY "Admins and team members can delete instructor zones"
  ON public.instructor_service_zones
  FOR DELETE
  USING (public.is_admin_or_team_member());
