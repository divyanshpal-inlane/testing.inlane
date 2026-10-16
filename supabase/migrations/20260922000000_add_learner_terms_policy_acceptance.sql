-- REQ-0004: Persist acceptance from the learner payment/details form.
ALTER TABLE "public"."Learner"
  ADD COLUMN IF NOT EXISTS "terms_policy_accepted" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."Learner"."terms_policy_accepted" IS
  'Whether the learner accepted the Terms & Conditions and Terms Policy.';
