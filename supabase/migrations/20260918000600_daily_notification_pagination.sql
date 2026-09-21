-- Page schedule rows for learners and whole instructor groups for reminders.
-- Keep counts and chronological lesson numbers in the same database request.
CREATE OR REPLACE FUNCTION public.get_daily_notification_schedules(
  schedule_date date,
  recipient_tab text DEFAULT 'learners',
  search_term text DEFAULT '',
  page_number integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH eligible AS MATERIALIZED (
    SELECT s.id, s.learner_id, s.instructor_id, s.start_time
    FROM public."Schedule" s
    WHERE s.date = schedule_date
      AND (s."isTentative" = false OR s."isTentative" IS NULL)
      AND s.status <> 'paused'
  ), units AS MATERIALIZED (
    SELECT s.id AS schedule_id, NULL::uuid AS instructor_id,
      s.start_time, s.id AS order_id
    FROM eligible s
    LEFT JOIN public."Learner" l ON l.id = s.learner_id
    WHERE recipient_tab = 'learners'
      AND (COALESCE(search_term, '') = ''
        OR strpos(lower(l.name), lower(search_term)) > 0
        OR strpos(l.phone, search_term) > 0)
    UNION ALL
    SELECT NULL::bigint, s.instructor_id, min(s.start_time), min(s.id)
    FROM eligible s
    LEFT JOIN public."Instructor" i ON i.id_instructor = s.instructor_id
    WHERE recipient_tab = 'instructors'
      AND (COALESCE(search_term, '') = ''
        OR strpos(lower(i.name), lower(search_term)) > 0
        OR strpos(i.phone, search_term) > 0)
    GROUP BY s.instructor_id
  ), page_units AS MATERIALIZED (
    SELECT * FROM units
    ORDER BY start_time, order_id
    LIMIT 15 OFFSET ((GREATEST(COALESCE(page_number, 1), 1)::bigint - 1) * 15)
  ), page_schedules AS (
    SELECT s.*
    FROM eligible e
    JOIN public."Schedule" s ON s.id = e.id
    WHERE EXISTS (
      SELECT 1 FROM page_units p
      WHERE (recipient_tab = 'learners' AND p.schedule_id = s.id)
        OR (recipient_tab = 'instructors'
          AND p.instructor_id IS NOT DISTINCT FROM s.instructor_id)
    )
  ), records AS (
    SELECT s.date, s.start_time, s.id,
      to_jsonb(s) || jsonb_build_object(
        'Learner', CASE WHEN l.id IS NOT NULL THEN jsonb_build_object(
          'name', l.name, 'phone', l.phone, 'email', l.email,
          'pick_up_location', l.pick_up_location,
          'address_lat', l.address_lat, 'address_lng', l.address_lng) END,
        'Instructor', CASE WHEN i.id_instructor IS NOT NULL THEN jsonb_build_object(
          'name', i.name, 'phone', i.phone, 'email', i.email) END,
        'Courses', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object(
          'name', c.name, 'duration', c.duration) END,
        'Lesson', CASE WHEN lesson.id IS NOT NULL THEN jsonb_build_object(
          'id', lesson.id, 'description', lesson.description,
          'number', CASE WHEN s.learner_id IS NULL THEN lesson.number ELSE (
            SELECT count(*) FROM public."Schedule" previous
            WHERE previous.learner_id = s.learner_id
              AND previous.course_id IS NOT DISTINCT FROM s.course_id
              AND previous.status <> 'paused'
              AND (previous."isTentative" = false OR previous."isTentative" IS NULL)
              AND (previous.date, previous.start_time, previous.id)
                <= (s.date, s.start_time, s.id)
          ) END) END
      ) AS record
    FROM page_schedules s
    LEFT JOIN public."Learner" l ON l.id = s.learner_id
    LEFT JOIN public."Instructor" i ON i.id_instructor = s.instructor_id
    LEFT JOIN public."Courses" c ON c.id = s.course_id
    LEFT JOIN public."Lesson" lesson ON lesson.id = s.lesson_id
  )
  SELECT jsonb_build_object(
    'schedules', COALESCE((SELECT jsonb_agg(record ORDER BY date, start_time, id)
      FROM records), '[]'::jsonb),
    'total_count', (SELECT count(*) FROM units),
    'learner_count', (SELECT count(*) FROM eligible),
    'instructor_count', (SELECT count(*) FROM (
      SELECT instructor_id FROM eligible GROUP BY instructor_id
    ) instructors)
  );
$$;

REVOKE ALL ON FUNCTION public.get_daily_notification_schedules(date, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_notification_schedules(date, text, text, integer)
  TO authenticated;

CREATE INDEX IF NOT EXISTS daily_notification_schedule_page_idx
  ON public."Schedule" (date, start_time, id)
  WHERE status <> 'paused' AND ("isTentative" = false OR "isTentative" IS NULL);
CREATE INDEX IF NOT EXISTS daily_notification_lesson_order_idx
  ON public."Schedule" (learner_id, course_id, date, start_time, id)
  WHERE status <> 'paused' AND ("isTentative" = false OR "isTentative" IS NULL);

NOTIFY pgrst, 'reload schema';
