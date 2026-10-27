-- Manual payment entry with an image proof (cash / UPI / bank transfer taken
-- outside the payment link).
--
-- MANUAL APPLY (SQL editor / psql). Apply AFTER 20261022_100000_payment_traceability.sql
-- and BEFORE deploying the `record-manual-payment` edge function + frontend.
--
-- Fully additive and revertable (ROLLBACK block at the bottom).
--
-- What it adds
--   payment.source          'gateway' (default, every existing row) | 'manual'
--   payment.method          cash | upi | bank_transfer | card | other (manual only)
--   payment.utr             UTR / transaction / receipt number (manual only)
--   payment.paid_on         date the money was actually received (manual only)
--   payment.proof_path      object path in the private `payment-proofs` bucket
--   payment.recorded_by     name of the staff member who entered it
--   payment.recorded_by_id  auth user id of that staff member (set by the function)
--   payment.manual_note     free text
--   storage bucket `payment-proofs` (PRIVATE; staff upload and read via signed URL)

DO $$
BEGIN
  IF to_regprocedure('public.is_admin_or_team_member()') IS NULL THEN
    RAISE EXCEPTION
      'Required helper public.is_admin_or_team_member() is missing. Apply 20260809_fix_kam_rls_policies.sql first.';
  END IF;
END;
$$;

ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'gateway',
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS utr text,
  ADD COLUMN IF NOT EXISTS paid_on date,
  ADD COLUMN IF NOT EXISTS proof_path text,
  ADD COLUMN IF NOT EXISTS recorded_by text,
  ADD COLUMN IF NOT EXISTS recorded_by_id uuid,
  ADD COLUMN IF NOT EXISTS manual_note text;

ALTER TABLE public.payment
  DROP CONSTRAINT IF EXISTS payment_source_check;
ALTER TABLE public.payment
  ADD CONSTRAINT payment_source_check CHECK (source IN ('gateway', 'manual'));

-- A manual payment must carry its proof and method.
ALTER TABLE public.payment
  DROP CONSTRAINT IF EXISTS payment_manual_has_proof_check;
ALTER TABLE public.payment
  ADD CONSTRAINT payment_manual_has_proof_check
  CHECK (source <> 'manual' OR (proof_path IS NOT NULL AND method IS NOT NULL))
  NOT VALID;

CREATE INDEX IF NOT EXISTS idx_payment_source ON public.payment (source)
  WHERE source = 'manual';

-- Private proof bucket (images only, 5 MB).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs', 'payment-proofs', false, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS payment_proofs_staff_insert ON storage.objects;
CREATE POLICY payment_proofs_staff_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs' AND public.is_admin_or_team_member());

DROP POLICY IF EXISTS payment_proofs_staff_select ON storage.objects;
CREATE POLICY payment_proofs_staff_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.is_admin_or_team_member());

-- No UPDATE / DELETE policy on purpose: a proof, once filed, cannot be swapped
-- or removed by the team (the edge function removes its own file with the
-- service role if the payment fails).

-- ROLLBACK (manual) -----------------------------------------------------------
-- DROP POLICY IF EXISTS payment_proofs_staff_insert ON storage.objects;
-- DROP POLICY IF EXISTS payment_proofs_staff_select ON storage.objects;
-- (empty the bucket in the dashboard, then) DELETE FROM storage.buckets WHERE id = 'payment-proofs';
-- ALTER TABLE public.payment
--   DROP CONSTRAINT IF EXISTS payment_manual_has_proof_check,
--   DROP CONSTRAINT IF EXISTS payment_source_check,
--   DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS method, DROP COLUMN IF EXISTS utr,
--   DROP COLUMN IF EXISTS paid_on, DROP COLUMN IF EXISTS proof_path,
--   DROP COLUMN IF EXISTS recorded_by, DROP COLUMN IF EXISTS recorded_by_id,
--   DROP COLUMN IF EXISTS manual_note;
