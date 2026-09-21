-- Preserve the dashboard's session-count ordering before PostgREST applies
-- count/order/range. Only the requested instructor page is sent to the client.
CREATE OR REPLACE FUNCTION public.get_instructors_by_performance(
  from_date date,
  to_date date,
  current_local_time timestamp without time zone,
  search_term text DEFAULT ''
)
RETURNS TABLE (
  id_instructor uuid,
  name text,
  phone text,
  enabled boolean,
  sessions bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT i.id_instructor, i.name, i.phone, i.enabled,
         COALESCE(s.sessions, 0) AS sessions
  FROM public."Instructor" i
  LEFT JOIN (
    SELECT s.instructor_id, count(*) AS sessions
    FROM public."Schedule" s
    WHERE s.date BETWEEN from_date AND to_date
      AND COALESCE(lower(s.status), '') NOT LIKE '%cancel%'
      AND (s.date < current_local_time::date
           OR s.date + s.start_time < current_local_time)
    GROUP BY s.instructor_id
  ) s ON s.instructor_id = i.id_instructor
  WHERE COALESCE(search_term, '') = ''
    OR strpos(lower(COALESCE(i.name, '')), search_term) > 0
    OR strpos(COALESCE(i.phone, ''), search_term) > 0;
$$;

REVOKE ALL ON FUNCTION public.get_instructors_by_performance(date, date, timestamp without time zone, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_instructors_by_performance(date, date, timestamp without time zone, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
