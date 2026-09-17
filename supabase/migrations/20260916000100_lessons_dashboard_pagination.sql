-- Keep filtering and chronological class numbering in the database. Only the
-- requested ten schedules (including their display details) leave the database.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_lessons_dashboard_page(
  p_from date,
  p_to date,
  p_page integer DEFAULT 1,
  p_kam_ids uuid[] DEFAULT NULL,
  p_instructor_ids uuid[] DEFAULT NULL,
  p_class_numbers numeric[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_page IS NULL OR p_page < 1 THEN
    RAISE EXCEPTION 'p_page must be at least 1';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT s.*, l.name AS customer_name, l.phone AS customer_phone,
      l.pick_up_location, lesson.number AS template_number
    FROM public."Schedule" s
    LEFT JOIN public."Learner" l ON l.id = s.learner_id
    LEFT JOIN public."Lesson" lesson ON lesson.id = s.lesson_id
    WHERE s.date BETWEEN p_from AND p_to
      -- NULL means every status (including NULL); an empty array means none.
      AND (p_statuses IS NULL OR s.status = ANY(p_statuses))
      AND (COALESCE(cardinality(p_instructor_ids), 0) = 0
        OR s.instructor_id = ANY(p_instructor_ids))
      AND (COALESCE(cardinality(p_kam_ids), 0) = 0 OR EXISTS (
        SELECT 1 FROM public.kam_instructor ki
        WHERE ki.instructor_id = s.instructor_id AND ki.kam_id = ANY(p_kam_ids)
      ))
      -- strpos preserves literal substring search, including % and _.
      AND (COALESCE(p_search, '') = '' OR strpos(
        lower(COALESCE(l.name, '') || ' ' || COALESCE(l.phone, '')),
        lower(p_search)
      ) > 0)
  ), history AS (
    SELECT h.id, row_number() OVER (
      PARTITION BY h.learner_id, h.course_id
      ORDER BY h.date, h.start_time, h.id
    ) AS class_number
    FROM public."Schedule" h
    WHERE h.learner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM candidates c
      WHERE c.learner_id = h.learner_id
        AND c.course_id IS NOT DISTINCT FROM h.course_id
    )
  ), numbered AS (
    SELECT c.*, COALESCE(h.class_number, c.template_number) AS class_number
    FROM candidates c
    LEFT JOIN history h ON h.id = c.id
  ), filtered AS MATERIALIZED (
    SELECT * FROM numbered n
    WHERE COALESCE(cardinality(p_class_numbers), 0) = 0
      OR n.class_number = ANY(p_class_numbers)
  ), page AS (
    SELECT * FROM filtered
    ORDER BY date, start_time, id
    LIMIT 10 OFFSET ((p_page::bigint - 1) * 10)
  )
  SELECT jsonb_build_object(
    'totalCount', (SELECT count(*) FROM filtered),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'scheduleId', p.id,
        'date', p.date,
        'startTime', left(p.start_time::text, 5),
        'endTime', left(p.end_time::text, 5),
        'customerName', p.customer_name,
        'customerPhone', p.customer_phone,
        'classNumber', p.class_number,
        'enrollmentType', CASE WHEN enrollment.type IN ('course', 'demo', 'topup')
          THEN enrollment.type ELSE NULL END,
        'instructorId', p.instructor_id,
        'instructorName', i.name,
        'instructorPhone', i.phone,
        'vehicle', NULLIF(concat_ws(' ', NULLIF(i.car_make, ''), NULLIF(i.car_mode, '')), ''),
        'kamId', kam.id,
        'kamName', kam.name,
        'status', p.status,
        'isTentative', p."isTentative",
        'pickupLocation', p.pick_up_location
      ) ORDER BY p.date, p.start_time, p.id)
      FROM page p
      LEFT JOIN public."Instructor" i ON i.id_instructor = p.instructor_id
      LEFT JOIN LATERAL (
        SELECT ki.kam_id AS id, COALESCE(k.name, '') AS name
        FROM public.kam_instructor ki
        LEFT JOIN public."KAM" k ON k.id = ki.kam_id
        WHERE ki.instructor_id = p.instructor_id
        ORDER BY COALESCE(k.name, ''), ki.kam_id
        LIMIT 1
      ) kam ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(e.progress->>'type',
          CASE WHEN e.course_id IS NOT NULL THEN 'course' END) AS type
        FROM public.enrollment e
        WHERE e.learner_id = p.learner_id
        ORDER BY e.created_at DESC, e.id
        LIMIT 1
      ) enrollment ON true
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- Existing table grants and RLS policies still apply to this invoker function.
REVOKE ALL ON FUNCTION public.get_lessons_dashboard_page(date, date, integer, uuid[], uuid[], numeric[], text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lessons_dashboard_page(date, date, integer, uuid[], uuid[], numeric[], text[], text) TO authenticated;

-- Make the newly installed RPC available to the dashboard immediately.
NOTIFY pgrst, 'reload schema';
COMMIT;
