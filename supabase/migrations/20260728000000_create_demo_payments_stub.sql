-- STUB TABLE for demo-payments (local development only)
-- 
-- Context: The production database at csnzgfzxnscumvjefpon.supabase.co has a
-- demo-payments table that was created manually (not via migrations). This stub
-- allows local Supabase to run without errors when the subsequent migration
-- 20260728000100 tries to ALTER TABLE demo-payments.
--
-- The demo-payments table is used by:
-- - demo-page-payment Edge Function (inserts payment records from book-demo.inlane.in)
-- - demo-page-forward-lead Edge Function (reads payment records to forward leads to Cratio CRM)
--
-- This stub creates the minimum schema needed. The attribution columns
-- (utm_source, utm_medium, etc.) are intentionally omitted here because they
-- are added by migration 20260728000100_add_attribution_to_demo_payments.sql

CREATE TABLE IF NOT EXISTS "public"."demo-payments" (
    "id" UUID DEFAULT gen_random_uuid() NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "amount" NUMERIC(10,2),
    "hasDrivingLicense" BOOLEAN,
    "area" TEXT,
    CONSTRAINT "demo-payments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."demo-payments" OWNER TO "postgres";

COMMENT ON TABLE "public"."demo-payments" IS 'Payment records from demo booking page at book-demo.inlane.in (stub for local development; production table exists at csnzgfzxnscumvjefpon.supabase.co)';
