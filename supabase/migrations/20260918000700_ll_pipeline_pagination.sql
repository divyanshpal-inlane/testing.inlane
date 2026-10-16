-- Search before count/order/range, returning the table type so PostgREST keeps
-- the existing Learner relationship. No capped learner-ID lookup is needed.
-- STABLE + SECURITY INVOKER allows inlining and preserves both tables' RLS.
CREATE OR REPLACE FUNCTION public.get_ll_pipeline_applications(
  search_term text DEFAULT '',
  search_routes text[] DEFAULT '{}'
)
RETURNS SETOF public.ll_applications
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT a.*
  FROM public.ll_applications a
  WHERE COALESCE(search_term, '') = ''
    OR strpos(lower(a.application_number), lower(search_term)) > 0
    OR strpos(lower(a.ll_number), lower(search_term)) > 0
    OR strpos(lower(a.batch_code), lower(search_term)) > 0
    OR a.batch_code = ANY(search_routes)
    OR EXISTS (
      SELECT 1
      FROM public."Learner" l
      WHERE l.id = a.learner_id
        AND (
          strpos(lower(l.name), lower(search_term)) > 0
          OR strpos(lower(l.phone), lower(search_term)) > 0
          OR strpos(lower(l.email), lower(search_term)) > 0
        )
    );
$$;

REVOKE ALL ON FUNCTION public.get_ll_pipeline_applications(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ll_pipeline_applications(text, text[]) TO authenticated;

CREATE INDEX IF NOT EXISTS ll_pipeline_page_idx
  ON public.ll_applications (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ll_pipeline_status_page_idx
  ON public.ll_applications (status, updated_at DESC, id DESC);

NOTIFY pgrst, 'reload schema';
