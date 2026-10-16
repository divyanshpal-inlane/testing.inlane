-- Add 'demo', 'custom', and 'topup' to payment_type enum.
-- 'demo' and 'custom' were already used in application code; adding them
-- formally closes a data-integrity gap. 'topup' is new in the post-demo flow.
ALTER TYPE "public"."payment_type" ADD VALUE IF NOT EXISTS 'demo';
ALTER TYPE "public"."payment_type" ADD VALUE IF NOT EXISTS 'custom';
ALTER TYPE "public"."payment_type" ADD VALUE IF NOT EXISTS 'topup';
