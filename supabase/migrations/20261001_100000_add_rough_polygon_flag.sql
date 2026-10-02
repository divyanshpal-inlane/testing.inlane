-- Marks a service-area row as a ROUGH polygon: a provisional boundary drawn
-- during instructor onboarding that has NOT been verified by Operations.
--
-- Business rule: a rough polygon is NOT a serviceability zone. It must never
-- reach customer-facing matching (Sales Availability Dashboard, direct
-- booking), because a learner matched on an unverified boundary could be
-- assigned an instructor who does not actually cover their address.
--
-- Storage model: `idx_instructor_service_zones_instructor_id` stays UNIQUE, so
-- an instructor holds AT MOST ONE row, flagged rough or real — never both. A
-- rough polygon is a placeholder for a boundary Ops has not drawn yet, so
-- drawing the real one replaces it (the editor writes is_rough = false on that
-- same row). The unique index is deliberately preserved: it is the conflict
-- target for upsert(onConflict: 'instructor_id') used by the Zone Map, and for
-- the bare `ON CONFLICT (instructor_id) DO UPDATE` in
-- 20260930_010000_update_arokia_bhanu_zone_from_suresh_babu_kmz.sql and in
-- scripts/verify-instructor-service-zones.mjs's migration replay. Relaxing it
-- would break all three.
--
-- Backward compatible: DEFAULT false means all 66 existing backfilled polygons
-- are real serviceability zones with no data rewrite. No existing row is
-- modified, and no legacy row is deleted.

ALTER TABLE public.instructor_service_zones
  ADD COLUMN IF NOT EXISTS is_rough boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.instructor_service_zones.is_rough IS
  'true = rough/provisional polygon drawn during onboarding, pending Operations review. NOT a serviceability zone: excluded from all customer-facing and sales availability matching. false = verified serviceability zone.';
