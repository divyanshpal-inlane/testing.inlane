-- Page customer phone groups before loading their slots. Keep the existing
-- 30-day date window supplied by the caller and preserve Schedule RLS.
CREATE OR REPLACE FUNCTION public.get_tentative_customers_paginated(
  p_start_date date,
  p_search text DEFAULT '',
  p_page integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH customers AS (
    SELECT DISTINCT ON (s.tentative_details->>'phone')
      s.tentative_details->>'phone' AS phone,
      s.date AS first_date,
      s.start_time AS first_time
    FROM public."Schedule" s
    WHERE s."isTentative" IS TRUE
      AND s.date >= p_start_date
      AND COALESCE(s.tentative_details->>'phone', '') <> ''
    ORDER BY s.tentative_details->>'phone', s.date, s.start_time, s.id
  ), matching_customers AS (
    SELECT c.*
    FROM customers c
    WHERE COALESCE(p_search, '') = '' OR EXISTS (
      SELECT 1
      FROM public."Schedule" s
      WHERE s."isTentative" IS TRUE
        AND s.date >= p_start_date
        AND s.tentative_details->>'phone' = c.phone
        AND (
          strpos(lower(c.phone), lower(p_search)) > 0
          OR strpos(lower(s.tentative_details->>'name'), lower(p_search)) > 0
          OR strpos(lower(s.tentative_details->>'email'), lower(p_search)) > 0
          OR strpos(lower(s.tentative_details->>'area'), lower(p_search)) > 0
          OR strpos(lower(s.tentative_details->>'pickup_location'), lower(p_search)) > 0
          OR strpos(lower(s.tentative_details->>'leadName'), lower(p_search)) > 0
          OR strpos(s.date::text, p_search) > 0
          OR strpos(s.start_time::text, p_search) > 0
        )
    )
  ), pagination AS (
    SELECT count(*) AS total_count,
      -- Deleting the last customer on a page returns the previous valid page
      -- in this same request, without a second fetch from the browser.
      LEAST(
        GREATEST(COALESCE(p_page, 1), 1),
        GREATEST((count(*) + 9) / 10, 1)
      )::integer AS page
    FROM matching_customers
  ), paged_customers AS (
    SELECT c.*
    FROM matching_customers c
    ORDER BY c.first_date, c.first_time, c.phone
    LIMIT 10
    OFFSET (SELECT (page - 1)::bigint * 10 FROM pagination)
  )
  SELECT jsonb_build_object(
    'customers', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'groupId', c.phone,
          'schedulesStartDate', c.first_date,
          'schedulesStartTime', c.first_time,
          'schedules', (
            SELECT jsonb_agg(to_jsonb(s) ORDER BY s.date, s.start_time, s.id)
            FROM public."Schedule" s
            WHERE s."isTentative" IS TRUE
              AND s.date >= p_start_date
              AND s.tentative_details->>'phone' = c.phone
          )
        ) ORDER BY c.first_date, c.first_time, c.phone
      )
      FROM paged_customers c
    ), '[]'::jsonb),
    'total_count', p.total_count,
    'page', p.page
  )
  FROM pagination p;
$$;

REVOKE ALL ON FUNCTION public.get_tentative_customers_paginated(date, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tentative_customers_paginated(date, text, integer) TO authenticated;

CREATE INDEX IF NOT EXISTS tentative_schedules_customer_page_idx
  ON public."Schedule" ((tentative_details->>'phone'), date, start_time, id)
  WHERE "isTentative" IS TRUE;

NOTIFY pgrst, 'reload schema';
