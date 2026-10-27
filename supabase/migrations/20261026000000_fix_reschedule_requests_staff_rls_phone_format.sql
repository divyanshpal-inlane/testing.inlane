-- Schedule Management showed "New Schedules 0 / Reschedule Requests 0" for team
-- members ("User" rows) while super admins saw the real numbers.
--
-- Cause: the staff policies on reschedule_requests compared phones as exact text,
--   "User".phone = auth.jwt() ->> 'phone'
-- but a team member's stored phone and the phone in their login token differ in
-- format (e.g. stored '+917021257084' vs token '7021257084'; 50 of 50 team users
-- and 3 admins were affected), so no row ever matched and everything was hidden.
--
-- Fix: use public.is_admin_or_team_member(), which matches the last 10 digits
-- (and the Admin uuid), exactly like the other staff-facing policies.
-- The helper is wrapped in (SELECT ...) so Postgres evaluates it ONCE per query
-- (an initplan) instead of once per row: called bare, it made a learner's query
-- over this 5k-row table hit the statement timeout.
-- Learner-facing policies on this table are untouched. Re-running is safe.

DO $$
BEGIN
  IF to_regprocedure('public.is_admin_or_team_member()') IS NULL THEN
    RAISE EXCEPTION 'Required helper public.is_admin_or_team_member() is missing.';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Admins and team members can view all reschedule requests"
  ON public.reschedule_requests;
CREATE POLICY "Admins and team members can view all reschedule requests"
  ON public.reschedule_requests FOR SELECT
  USING ((SELECT public.is_admin_or_team_member()));

DROP POLICY IF EXISTS "Admins and team members can manage all reschedule requests"
  ON public.reschedule_requests;
CREATE POLICY "Admins and team members can manage all reschedule requests"
  ON public.reschedule_requests FOR ALL
  USING ((SELECT public.is_admin_or_team_member()))
  WITH CHECK ((SELECT public.is_admin_or_team_member()));
