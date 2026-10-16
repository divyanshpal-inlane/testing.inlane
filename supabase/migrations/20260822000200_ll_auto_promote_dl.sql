-- V1 item 9: auto-promote to DL date selection when
--   * classes track: completed lessons >= total_lessons - 1
--     AND today is on/after LL maturity and on/before LL expiry
--   * direct-DL track: ll_maturing → ll_matured when ll_matures_at <= today
--
-- Returns the rows that were moved so callers can send WhatsApp.

CREATE OR REPLACE FUNCTION public.ll_auto_promote_dl(
  p_learner_id uuid DEFAULT NULL
)
RETURNS TABLE (
  application_id uuid,
  learner_id uuid,
  from_status text,
  to_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
  v_total integer;
  v_completed integer;
  v_to text;
  v_note text;
BEGIN
  -- 1. Direct-DL: maturity date reached
  FOR r IN
    SELECT a.id, a.learner_id, a.status
    FROM public.ll_applications a
    WHERE a.status = 'll_maturing'
      AND a.ll_matures_at IS NOT NULL
      AND a.ll_matures_at <= CURRENT_DATE
      AND (p_learner_id IS NULL OR a.learner_id = p_learner_id)
  LOOP
    UPDATE public.ll_applications
    SET status = 'll_matured', updated_at = now()
    WHERE id = r.id;

    INSERT INTO public.ll_pipeline_events
      (application_id, learner_id, event_type, from_status, to_status, actor_name, note)
    VALUES
      (r.id, r.learner_id, 'status_change', r.status, 'll_matured',
       'System',
       'LL matured — auto-promoted so the customer can pick a DL test date');

    application_id := r.id;
    learner_id := r.learner_id;
    from_status := r.status;
    to_status := 'll_matured';
    RETURN NEXT;
  END LOOP;

  -- 2. With-classes: (total − 1) lessons done, inside maturity → expiry window
  FOR r IN
    SELECT a.id, a.learner_id, a.status, a.ll_matures_at, a.ll_expiry_date
    FROM public.ll_applications a
    WHERE a.status = 'classes_in_progress'
      AND a.ll_matures_at IS NOT NULL
      AND a.ll_matures_at <= CURRENT_DATE
      AND a.ll_expiry_date IS NOT NULL
      AND CURRENT_DATE <= a.ll_expiry_date
      AND (p_learner_id IS NULL OR a.learner_id = p_learner_id)
  LOOP
    SELECT COALESCE(
      (
        SELECT c.total_lessons::integer
        FROM public.enrollment e
        JOIN public."Courses" c ON c.id = e.course_id
        WHERE e.learner_id = r.learner_id
          AND e.status = 'active'
          AND e.course_id IS NOT NULL
        ORDER BY e.created_at DESC
        LIMIT 1
      ),
      (
        SELECT COUNT(*)::integer
        FROM public."Schedule" s
        WHERE s.learner_id = r.learner_id
          AND s.status IS DISTINCT FROM 'paused'
      )
    )
    INTO v_total;

    SELECT COUNT(*)::integer
    INTO v_completed
    FROM public."Schedule" s
    WHERE s.learner_id = r.learner_id
      AND s.status = 'completed';

    IF v_total IS NULL OR v_total <= 0 THEN
      CONTINUE;
    END IF;

    -- Promote at total classes − 1 (and beyond).
    IF v_completed < (v_total - 1) THEN
      CONTINUE;
    END IF;

    v_to := 'dl_date_selection';
    v_note := format(
      'Auto-promoted after %s/%s classes (threshold: total − 1) within LL maturity window',
      v_completed,
      v_total
    );

    UPDATE public.ll_applications
    SET status = v_to, updated_at = now()
    WHERE id = r.id;

    INSERT INTO public.ll_pipeline_events
      (application_id, learner_id, event_type, from_status, to_status, actor_name, note)
    VALUES
      (r.id, r.learner_id, 'status_change', r.status, v_to, 'System', v_note);

    application_id := r.id;
    learner_id := r.learner_id;
    from_status := r.status;
    to_status := v_to;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.ll_auto_promote_dl(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ll_auto_promote_dl(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ll_auto_promote_dl(uuid) TO anon;

-- Daily sweep (with maturity promotions + any missed class promotions).
-- 21:35 UTC ≈ 03:05 IST — just after ll_expire_scrutiny.
DO $do$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable: %', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('ll-auto-promote-dl');
    EXCEPTION WHEN OTHERS THEN
      NULL; -- job may not exist yet
    END;
    PERFORM cron.schedule(
      'll-auto-promote-dl',
      '35 21 * * *',
      'SELECT public.ll_auto_promote_dl()'
    );
  END IF;
END;
$do$;
