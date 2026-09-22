-- Milestone guards (mirrors src/constants/llPipeline.ts):
--   * After LL test passed → no scrutiny_expired (manual or cron).
--   * After DL test passed → no scrutiny_expired or automatic ll_expired.

ALTER TABLE public.ll_applications
  ADD COLUMN IF NOT EXISTS ll_test_passed_achieved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dl_test_passed_achieved boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ll_applications.ll_test_passed_achieved IS
  'Set when status first reaches ll_test_passed; never cleared on Ops revert.';
COMMENT ON COLUMN public.ll_applications.dl_test_passed_achieved IS
  'Set when status first reaches dl_test_passed; never cleared on Ops revert.';

UPDATE public.ll_applications a
SET ll_test_passed_achieved = true
WHERE NOT a.ll_test_passed_achieved
  AND EXISTS (
    SELECT 1
    FROM public.ll_pipeline_events e
    WHERE e.application_id = a.id
      AND e.event_type = 'status_change'
      AND e.to_status = 'll_test_passed'
  );

UPDATE public.ll_applications a
SET dl_test_passed_achieved = true
WHERE NOT a.dl_test_passed_achieved
  AND EXISTS (
    SELECT 1
    FROM public.ll_pipeline_events e
    WHERE e.application_id = a.id
      AND e.event_type = 'status_change'
      AND e.to_status = 'dl_test_passed'
  );

UPDATE public.ll_applications
SET ll_test_passed_achieved = true
WHERE NOT ll_test_passed_achieved AND status = 'll_test_passed';

UPDATE public.ll_applications
SET dl_test_passed_achieved = true
WHERE NOT dl_test_passed_achieved
  AND status IN (
    'dl_test_passed',
    'dl_number_generated',
    'dl_delivery_pending',
    'dl_not_delivered',
    'dl_delivered'
  );

CREATE OR REPLACE FUNCTION public.ll_track_pipeline_milestones() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.ll_test_passed_achieved :=
      OLD.ll_test_passed_achieved OR (NEW.status = 'll_test_passed');
    NEW.dl_test_passed_achieved :=
      OLD.dl_test_passed_achieved OR (NEW.status = 'dl_test_passed');
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ll_track_pipeline_milestones ON public.ll_applications;
CREATE TRIGGER trg_ll_track_pipeline_milestones
  BEFORE UPDATE ON public.ll_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.ll_track_pipeline_milestones();

CREATE OR REPLACE FUNCTION public.ll_expire_scrutiny() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE moved integer := 0; r record;
BEGIN
  PERFORM set_config('ll.transition_kind', 'expiry', true);
  FOR r IN
    SELECT id, learner_id, status, scrutiny_expiry_date
    FROM public.ll_applications
    WHERE status = 'll_test_enabled'
      AND scrutiny_expiry_date IS NOT NULL
      AND scrutiny_expiry_date < CURRENT_DATE
      AND NOT ll_test_passed_achieved
      AND NOT dl_test_passed_achieved
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.ll_applications
    SET status = 'scrutiny_expired',
        escalated = true,
        escalation_reason = format(
          'RTO scrutiny expired on %s — revert the stage to restart the application',
          r.scrutiny_expiry_date
        ),
        updated_at = now()
    WHERE id = r.id AND status = r.status;
    IF FOUND THEN
      INSERT INTO public.ll_pipeline_events
        (application_id, learner_id, event_type, from_status, to_status, actor_name, note)
      VALUES
        (r.id, r.learner_id, 'status_change', r.status, 'scrutiny_expired', 'System',
         format('RTO scrutiny expired on %s — Ops must revert the stage to restart the application',
           r.scrutiny_expiry_date));
      moved := moved + 1;
    END IF;
  END LOOP;
  RETURN moved;
END;
$$;

CREATE OR REPLACE FUNCTION public.ll_process_expiries() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE scrutiny_moved integer := 0; ll_moved integer := 0; r record;
BEGIN
  scrutiny_moved := public.ll_expire_scrutiny();
  PERFORM set_config('ll.transition_kind', 'expiry', true);
  FOR r IN
    SELECT id, learner_id, status, ll_expiry_date
    FROM public.ll_applications
    WHERE ll_expiry_date IS NOT NULL
      AND ll_expiry_date < CURRENT_DATE
      AND NOT dl_test_passed_achieved
      AND status IN (
        'll_issued', 'ob_form_enabled', 'classes_in_progress', 'll_maturing',
        'll_matured', 'dl_date_selection', 'dl_date_preference_received',
        'dl_otp_required', 'dl_test_scheduled', 'dl_test_missed',
        'dl_results_pending', 'dl_test_failed'
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.ll_applications
    SET status = 'll_expired',
        escalated = true,
        escalation_reason = format(
          'Learner''s Licence expired on %s — revert the stage to restart the application',
          r.ll_expiry_date
        ),
        updated_at = now()
    WHERE id = r.id AND status = r.status;
    IF FOUND THEN
      INSERT INTO public.ll_pipeline_events
        (application_id, learner_id, event_type, from_status, to_status, actor_name, note)
      VALUES
        (r.id, r.learner_id, 'status_change', r.status, 'll_expired', 'System',
         format('Learner''s Licence expired on %s — Ops must revert the stage before processing can continue',
           r.ll_expiry_date));
      ll_moved := ll_moved + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('scrutiny_expired', scrutiny_moved, 'll_expired', ll_moved);
END;
$$;

CREATE OR REPLACE FUNCTION public.ll_enforce_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  kind := nullif(current_setting('ll.transition_kind', true), '');
  IF kind = 'revert' THEN RETURN NEW; END IF;

  IF NEW.status = 'scrutiny_expired'
     AND (NEW.ll_test_passed_achieved OR NEW.dl_test_passed_achieved)
     AND kind IS DISTINCT FROM 'expiry' THEN
    RAISE EXCEPTION
      'Cannot move to scrutiny_expired after LL or DL test has been passed (application %)',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF kind = 'expiry' AND NEW.status IN ('scrutiny_expired', 'll_expired') THEN
    RETURN NEW;
  END IF;
  IF NOT public.ll_is_allowed_status_transition(
    OLD.status, NEW.status, COALESCE(NEW.batch_code, OLD.batch_code)
  ) THEN
    RAISE EXCEPTION 'Illegal LL status transition % → % for route %',
      OLD.status, NEW.status, COALESCE(NEW.batch_code, OLD.batch_code, 'unset')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
