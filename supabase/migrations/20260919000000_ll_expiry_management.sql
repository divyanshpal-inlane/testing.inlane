-- Automatic expiry management for the LL/DL pipeline.
-- Expiry stages have no forward transition; Ops restarts them via the audited
-- ll_revert_application RPC.

CREATE OR REPLACE FUNCTION public.ll_enforce_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  kind := nullif(current_setting('ll.transition_kind', true), '');
  IF kind = 'revert' THEN RETURN NEW; END IF;
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

REVOKE ALL ON FUNCTION public.ll_expire_scrutiny() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ll_expire_scrutiny() TO service_role;
REVOKE ALL ON FUNCTION public.ll_process_expiries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ll_process_expiries() TO service_role;

-- Existing versions exposed this SECURITY DEFINER RPC too broadly. Require
-- either the service role or a signed-in admin/team member with ll_pipeline.
CREATE OR REPLACE FUNCTION public.ll_revert_application(
  p_application_id uuid,
  p_to_status text,
  p_clear_fields jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cols text;
  sql text;
  jwt_phone text := auth.jwt()->>'phone';
  allowed_clear text[] := ARRAY[
    'application_number','application_date','batch_code','scrutiny_approved_date',
    'll_number','ll_issue_date','ll_expiry_date','ll_type','ll_matures_at',
    'dl_preferred_date','dl_preferred_rto','dl_application_number','dl_application_date',
    'dl_test_date','dl_test_time','dl_test_rto','dl_test_rto_address',
    'dl_number','dl_expiry_date','dl_dispatch_eta','dl_tracking_ref'
  ];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT (
    EXISTS (
      SELECT 1 FROM public."Admin" a
      WHERE (a.id = auth.uid() OR (
        jwt_phone IS NOT NULL
        AND right(regexp_replace(a.phone, '[^0-9]', '', 'g'), 10)
          = right(regexp_replace(jwt_phone, '[^0-9]', '', 'g'), 10)
      ))
      AND (
        a.is_super_admin = true
        OR EXISTS (
          SELECT 1 FROM public.admin_permissions ap
          WHERE ap.admin_id = a.id AND ap.permission = 'll_pipeline'
        )
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public."User" u
      JOIN public.user_permissions up ON up.user_id = u.id
      WHERE jwt_phone IS NOT NULL
        AND right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 10)
          = right(regexp_replace(jwt_phone, '[^0-9]', '', 'g'), 10)
        AND up.permission = 'll_pipeline'
    )
  ) THEN
    RAISE EXCEPTION 'Access denied: LL pipeline permission required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ll_applications WHERE id = p_application_id
  ) THEN
    RAISE EXCEPTION 'LL application not found';
  END IF;

  IF p_to_status IS NULL OR p_to_status NOT IN (
    'payment_received', 'docs_link_sent', 'docs_submitted', 'docs_under_review',
    'meet_booking_enabled', 'appointment_booked', 'rto_application_generated',
    'govt_payment_pending', 'application_ready', 'in_scrutiny_queue',
    'assigned_to_runner', 'submitted_at_rto', 'waiting_rto_verification',
    'll_test_enabled', 'll_test_passed', 'll_approval_pending', 'll_issued',
    'ob_form_enabled', 'classes_in_progress', 'll_maturing', 'll_matured',
    'dl_date_selection', 'dl_date_preference_received', 'dl_otp_required',
    'dl_test_scheduled', 'dl_results_pending', 'dl_test_passed',
    'dl_number_generated', 'dl_delivery_pending'
  ) THEN
    RAISE EXCEPTION 'Invalid LL revert target: %', p_to_status;
  END IF;

  PERFORM set_config('ll.transition_kind', 'revert', true);
  sql := 'UPDATE public.ll_applications SET status = $1, updated_at = now(), '
    || 'escalated = CASE WHEN status IN (''ll_expired'', ''scrutiny_expired'') THEN false ELSE escalated END, '
    || 'escalation_reason = CASE WHEN status IN (''ll_expired'', ''scrutiny_expired'') THEN NULL ELSE escalation_reason END';
  IF p_clear_fields IS NOT NULL AND p_clear_fields <> '{}'::jsonb THEN
    SELECT string_agg(format('%I = NULL', key), ', ') INTO cols
    FROM jsonb_object_keys(p_clear_fields) AS key
    WHERE key = ANY (allowed_clear);
    IF cols IS NOT NULL AND cols <> '' THEN sql := sql || ', ' || cols; END IF;
  END IF;
  sql := sql || ' WHERE id = $2';
  EXECUTE sql USING p_to_status, p_application_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ll_revert_application(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ll_revert_application(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.ll_revert_application(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ll_revert_application(uuid, text, jsonb) TO service_role;

-- Replace the old scrutiny-only daily job with the combined sweep.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('ll-expire-scrutiny');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Old scrutiny-expiry cron was not present: %', SQLERRM;
    END;
    PERFORM cron.schedule(
      'll-process-expiries', '30 21 * * *', 'SELECT public.ll_process_expiries()'
    );
  END IF;
END;
$$;
