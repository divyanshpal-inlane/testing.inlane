-- Customer submission of the LL details/documents form moves directly to
-- docs_under_review. The form is linked from earlier stages, so this move
-- must not depend on an ops-set segregation route.
CREATE OR REPLACE FUNCTION public.ll_is_allowed_status_transition(
  p_from text,
  p_to text,
  p_batch_code text
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_from IS NOT DISTINCT FROM p_to THEN
    RETURN false;
  END IF;

  -- Submitting (or resubmitting) the customer form is a single transition
  -- into review, regardless of the current route or link-delivery stage.
  IF p_to = 'docs_under_review'
     AND p_from IN (
       'payment_received',
       'docs_link_sent',
       'docs_submitted',
       'docs_rejected'
     ) THEN
    RETURN true;
  END IF;

  IF p_from = 'll_test_enabled' AND p_to IN ('meet_booking_enabled', 'scrutiny_expired') THEN
    RETURN true;
  END IF;
  IF p_from = 'scrutiny_expired' AND p_to = 'meet_booking_enabled' THEN
    RETURN true;
  END IF;

  IF public.ll_recover_target(p_from) = p_to THEN
    RETURN true;
  END IF;

  IF p_to = ANY (public.ll_failure_targets(p_from, p_batch_code)) THEN
    RETURN true;
  END IF;

  IF p_to = ANY (public.ll_advance_targets(p_from, p_batch_code)) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;
