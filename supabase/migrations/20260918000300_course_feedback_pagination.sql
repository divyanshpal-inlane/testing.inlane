-- Keep the table return type so PostgREST can embed the existing relationships.
-- The caller applies exact count, stable ordering and LIMIT/OFFSET to this
-- inlineable function. Search and checkpoint filtering happen before pagination.
CREATE OR REPLACE FUNCTION public.get_course_feedback(
  search_term text DEFAULT '',
  checkpoint_filter text DEFAULT 'all'
)
RETURNS SETOF public.learner_course_feedback
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT f.*
  FROM public.learner_course_feedback f
  LEFT JOIN public."Learner" l ON l.id = f.learner_id
  LEFT JOIN public.enrollment e ON e.id = f.enrollment_id
  LEFT JOIN public."Courses" c ON c.id = e.course_id
  WHERE (checkpoint_filter = 'all' OR f.checkpoint = checkpoint_filter)
    AND (
      COALESCE(search_term, '') = ''
      -- Literal, case-insensitive substring search mirrors the existing search
      -- across learner name, phone, course and comment (including their spaces).
      OR strpos(
        lower(concat_ws(' ', NULLIF(l.name, ''), NULLIF(l.phone, ''),
          NULLIF(c.name, ''), NULLIF(f.comment, ''))),
        lower(search_term)
      ) > 0
    );
$$;

-- Statistics remain global, independent of filters and how many cards are loaded.
-- Return aggregates only, never download feedback rows to calculate totals.
CREATE OR REPLACE FUNCTION public.get_course_feedback_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'total', count(*),
    'mid', count(*) FILTER (WHERE checkpoint = 'mid'),
    'final', count(*) FILTER (WHERE checkpoint = 'final'),
    'avgOverall', COALESCE(avg(overall_rating), 0)
  )
  FROM public.learner_course_feedback;
$$;

REVOKE ALL ON FUNCTION public.get_course_feedback(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_feedback(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_course_feedback_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_feedback_stats() TO authenticated;

CREATE INDEX IF NOT EXISTS learner_course_feedback_page_idx
  ON public.learner_course_feedback (created_at DESC, id DESC);

NOTIFY pgrst, 'reload schema';
