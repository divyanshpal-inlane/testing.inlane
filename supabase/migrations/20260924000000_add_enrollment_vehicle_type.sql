BEGIN;

ALTER TABLE public.enrollment
  ADD COLUMN IF NOT EXISTS vehicle_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.enrollment'::regclass
      AND conname = 'enrollment_vehicle_type_check'
  ) THEN
    ALTER TABLE public.enrollment
      ADD CONSTRAINT enrollment_vehicle_type_check
      CHECK (vehicle_type IN ('two_wheeler', 'four_wheeler'))
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.enrollment
  VALIDATE CONSTRAINT enrollment_vehicle_type_check;

COMMIT;

-- Rollback (manual, only after confirming no required vehicle data exists):
-- ALTER TABLE public.enrollment
--   DROP CONSTRAINT IF EXISTS enrollment_vehicle_type_check,
--   DROP COLUMN IF EXISTS vehicle_type;
