-- Marketing attribution for demo-page payment leads. The landing page captures
-- UTM parameters / gclid on first touch and sends them with the payment
-- request; demo-page-forward-lead later reads this row to build the
-- "payment attempted" lead for Cratio, so attribution must be persisted here
-- or paid-campaign leads get misattributed (e.g. to SEO).
ALTER TABLE "public"."demo-payments"
ADD COLUMN IF NOT EXISTS "utm_source" TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "utm_medium" TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "utm_campaign" TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "utm_term" TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "utm_content" TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "gclid" TEXT DEFAULT NULL;

COMMENT ON COLUMN "public"."demo-payments"."utm_source" IS 'Marketing attribution: utm_source captured on the landing page (e.g. google)';
COMMENT ON COLUMN "public"."demo-payments"."utm_medium" IS 'Marketing attribution: utm_medium (e.g. cpc)';
COMMENT ON COLUMN "public"."demo-payments"."utm_campaign" IS 'Marketing attribution: utm_campaign';
COMMENT ON COLUMN "public"."demo-payments"."utm_term" IS 'Marketing attribution: utm_term';
COMMENT ON COLUMN "public"."demo-payments"."utm_content" IS 'Marketing attribution: utm_content';
COMMENT ON COLUMN "public"."demo-payments"."gclid" IS 'Google Ads click id; presence implies a Paid Search lead';
