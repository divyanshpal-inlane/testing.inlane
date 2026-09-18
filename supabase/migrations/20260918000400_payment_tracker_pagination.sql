-- Keep filtering, ordering and summary calculations in the database. Only the
-- selected tab's ten rows are returned; counts/sums cover all matching rows.
-- SECURITY INVOKER preserves the same table RLS as the previous direct queries.
CREATE OR REPLACE FUNCTION public.get_payment_tracker_page(
  p_tab text DEFAULT 'half_paid',
  p_page integer DEFAULT 1,
  p_search text DEFAULT '',
  p_course text DEFAULT 'all',
  p_urgency text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH completed_counts AS (
    SELECT s.learner_id, count(*) AS completed_count
    FROM public."Schedule" s
    WHERE s.status = 'completed'
    GROUP BY s.learner_id
  ), enrollment_base AS (
    SELECT
      e.id, e.amount, e.installment1_amount, e.installment2_amount,
      e.payment_status, e.unlocked_lessons, e.created_at, e.learner_id,
      e.status, e.progress,
      l.name AS learner_name, l.phone AS learner_phone,
      c.name AS search_course_name,
      COALESCE(NULLIF(c.name, ''), CASE e.progress->>'type'
        WHEN 'demo' THEN 'Demo'
        WHEN 'custom' THEN 'Custom (' || COALESCE(
          NULLIF(NULLIF(e.progress->>'total_hours', ''), '0'), '?'
        ) || 'hr)'
        ELSE 'Unknown'
      END) AS course_name,
      COALESCE(
        NULLIF(c.total_lessons, 0), NULLIF(c.duration, 0),
        NULLIF((e.progress->>'total_hours')::numeric, 0), 10
      ) AS total_lessons,
      COALESCE(cc.completed_count, 0) AS completed_count,
      COALESCE(CASE WHEN p.status = 'completed' THEN p.updated_at END,
        p.created_at, e.created_at) AS payment_date,
      CASE WHEN e.payment_status = 'full_paid'
        THEN COALESCE(NULLIF(e.amount, 0), NULLIF(p.amount, 0), 0)
        ELSE COALESCE(NULLIF(e.installment1_amount, 0), NULLIF(p.amount, 0), 0)
      END AS amount_paid,
      COALESCE(NULLIF(e.installment2_amount, 0), GREATEST(0,
        COALESCE(e.amount, 0)
        - COALESCE(NULLIF(e.installment1_amount, 0), NULLIF(p.amount, 0), 0)
      )) AS balance_due,
      CASE WHEN l.id IS NOT NULL THEN jsonb_build_object(
        'id', l.id, 'name', l.name, 'phone', l.phone
      ) END AS learner,
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object(
        'id', c.id, 'name', c.name, 'duration', c.duration,
        'total_lessons', c.total_lessons
      ) END AS course,
      CASE WHEN p.id IS NOT NULL THEN jsonb_build_object(
        'id', p.id, 'amount', p.amount, 'status', p.status,
        'created_at', p.created_at, 'updated_at', p.updated_at,
        'installment_type', p.installment_type, 'payment_type', p.payment_type
      ) END AS payment
    FROM public.enrollment e
    LEFT JOIN public."Learner" l ON l.id = e.learner_id
    LEFT JOIN public."Courses" c ON c.id = e.course_id
    LEFT JOIN public.payment p ON p.id = e.payment_id
    LEFT JOIN completed_counts cc ON cc.learner_id = e.learner_id
    WHERE e.status = 'active'
  ), enrollment_metrics AS (
    SELECT b.*, GREATEST(0, CASE
      WHEN COALESCE(cardinality(b.unlocked_lessons), 0) > 0
        THEN cardinality(b.unlocked_lessons)
      WHEN b.payment_status IN ('full_paid', 'completed') THEN b.total_lessons
      WHEN b.payment_status = 'half_paid' THEN CASE
        WHEN b.total_lessons <= 2 THEN 1 ELSE b.total_lessons - 2 END
      ELSE b.total_lessons
    END - b.completed_count) AS remaining,
    CASE
      WHEN b.payment_status = 'half_paid' THEN 'half_paid'
      WHEN b.payment_status IN ('full_paid', 'completed') THEN 'full_paid'
      ELSE 'pending'
    END AS tab
    FROM enrollment_base b
  ), searched_enrollments AS (
    SELECT m.*
    FROM enrollment_metrics m
    WHERE (
      COALESCE(p_search, '') = ''
      OR strpos(lower(m.learner_name), lower(p_search)) > 0
      OR strpos(m.learner_phone, p_search) > 0
      OR strpos(lower(m.search_course_name), lower(p_search)) > 0
    ) AND (p_course = 'all' OR m.course_name = p_course)
  ), filtered_enrollments AS (
    SELECT s.*
    FROM searched_enrollments s
    -- Urgency affects only half-paid rows, as in the existing tracker.
    WHERE s.tab <> 'half_paid' OR CASE p_urgency
      WHEN 'urgent' THEN s.remaining <= 1
      WHEN 'soon' THEN s.remaining = 2
      WHEN 'ok' THEN s.remaining >= 3
      ELSE true
    END
  ), enrollment_page AS (
    SELECT f.*
    FROM filtered_enrollments f
    WHERE f.tab = p_tab
    ORDER BY
      CASE WHEN p_tab = 'half_paid' THEN f.remaining END ASC,
      CASE WHEN p_tab = 'half_paid' THEN f.payment_date END ASC,
      f.created_at DESC,
      f.id
    LIMIT 10 OFFSET (GREATEST(COALESCE(p_page, 1), 1)::bigint - 1) * 10
  ), topup_schedules AS (
    -- Page learners after grouping so their slot counts/dates stay complete.
    SELECT s.learner_id, count(*) AS total_slots,
      array_agg(s.date ORDER BY s.date, s.id) AS dates,
      min(s.date) AS first_date
    FROM public."Schedule" s
    WHERE s.status IN ('pending_payment', 'topup')
      AND s.learner_id IS NOT NULL
    GROUP BY s.learner_id
  ), topup_rows AS (
    SELECT t.*, COALESCE(NULLIF(l.name, ''), 'Unknown') AS learner_name,
      COALESCE(l.phone, '') AS learner_phone,
      COALESCE(p.status = 'completed', false) AS is_paid,
      CASE WHEN p.status = 'completed'
        THEN COALESCE(p.updated_at, p.created_at) END AS payment_date
    FROM topup_schedules t
    LEFT JOIN public."Learner" l ON l.id = t.learner_id
    LEFT JOIN LATERAL (
      -- Preserve the current latest demo-payment check for topup learners.
      SELECT p.status, p.updated_at, p.created_at
      FROM public.payment p
      WHERE p.learner_id = t.learner_id AND p.payment_type = 'demo'
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 1
    ) p ON true
  ), filtered_topups AS (
    SELECT t.*
    FROM topup_rows t
    WHERE COALESCE(p_search, '') = ''
      OR strpos(lower(t.learner_name), lower(p_search)) > 0
      OR strpos(t.learner_phone, p_search) > 0
    -- Course/urgency filters have never applied to the topup tab.
  ), topup_page AS (
    SELECT t.*
    FROM filtered_topups t
    WHERE p_tab = 'topup'
    ORDER BY t.is_paid, t.first_date, t.learner_id
    LIMIT 10 OFFSET (GREATEST(COALESCE(p_page, 1), 1)::bigint - 1) * 10
  )
  SELECT jsonb_build_object(
    'tab', p_tab,
    'enrollments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'amount', e.amount,
      'installment1_amount', e.installment1_amount,
      'installment2_amount', e.installment2_amount,
      'payment_status', e.payment_status, 'unlocked_lessons', e.unlocked_lessons,
      'created_at', e.created_at, 'learner_id', e.learner_id,
      'status', e.status, 'progress', e.progress,
      'completed_count', e.completed_count,
      'Learner', e.learner, 'Courses', e.course, 'payment', e.payment
    ) ORDER BY
      CASE WHEN p_tab = 'half_paid' THEN e.remaining END ASC,
      CASE WHEN p_tab = 'half_paid' THEN e.payment_date END ASC,
      e.created_at DESC, e.id
    ) FROM enrollment_page e), '[]'::jsonb),
    'topups', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'learner_id', t.learner_id, 'learner_name', t.learner_name,
      'learner_phone', t.learner_phone, 'totalSlots', t.total_slots,
      'dates', t.dates, 'isPaid', t.is_paid, 'paymentDate', t.payment_date
    ) ORDER BY t.is_paid, t.first_date, t.learner_id)
      FROM topup_page t), '[]'::jsonb),
    'courseNames', COALESCE((SELECT jsonb_agg(n.course_name ORDER BY n.course_name)
      FROM (SELECT DISTINCT course_name FROM enrollment_base) n), '[]'::jsonb),
    'counts', (SELECT jsonb_build_object(
      'half_paid', count(*) FILTER (WHERE e.tab = 'half_paid'),
      'full_paid', count(*) FILTER (WHERE e.tab = 'full_paid'),
      'pending', count(*) FILTER (WHERE e.tab = 'pending'),
      'topup', (SELECT count(*) FROM filtered_topups)
    ) FROM filtered_enrollments e),
    'totalOutstanding', (SELECT COALESCE(sum(e.balance_due), 0)
      FROM filtered_enrollments e WHERE e.tab = 'half_paid'),
    'totalRevenue', (SELECT COALESCE(sum(e.amount_paid), 0)
      FROM filtered_enrollments e WHERE e.tab = 'full_paid'),
    'pendingAmount', (SELECT COALESCE(sum(e.amount), 0)
      FROM filtered_enrollments e WHERE e.tab = 'pending'),
    -- Urgent Follow-up is independent of the selected urgency filter.
    'urgentCount', (SELECT count(*) FROM searched_enrollments e
      WHERE e.tab = 'half_paid' AND e.remaining <= 1),
    'topupPaidCount', (SELECT count(*) FROM filtered_topups WHERE is_paid),
    'topupUnpaidCount', (SELECT count(*) FROM filtered_topups WHERE NOT is_paid)
  );
$$;

REVOKE ALL ON FUNCTION public.get_payment_tracker_page(text, integer, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_tracker_page(text, integer, text, text, text)
  TO authenticated;

CREATE INDEX IF NOT EXISTS payment_tracker_completed_schedule_idx
  ON public."Schedule" (learner_id) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS payment_tracker_topup_schedule_idx
  ON public."Schedule" (learner_id, date, id)
  WHERE status IN ('pending_payment', 'topup');
CREATE INDEX IF NOT EXISTS payment_tracker_demo_payment_idx
  ON public.payment (learner_id, created_at DESC, id DESC)
  WHERE payment_type = 'demo';

NOTIFY pgrst, 'reload schema';
