-- Return the existing Learner table type so PostgREST can reuse its enrollment,
-- Courses and payment relationships. The caller applies count/order/range.
-- SQL STABLE + SECURITY INVOKER lets PostgreSQL inline the function and apply
-- LIMIT/OFFSET before embedding related records, while preserving existing RLS.
CREATE OR REPLACE FUNCTION public.get_learners_with_issues(
  search_term text DEFAULT '',
  issue_filter text DEFAULT 'all'
)
RETURNS SETOF public."Learner"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT l.*
  FROM public."Learner" l
  LEFT JOIN LATERAL (
    SELECT e.id, e.status, e.payment_status, e.progress, e.unlocked_lessons
    FROM public.enrollment e
    WHERE e.learner_id = l.id
      AND issue_filter IN ('has-issues', 'no-issues', 'enrollment', 'payment')
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  ) e ON true
  LEFT JOIN LATERAL (
    SELECT p.id, p.status
    FROM public.payment p
    WHERE p.learner_id = l.id
      AND issue_filter IN ('has-issues', 'no-issues', 'enrollment', 'payment')
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT 1
  ) p ON true
  CROSS JOIN LATERAL (
    SELECT
      -- Mirrors detectIssues(..., includeScheduleCheck = false) in the list.
      COALESCE(
        (e.id IS NULL AND p.id IS NOT NULL)
        OR (e.status = 'pending' AND p.status IN ('completed', 'full_paid')
            AND e.payment_status = 'full_paid')
        OR (e.progress->>'type' IN ('demo', 'custom')
            AND COALESCE(cardinality(e.unlocked_lessons), 0) = 0),
        false
      ) AS enrollment_issue,
      COALESCE(p.status = 'half_paid' AND e.payment_status = 'full_paid', false)
        AS payment_issue,
      (COALESCE(l.signature_storage_path, '') = ''
        OR (l."LL_result" IS TRUE AND l."LL_received" IS NOT TRUE)
        OR (l."DL_result" IS TRUE AND l."DL_received" IS NOT TRUE))
        AS learner_issue
  ) issues
  WHERE (
    COALESCE(search_term, '') = ''
    OR strpos(lower(l.name), lower(search_term)) > 0
    OR strpos(l.phone, search_term) > 0
    OR strpos(lower(l.area), lower(search_term)) > 0
  )
  AND CASE issue_filter
    WHEN 'all' THEN true
    WHEN 'has-issues' THEN issues.enrollment_issue OR issues.payment_issue OR issues.learner_issue
    WHEN 'no-issues' THEN NOT (issues.enrollment_issue OR issues.payment_issue OR issues.learner_issue)
    WHEN 'enrollment' THEN issues.enrollment_issue
    WHEN 'payment' THEN issues.payment_issue
    WHEN 'learner' THEN issues.learner_issue
    -- Schedule checks have always run only in the selected learner's panel.
    WHEN 'schedule' THEN false
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.get_learners_with_issues(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_learners_with_issues(text, text) TO authenticated;

-- Support stable page ordering and first-related-record lookup without sorting
-- thousands of rows during each refresh.
CREATE INDEX IF NOT EXISTS learner_issue_fixer_page_idx
  ON public."Learner" (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS learner_issue_fixer_enrollment_idx
  ON public.enrollment (learner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS learner_issue_fixer_payment_idx
  ON public.payment (learner_id, created_at DESC, id DESC);

NOTIFY pgrst, 'reload schema';
