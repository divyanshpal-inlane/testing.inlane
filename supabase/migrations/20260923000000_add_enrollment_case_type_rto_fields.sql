BEGIN;

ALTER TABLE public.enrollment
  ADD COLUMN IF NOT EXISTS case_type text,
  ADD COLUMN IF NOT EXISTS two_wheeler_requirement text,
  ADD COLUMN IF NOT EXISTS four_wheeler_requirement text,
  ADD COLUMN IF NOT EXISTS rto_fee numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rto_address_change_required boolean DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.enrollment'::regclass
      AND conname = 'enrollment_case_type_check'
  ) THEN
    ALTER TABLE public.enrollment
      ADD CONSTRAINT enrollment_case_type_check
      CHECK (case_type IN ('classes_only', 'rto_only', 'lessons_with_rto'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.enrollment'::regclass
      AND conname = 'enrollment_two_wheeler_requirement_check'
  ) THEN
    ALTER TABLE public.enrollment
      ADD CONSTRAINT enrollment_two_wheeler_requirement_check
      CHECK (
        two_wheeler_requirement IN ('ll', 'dl', 'll_and_dl', 'not_required')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.enrollment'::regclass
      AND conname = 'enrollment_four_wheeler_requirement_check'
  ) THEN
    ALTER TABLE public.enrollment
      ADD CONSTRAINT enrollment_four_wheeler_requirement_check
      CHECK (
        four_wheeler_requirement IN ('ll', 'dl', 'll_and_dl', 'not_required')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.enrollment'::regclass
      AND conname = 'enrollment_rto_fee_nonnegative_check'
  ) THEN
    ALTER TABLE public.enrollment
      ADD CONSTRAINT enrollment_rto_fee_nonnegative_check
      CHECK (rto_fee >= 0) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.enrollment
  VALIDATE CONSTRAINT enrollment_case_type_check;

ALTER TABLE public.enrollment
  VALIDATE CONSTRAINT enrollment_two_wheeler_requirement_check;

ALTER TABLE public.enrollment
  VALIDATE CONSTRAINT enrollment_four_wheeler_requirement_check;

ALTER TABLE public.enrollment
  VALIDATE CONSTRAINT enrollment_rto_fee_nonnegative_check;

COMMIT;

-- Rollback (manual, only after confirming no required RTO data exists):
-- ALTER TABLE public.enrollment
--   DROP CONSTRAINT IF EXISTS enrollment_rto_fee_nonnegative_check,
--   DROP CONSTRAINT IF EXISTS enrollment_four_wheeler_requirement_check,
--   DROP CONSTRAINT IF EXISTS enrollment_two_wheeler_requirement_check,
--   DROP CONSTRAINT IF EXISTS enrollment_case_type_check,
--   DROP COLUMN IF EXISTS rto_address_change_required,
--   DROP COLUMN IF EXISTS rto_fee,
--   DROP COLUMN IF EXISTS four_wheeler_requirement,
--   DROP COLUMN IF EXISTS two_wheeler_requirement,
--   DROP COLUMN IF EXISTS case_type;
