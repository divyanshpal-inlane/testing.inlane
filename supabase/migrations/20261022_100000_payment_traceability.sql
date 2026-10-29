-- Payment traceability: unique Payment ID, payment -> service link, payment link log.
--
-- MANUAL APPLY (SQL editor / psql). Apply BEFORE deploying the frontend that
-- uses it.
--
-- This migration adds no manual-entry columns. Payments taken outside the link
-- (cash / UPI / bank transfer, with an image proof) are added by the separate
-- 20261026_100000_manual_payment_proof.sql.
--
-- Fully additive and revertable (see the ROLLBACK block at the bottom). No
-- existing column or row is modified, and no UPDATE is run on `payment`, so
-- payment.updated_at (used by the payment tracker) is untouched.
--
-- What it adds
--   payment.reference_id   Unique, human-readable Payment ID (PAY-XXXXXXXXXXXX).
--                          GENERATED from the row id, so EVERY payment (old and
--                          new) has one with no backfill and no edge-function
--                          change.
--   payment.enrollment_id  The enrollment (service) this payment is for. Filled
--                          by a trigger from enrollment.payment_id, which the
--                          payment functions already set.
--   payment_link_log       One row per payment link the team sends or copies.

DO $$
BEGIN
  IF to_regprocedure('public.is_admin_or_team_member()') IS NULL THEN
    RAISE EXCEPTION
      'Required helper public.is_admin_or_team_member() is missing. Apply 20260809_fix_kam_rls_policies.sql first.';
  END IF;
END;
$$;

-- 1. payment columns -------------------------------------------------------

-- NO foreign key on purpose. enrollment.payment_id already references payment,
-- so a second FK in the other direction makes PostgREST refuse every
-- `enrollment ... payment (...)` embed (PGRST201 "more than one relationship"),
-- which broke Learner Management, Half-paid tracker etc. on 2026-10-26. Keep it
-- a plain column.
ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS enrollment_id uuid;

-- If an earlier version of this migration created the FK, remove it.
ALTER TABLE public.payment DROP CONSTRAINT IF EXISTS payment_enrollment_id_fkey;

-- Generated columns do not fire triggers and do not touch updated_at.
-- 12 hex chars (~2.8e14 values) keeps collision odds negligible at this volume.
ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS reference_id text
  GENERATED ALWAYS AS (
    'PAY-' || upper(substr(replace(id::text, '-', ''), 1, 12))
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_reference_id
  ON public.payment (reference_id);
CREATE INDEX IF NOT EXISTS idx_payment_enrollment_id
  ON public.payment (enrollment_id);

COMMENT ON COLUMN public.payment.reference_id IS
  'Unique human-readable Payment ID derived from id. Quote this when checking a payment.';

-- 2. Link payments to their enrollment ---------------------------------------
-- The payment edge functions set enrollment.payment_id but not
-- payment.enrollment_id. This trigger fills the reverse link (first link wins,
-- so a later second-installment payment keeps its own enrollment too).

CREATE OR REPLACE FUNCTION public.link_payment_to_enrollment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_id IS NOT NULL THEN
    UPDATE public.payment
       SET enrollment_id = NEW.id
     WHERE id = NEW.payment_id
       AND enrollment_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_payment_to_enrollment ON public.enrollment;
CREATE TRIGGER trg_link_payment_to_enrollment
  AFTER INSERT OR UPDATE OF payment_id ON public.enrollment
  FOR EACH ROW
  EXECUTE FUNCTION public.link_payment_to_enrollment();

-- 3. Payment link log ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_link_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_code text GENERATED ALWAYS AS (
    'LNK-' || upper(substr(replace(id::text, '-', ''), 1, 10))
  ) STORED,
  learner_id uuid NOT NULL REFERENCES public."Learner" (id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES public.enrollment (id) ON DELETE SET NULL,
  service_type text NOT NULL,           -- course | topup | other (licence)
  service_label text,
  amount numeric(10, 2),
  url text NOT NULL,
  sent_by text,
  channel text NOT NULL DEFAULT 'send',   -- send (e-mail + WhatsApp) | copy (link copied by hand)
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_link_log_channel_check CHECK (channel IN ('send', 'copy'))
);

CREATE INDEX IF NOT EXISTS idx_payment_link_log_learner
  ON public.payment_link_log (learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_link_log_enrollment
  ON public.payment_link_log (enrollment_id);

ALTER TABLE public.payment_link_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_link_log_admin_all ON public.payment_link_log;
CREATE POLICY payment_link_log_admin_all ON public.payment_link_log
  FOR ALL TO authenticated
  USING (public.is_admin_or_team_member())
  WITH CHECK (public.is_admin_or_team_member());

-- 4. Integrity for payment.enrollment_id WITHOUT a foreign key.
-- (A real FK makes PostgREST reject every enrollment -> payment embed, see the
-- note on the column above. Triggers are invisible to PostgREST.)

-- 1. Deleting an order clears the pointer on its payments (what ON DELETE SET
--    NULL would have done).
CREATE OR REPLACE FUNCTION public.clear_payment_enrollment_on_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $
BEGIN
  UPDATE public.payment
     SET enrollment_id = NULL
   WHERE enrollment_id = OLD.id;
  RETURN OLD;
END;
$;

DROP TRIGGER IF EXISTS trg_clear_payment_enrollment_on_delete ON public.enrollment;
CREATE TRIGGER trg_clear_payment_enrollment_on_delete
  BEFORE DELETE ON public.enrollment
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_payment_enrollment_on_delete();

-- 2. A payment can only point at an order that exists (what the FK check did).
CREATE OR REPLACE FUNCTION public.check_payment_enrollment_exists()
RETURNS trigger
LANGUAGE plpgsql
AS $
BEGIN
  IF NEW.enrollment_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.enrollment WHERE id = NEW.enrollment_id) THEN
    RAISE EXCEPTION 'payment.enrollment_id % does not match any enrollment', NEW.enrollment_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS trg_check_payment_enrollment_exists ON public.payment;
CREATE TRIGGER trg_check_payment_enrollment_exists
  BEFORE INSERT OR UPDATE OF enrollment_id ON public.payment
  FOR EACH ROW
  WHEN (NEW.enrollment_id IS NOT NULL)
  EXECUTE FUNCTION public.check_payment_enrollment_exists();

-- ROLLBACK (manual) -----------------------------------------------------------
-- DROP TRIGGER IF EXISTS trg_check_payment_enrollment_exists ON public.payment;
-- DROP TRIGGER IF EXISTS trg_clear_payment_enrollment_on_delete ON public.enrollment;
-- DROP FUNCTION IF EXISTS public.check_payment_enrollment_exists();
-- DROP FUNCTION IF EXISTS public.clear_payment_enrollment_on_delete();
-- DROP TRIGGER IF EXISTS trg_link_payment_to_enrollment ON public.enrollment;
-- DROP FUNCTION IF EXISTS public.link_payment_to_enrollment();
-- DROP TABLE IF EXISTS public.payment_link_log;
-- ALTER TABLE public.payment
--   DROP COLUMN IF EXISTS reference_id, DROP COLUMN IF EXISTS enrollment_id;
