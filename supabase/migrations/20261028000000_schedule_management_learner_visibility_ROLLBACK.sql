-- ROLLBACK for 20261028000000_schedule_management_learner_visibility.sql
-- Exact definition that was live before that migration (captured 2026-10-28).

CREATE OR REPLACE FUNCTION public.get_active_learners_paginated(page_offset integer DEFAULT 0, page_size integer DEFAULT 20, search_term text DEFAULT NULL::text, instructor_filter uuid DEFAULT NULL::uuid, tab_filter text DEFAULT 'active'::text)
 RETURNS TABLE(id uuid, name text, email text, phone text, created_at timestamp with time zone, area text, pick_up_location text, address_lat numeric, address_lng numeric, preferred_start_date date, preferred_completion_days integer, prefers_two_hour_classes boolean, two_hour_days text, dl_test_date date, is_demo boolean, total_lessons integer, completed_count integer, has_topup_pending boolean, instructor_ids uuid[], total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
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
      BOOL_OR(s.status = 'pending_payment') AS has_topup_pending,
      ARRAY_AGG(DISTINCT s.instructor_id) 
        FILTER (WHERE s.instructor_id IS NOT NULL) AS instructor_ids
    FROM "Schedule" s
    GROUP BY s.learner_id
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
      e.is_demo,
      e.total_lessons,
      COALESCE(s.completed_count, 0) AS completed_count,
      COALESCE(s.has_topup_pending, false) AS has_topup_pending,
      COALESCE(s.instructor_ids, ARRAY[]::UUID[]) AS instructor_ids
    FROM "Learner" l
    INNER JOIN enrollment_stats e ON l.id = e.learner_id
    LEFT JOIN schedule_stats s ON l.id = s.learner_id
    WHERE
      (
        get_active_learners_paginated.search_term IS NULL
        OR l.name ILIKE '%' || get_active_learners_paginated.search_term || '%'
        OR l.email ILIKE '%' || get_active_learners_paginated.search_term || '%'
        OR l.phone LIKE '%' || get_active_learners_paginated.search_term || '%'
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
$function$
;
