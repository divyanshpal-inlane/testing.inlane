-- Preserve the existing pending/emergency priority before limiting each page.
-- SECURITY INVOKER keeps the leave request table's existing RLS policies.
CREATE OR REPLACE FUNCTION public.get_leave_requests_paginated(
  p_status text DEFAULT 'all',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 21
)
RETURNS SETOF public.instructor_leave_request
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.*
  FROM public.instructor_leave_request r
  WHERE p_status = 'all' OR r.status = p_status
  ORDER BY (r.status = 'pending') DESC,
           (r.leave_type = 'emergency') DESC,
           r.created_at DESC NULLS LAST,
           r.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 21)
  OFFSET GREATEST(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.get_leave_requests_paginated(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leave_requests_paginated(text, integer, integer) TO authenticated;

CREATE INDEX IF NOT EXISTS leave_management_page_idx
  ON public.instructor_leave_request (
    (status = 'pending') DESC,
    (leave_type = 'emergency') DESC,
    created_at DESC NULLS LAST,
    id DESC
  );

NOTIFY pgrst, 'reload schema';
