-- Audit trail for payment-plan edits made on an existing learner's enrollment
-- (PRD-ADMIN-004 §5.4). Every edit to course / plan / amount via the admin
-- "Plan & Link" editor writes one append-only row here so we can answer
-- "what changed, who changed it, when" and resolve customer disputes.
--
-- Append-only by design: RLS grants INSERT + SELECT only. With RLS enabled and
-- no UPDATE/DELETE policy, those operations are denied through the API for every
-- role. (Cascade deletes triggered by removing a learner/enrollment are a
-- referential action performed by the table owner and bypass RLS, so the
-- existing "delete all learner data" admin flow keeps working.)

CREATE TABLE IF NOT EXISTS "public"."enrollment_plan_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enrollment_id" uuid REFERENCES "public"."enrollment" ("id") ON DELETE CASCADE,
  "learner_id" uuid REFERENCES "public"."Learner" ("id") ON DELETE CASCADE,
  -- Who made the edit (from useCurrentUser / the User table). Stored as plain
  -- text snapshots so the history survives even if the admin user is removed.
  "editor_id" text,
  "editor_name" text,
  -- Optional internal remark explaining the change (PRD §5.1 "Notes / Remarks").
  "reason" text,
  -- Array of { field, label, old, new } describing each changed field.
  "changes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_enrollment_plan_audit_enrollment"
  ON "public"."enrollment_plan_audit" ("enrollment_id");
CREATE INDEX IF NOT EXISTS "idx_enrollment_plan_audit_learner"
  ON "public"."enrollment_plan_audit" ("learner_id");
CREATE INDEX IF NOT EXISTS "idx_enrollment_plan_audit_created_at"
  ON "public"."enrollment_plan_audit" ("created_at" DESC);

ALTER TABLE "public"."enrollment_plan_audit" ENABLE ROW LEVEL SECURITY;

-- Append-only: insert + read allowed, no update/delete policy on purpose.
CREATE POLICY "plan_audit_insert" ON "public"."enrollment_plan_audit"
  FOR INSERT WITH CHECK (true);
CREATE POLICY "plan_audit_select" ON "public"."enrollment_plan_audit"
  FOR SELECT USING (true);

GRANT SELECT, INSERT ON "public"."enrollment_plan_audit" TO anon, authenticated;

COMMENT ON TABLE "public"."enrollment_plan_audit" IS
  'Append-only audit log of payment-plan edits on a learner enrollment (PRD-ADMIN-004).';
COMMENT ON COLUMN "public"."enrollment_plan_audit"."changes" IS
  'JSONB array of { field, label, old, new } for each changed field.';
COMMENT ON COLUMN "public"."enrollment_plan_audit"."reason" IS
  'Internal remark explaining why the plan was changed; not sent to the customer.';
