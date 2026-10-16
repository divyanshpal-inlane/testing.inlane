-- Widen reschedule_requests.lesson_ids from UUID[] to TEXT[].
-- Reason: post-demo/topup flows enqueue virtual lesson ids like
-- "virtual-lesson-1" so the admin CreateSchedule flow knows to synthesize
-- N mock lessons. These are not UUIDs, so the previous column type rejected
-- the insert with 22P02 / HTTP 400.

-- Drop the dependent function first so the column type change can succeed.
DROP FUNCTION IF EXISTS calculate_reschedule_fee(UUID[]);

ALTER TABLE "reschedule_requests"
  ALTER COLUMN lesson_ids TYPE TEXT[] USING lesson_ids::TEXT[];

-- Recreate with TEXT[] input. Real lesson ids are still UUIDs in practice;
-- we cast per element so the existing query stays correct, and rows with
-- non-UUID virtual ids simply contribute no fee (the Schedule lookup will
-- miss, which is the intended behavior for virtual placeholders).
CREATE OR REPLACE FUNCTION calculate_reschedule_fee(lesson_ids TEXT[])
RETURNS DECIMAL AS $$
DECLARE
  total_fee DECIMAL := 0;
  lid TEXT;
  lid_uuid UUID;
BEGIN
  FOREACH lid IN ARRAY lesson_ids
  LOOP
    BEGIN
      lid_uuid := lid::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      CONTINUE; -- skip virtual placeholders
    END;

    IF EXISTS (
      SELECT 1 FROM "Schedule"
      WHERE lesson_id = lid_uuid
      AND is_within_72_hours(date, start_time::TIME)
    ) THEN
      total_fee := total_fee + 300;
    END IF;
  END LOOP;

  RETURN total_fee;
END;
$$ LANGUAGE plpgsql;
