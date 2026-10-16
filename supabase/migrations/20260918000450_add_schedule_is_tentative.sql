-- Compatibility migration for projects created from the checked-in migration
-- history. Later pagination migrations already depend on this production
-- Schedule column, but its original creation was not captured in the repo.
ALTER TABLE public."Schedule"
  ADD COLUMN IF NOT EXISTS "isTentative" boolean DEFAULT false;

