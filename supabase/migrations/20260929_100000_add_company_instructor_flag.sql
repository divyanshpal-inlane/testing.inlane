-- Marks instructors who are Ops-assigned backups rather than sales inventory.
--
-- Context: company instructors must never be returned by automatic area
-- matching. Until now that was enforced by a hardcoded name list in
-- src/lib/sales-dashboard/company-instructors.ts, which fails silently if an
-- instructor is renamed or a third backup is added. This column makes the rule
-- data-driven and rename-proof.
--
-- Run in the Supabase SQL editor or via psql. Idempotent.

ALTER TABLE public."Instructor"
  ADD COLUMN IF NOT EXISTS is_company_instructor boolean NOT NULL DEFAULT false;

-- Backfill the two current company instructors. Matched on lower(btrim(name))
-- so casing / surrounding-whitespace variants present in the table are caught.
UPDATE public."Instructor"
   SET is_company_instructor = true
 WHERE lower(btrim(name)) IN ('amanulla khan', 'krupakar daniel dennish');

COMMENT ON COLUMN public."Instructor".is_company_instructor IS
  'True for in-house backup instructors assigned manually by Ops. Must be excluded from automatic area matching (see src/lib/sales-dashboard/company-instructors.ts).';
