-- Schedule Management: show every learner Ops can act on, and make phone search
-- format-proof.
--
-- Two reasons a learner that exists in the database was invisible in Schedule
-- Management (get_active_learners_paginated):
--
-- 1. The learner list INNER JOINed enrollments with status = 'active'. A learner
--    with no active enrollment disappeared, including real customers:
--      * paid through ICICI but the enrollment row was never created
--        (Majji Parameswara Rao, J Arnold, Anjineyulu, Shalini Sharma), and
--      * Guruprasad GS, who has 10 classes but no enrollment.
--    The join is now a LEFT JOIN and a learner is listed when they have an
--    active enrollment OR a non-cancelled class OR a completed paid
--    (non-reschedule, amount > 0) payment. Learners who only ever started a
--    pending enrollment and never paid stay out of the list, as before.
--    Without an enrollment the course length is unknown, so the lesson total
--    falls back to the number of classes they have (minimum 1): paid-but-
--    unscheduled learners land in the Active tab, fully-taught ones in Completed.
--
-- 2. Phones are stored in several formats (10 digits, 91..., +91...), but the
--    search was a plain substring match, so "+91 89228 97499" found nothing for
--    a learner stored as 8922897499. A phone-looking search term is now reduced
--    to digits (a leading 91 on a 12-digit number is dropped) and compared with
--    the digits of the stored phone.
--
-- Read-only function; nothing in any table changes. The previous definition is
-- kept in 20261028000000_schedule_management_learner_visibility_ROLLBACK.sql.

CREATE OR REPLACE FUNCTION public.get_active_learners_paginated(
  page_offset integer DEFAULT 0,
  page_size integer DEFAULT 20,
  search_term text DEFAULT NULL::text,
  instructor_filter uuid DEFAULT NULL::uuid,
  tab_filter text DEFAULT 'active'::text
)
RETURNS TABLE(
  id uuid,
  name text,
  email text,
  phone text,
  created_at timestamp with time zone,
  area text,
  pick_up_location text,
  address_lat numeric,
  address_lng numeric,
  preferred_start_date date,
  preferred_completion_days integer,
  prefers_two_hour_classes boolean,
  two_hour_days text,
  dl_test_date date,
  is_demo boolean,
  total_lessons integer,
  completed_count integer,
  has_topup_pending boolean,
  instructor_ids uuid[],
  total_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Digits of a phone-looking search ("+91 89228 97499" -> "8922897499"); NULL
  -- for ordinary text searches so names are unaffected.
  v_phone_digits text;
BEGIN
  IF get_active_learners_paginated.search_term ~ '^[+0-9()\s.-]+$' THEN
    v_phone_digits := regexp_replace(
      get_active_learners_paginated.search_term, '\D', '', 'g');
    IF length(v_phone_digits) > 10 AND left(v_phone_digits, 2) = '91' THEN
      v_phone_digits := right(v_phone_digits, 10);
    END IF;
    IF length(v_phone_digits) < 4 THEN
      v_phone_digits := NULL;
    END IF;
  END IF;

  RETURN QUERY
  WITH enrollment_stats AS (
    SELECT
      e.learner_id,
      BOOL_OR((e.progress->>'type') = 'demo') AS is_demo,
      MAX(
        COALESCE(
          c.total_lessons,
          c.duration,
          (e.progress->>'total_hours')::INT,
          10
        )
      )::INT AS total_lessons
    FROM "enrollment" e
    LEFT JOIN "Courses" c ON e.course_id = c.id
    WHERE e.status = 'active'
    GROUP BY e.learner_id
  ),
  schedule_stats AS (
    SELECT
      s.learner_id,
      COUNT(CASE WHEN s.status = 'completed' THEN 1 END)::INT AS completed_count,
      COUNT(CASE WHEN s.status <> 'cancelled' THEN 1 END)::INT AS live_count,
      BOOL_OR(s.status = 'pending_payment') AS has_topup_pending,
      ARRAY_AGG(DISTINCT s.instructor_id)
        FILTER (WHERE s.instructor_id IS NOT NULL) AS instructor_ids
    FROM "Schedule" s
    GROUP BY s.learner_id
  ),
  paid_learners AS (
    SELECT DISTINCT p.learner_id
    FROM "payment" p
    WHERE p.status = 'completed'
      AND COALESCE(p.payment_type, 'course') <> 'reschedule'
      AND COALESCE(p.amount, 0) > 0
  ),
  learner_stats AS (
    SELECT
      l.id,
      l.name,
      l.email,
      l.phone,
      l.created_at,
      l.area,
      l.pick_up_location,
      l.address_lat,
      l.address_lng,
      l.preferred_start_date,
      l.preferred_completion_days,
      l.prefers_two_hour_classes,
      l.two_hour_days,
      l."DL_test_date",
      COALESCE(e.is_demo, false) AS is_demo,
      COALESCE(e.total_lessons, GREATEST(COALESCE(s.live_count, 0), 1)) AS total_lessons,
      COALESCE(s.completed_count, 0) AS completed_count,
      COALESCE(s.has_topup_pending, false) AS has_topup_pending,
      COALESCE(s.instructor_ids, ARRAY[]::UUID[]) AS instructor_ids
    FROM "Learner" l
    LEFT JOIN enrollment_stats e ON l.id = e.learner_id
    LEFT JOIN schedule_stats s ON l.id = s.learner_id
    LEFT JOIN paid_learners pl ON l.id = pl.learner_id
    WHERE
      (
        e.learner_id IS NOT NULL
        OR COALESCE(s.live_count, 0) > 0
        OR pl.learner_id IS NOT NULL
      )
      AND (
        get_active_learners_paginated.search_term IS NULL
        OR l.name ILIKE '%' || get_active_learners_paginated.search_term || '%'
        OR l.email ILIKE '%' || get_active_learners_paginated.search_term || '%'
        OR l.phone LIKE '%' || get_active_learners_paginated.search_term || '%'
        OR (
          v_phone_digits IS NOT NULL
          AND regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g')
                LIKE '%' || v_phone_digits || '%'
        )
      )
  ),
  filtered_learners AS (
    SELECT ls.*
    FROM learner_stats ls
    WHERE
      (
        get_active_learners_paginated.instructor_filter IS NULL
        OR get_active_learners_paginated.instructor_filter = ANY(ls.instructor_ids)
      )
      AND (
        get_active_learners_paginated.tab_filter = 'all'
        OR (get_active_learners_paginated.tab_filter = 'active' AND ls.completed_count < ls.total_lessons)
        OR (get_active_learners_paginated.tab_filter = 'completed' AND ls.completed_count >= ls.total_lessons)
      )
  ),
  total_metadata AS (
    SELECT COUNT(*)::BIGINT AS total
    FROM filtered_learners
  )
  SELECT
    fl.id,
    fl.name,
    fl.email,
    fl.phone,
    fl.created_at,
    fl.area,
    fl.pick_up_location,
    fl.address_lat,
    fl.address_lng,
    fl.preferred_start_date,
    fl.preferred_completion_days,
    fl.prefers_two_hour_classes,
    fl.two_hour_days,
    fl."DL_test_date",
    fl.is_demo,
    fl.total_lessons,
    fl.completed_count,
    fl.has_topup_pending,
    fl.instructor_ids,
    (SELECT total FROM total_metadata) AS total_count
  FROM filtered_learners fl
  ORDER BY fl.created_at DESC
  LIMIT get_active_learners_paginated.page_size
  OFFSET get_active_learners_paginated.page_offset;
END;
$function$;
