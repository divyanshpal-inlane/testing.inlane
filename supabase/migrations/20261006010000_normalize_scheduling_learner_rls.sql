-- Supabase phone JWTs commonly contain 91XXXXXXXXXX while Go auth and legacy
-- Learner rows may contain XXXXXXXXXX or +91XXXXXXXXXX. Exact phone equality
-- made the same learner's Save succeed in one session and fail with 42501 in
-- another. Match the trusted JWT phone by its last 10 digits, as the app does.
-- No learner data, queue entries, or admin policies are changed.
BEGIN;

-- Fail promptly if production traffic or another migration holds table locks,
-- rather than waiting until the SQL Editor disconnects. Retry the FULL script
-- later if a timeout is reported; the transaction prevents partial changes.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.current_scheduling_learner_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT l.id
  FROM public."Learner" AS l
  WHERE length(right(regexp_replace(auth.jwt() ->> 'phone', '[^0-9]', '', 'g'), 10)) = 10
    AND right(regexp_replace(l.phone, '[^0-9]', '', 'g'), 10)
      = right(regexp_replace(auth.jwt() ->> 'phone', '[^0-9]', '', 'g'), 10);
$$;

REVOKE ALL ON FUNCTION public.current_scheduling_learner_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_scheduling_learner_ids() TO authenticated;

DROP POLICY IF EXISTS "Users can view their own reschedule requests" ON public.reschedule_requests;
CREATE POLICY "Users can view their own reschedule requests"
  ON public.reschedule_requests FOR SELECT TO authenticated
  USING (learner_id IN (SELECT public.current_scheduling_learner_ids()));

DROP POLICY IF EXISTS "Users can create their own reschedule requests" ON public.reschedule_requests;
CREATE POLICY "Users can create their own reschedule requests"
  ON public.reschedule_requests FOR INSERT TO authenticated
  WITH CHECK (learner_id IN (SELECT public.current_scheduling_learner_ids()));

DROP POLICY IF EXISTS "Users can update their own reschedule requests" ON public.reschedule_requests;
CREATE POLICY "Users can update their own reschedule requests"
  ON public.reschedule_requests FOR UPDATE TO authenticated
  USING (learner_id IN (SELECT public.current_scheduling_learner_ids()))
  WITH CHECK (learner_id IN (SELECT public.current_scheduling_learner_ids()));

-- Use the same ownership rule for every step of replacing availability.
DROP POLICY IF EXISTS "Users can view their own preferences" ON public.schedule_preferences;
CREATE POLICY "Users can view their own preferences"
  ON public.schedule_preferences FOR SELECT TO authenticated
  USING (learner_id IN (SELECT public.current_scheduling_learner_ids()));

DROP POLICY IF EXISTS "Users can insert their own preferences" ON public.schedule_preferences;
CREATE POLICY "Users can insert their own preferences"
  ON public.schedule_preferences FOR INSERT TO authenticated
  WITH CHECK (learner_id IN (SELECT public.current_scheduling_learner_ids()));

DROP POLICY IF EXISTS "Users can update their own preferences" ON public.schedule_preferences;
CREATE POLICY "Users can update their own preferences"
  ON public.schedule_preferences FOR UPDATE TO authenticated
  USING (learner_id IN (SELECT public.current_scheduling_learner_ids()))
  WITH CHECK (learner_id IN (SELECT public.current_scheduling_learner_ids()));

DROP POLICY IF EXISTS "Users can delete their own preferences" ON public.schedule_preferences;
CREATE POLICY "Users can delete their own preferences"
  ON public.schedule_preferences FOR DELETE TO authenticated
  USING (learner_id IN (SELECT public.current_scheduling_learner_ids()));

COMMIT;
