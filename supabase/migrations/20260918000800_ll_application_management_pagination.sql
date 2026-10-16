-- Only the LL Application Management "Select Learner" list uses this RPC.
-- Return the Learner table shape so selection/details/forms remain unchanged.
-- The caller requests exact count and a 15-row PostgREST range in one request.
CREATE OR REPLACE FUNCTION public.get_pending_ll_learners(
  search_term text DEFAULT ''
)
RETURNS SETOF public."Learner"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT DISTINCT ON (COALESCE(NULLIF(l.phone, ''), l.id::text)) l.*
  FROM public."Learner" l
  WHERE l."has_a_DL" IS FALSE
    AND l."LL_application_approved" IS NOT TRUE
    AND l."LL_received" IS NOT TRUE
    AND EXISTS (
      SELECT 1
      FROM public.enrollment e
      WHERE e.learner_id = l.id AND e.status = 'active'
    )
    AND (
      COALESCE(btrim(search_term), '') = ''
      OR strpos(lower(l.name), lower(btrim(search_term))) > 0
      OR strpos(lower(l.phone), lower(btrim(search_term))) > 0
    )
  -- Preserve the old newest-first phone/id de-duplication BEFORE pagination.
  -- EXISTS also prevents multiple active enrollments from duplicating learners.
  ORDER BY COALESCE(NULLIF(l.phone, ''), l.id::text),
    l.created_at DESC, l.id DESC;
$$;

-- Use existing table RLS rather than bypassing it in the list query.
REVOKE ALL ON FUNCTION public.get_pending_ll_learners(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_ll_learners(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
