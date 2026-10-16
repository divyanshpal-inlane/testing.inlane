-- Three-way instructor status: active / on_break / inactive.
--
-- "On Break" tracks temporary unavailability (leave, travel) without treating
-- the instructor as churned. It is informational only — On Break instructors
-- stay bookable. The existing "enabled" boolean remains the booking gate used
-- by all scheduling pickers and is kept in sync by the admin UI:
--   inactive -> enabled = false; active / on_break -> enabled = true.
ALTER TABLE "public"."Instructor"
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

-- Backfill from the current binary state.
UPDATE "public"."Instructor" SET "status" = 'inactive' WHERE "enabled" = false;

ALTER TABLE "public"."Instructor"
DROP CONSTRAINT IF EXISTS "instructor_status_check";
ALTER TABLE "public"."Instructor"
ADD CONSTRAINT "instructor_status_check"
CHECK ("status" IN ('active', 'on_break', 'inactive'));

COMMENT ON COLUMN "public"."Instructor"."status" IS 'active | on_break | inactive. on_break is informational (still bookable); enabled stays the booking gate and is synced by the admin UI.';

-- Audit trail of manual status changes (who, when, what transition).
CREATE TABLE IF NOT EXISTS "public"."instructor_status_log" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "instructor_id" UUID NOT NULL REFERENCES "public"."Instructor"("id_instructor") ON DELETE CASCADE,
    "old_status" TEXT,
    "new_status" TEXT NOT NULL,
    "changed_by" TEXT,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_instructor_status_log_instructor"
ON "public"."instructor_status_log" ("instructor_id", "changed_at" DESC);

ALTER TABLE "public"."instructor_status_log" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read instructor_status_log" ON "public"."instructor_status_log";
CREATE POLICY "Anyone can read instructor_status_log"
ON "public"."instructor_status_log" FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage instructor_status_log" ON "public"."instructor_status_log";
CREATE POLICY "Admins manage instructor_status_log"
ON "public"."instructor_status_log" FOR ALL USING (EXISTS (
    SELECT 1 FROM "Admin" WHERE "Admin".phone = auth.jwt()->>'phone'
    AND ("Admin".is_admin = true OR "Admin".is_super_admin = true)
));
