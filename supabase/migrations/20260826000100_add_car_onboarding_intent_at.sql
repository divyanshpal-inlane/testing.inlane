-- When a learner signals car-buying intent during onboarding, stamp the
-- exact time. Kept separate from car_intent_updated_at so instructor
-- feedback later does not overwrite the original onboarding capture.
ALTER TABLE "public"."Learner"
ADD COLUMN IF NOT EXISTS "car_onboarding_intent_at" TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN "public"."Learner"."car_onboarding_intent_at" IS
  'When the learner first signalled car-buying intent on the onboarding form';
