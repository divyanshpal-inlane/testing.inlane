-- Recover learners whose availability saved but whose queue insert failed.
-- Manual apply in Supabase SQL Editor. Safe to re-run: does not change existing
-- requests, preferences, documents, payments or schedules.
BEGIN;

-- Serialize this one-time repair against request/schedule creation so it cannot
-- race an administrator booking a learner or a learner pressing Save.
LOCK TABLE public.reschedule_requests, public."Schedule" IN SHARE ROW EXCLUSIVE MODE;

WITH latest_enrollment AS (
  SELECT DISTINCT ON (e.learner_id) e.*
  FROM public.enrollment e
  WHERE e.status = 'active'
  ORDER BY e.learner_id,
    CASE WHEN e.course_id IS NOT NULL OR e.progress->>'type' IN ('course', 'custom')
      THEN 0 WHEN e.progress->>'type' = 'topup' THEN 1 ELSE 2 END,
    e.created_at DESC, e.id
), ready AS (
  SELECT e.*
  FROM latest_enrollment e
  JOIN public."Learner" l ON l.id = e.learner_id
  WHERE l.onboarding_completed IS TRUE
    AND l.address_lat IS NOT NULL AND l.address_lng IS NOT NULL
    AND (e.progress->>'type' = 'demo' OR l.preferred_start_date IS NOT NULL)
    AND e.case_type IS DISTINCT FROM 'rto_only'
    AND (e.course_id IS NOT NULL OR e.progress->>'type' IN ('demo', 'custom', 'topup'))
    AND (e.payment_status IN ('half_paid', 'full_paid') OR EXISTS (
      SELECT 1 FROM public.payment p
      WHERE p.id = e.payment_id AND p.status = 'completed'
    ))
    AND EXISTS (
      SELECT 1 FROM public.schedule_preferences sp WHERE sp.learner_id = l.id
    )
    -- Pending (including unpaid) and fulfilled requests must not be recreated.
    AND NOT EXISTS (
      SELECT 1 FROM public.reschedule_requests r
      WHERE r.learner_id = l.id AND r.type = 'new'
        AND (r.status IN ('pending', 'pending_payment')
          OR (r.status = 'completed' AND r.created_at >= e.created_at))
    )
    -- Only recover an entirely unscheduled enrollment. Old demos must not hide
    -- a newly purchased course, but a partly scheduled course is not rebooked.
    AND NOT EXISTS (
      SELECT 1 FROM public."Schedule" s
      WHERE s.learner_id = l.id
        AND lower(coalesce(s.status, '')) NOT IN ('paused', 'cancelled', 'canceled')
        AND (
          (e.course_id IS NOT NULL AND s.course_id = e.course_id)
          OR (e.course_id IS NULL AND s.course_id IS NULL AND s.created_at >= e.created_at)
        )
    )
), request_lessons AS (
  SELECT e.*,
    CASE WHEN e.course_id IS NOT NULL THEN (
      SELECT array_agg(lesson.id::text ORDER BY lesson.number)
      FROM (
        SELECT DISTINCT ON (ls.number) ls.id, ls.number
        FROM public."Lesson" ls
        JOIN public."Courses" c ON c.id = ls.course_id
        WHERE ls.course_id = e.course_id
          AND ls.number >= 1
          AND (c.total_lessons IS NULL OR ls.number <= c.total_lessons)
        ORDER BY ls.number, ls.id
      ) lesson
    ) ELSE (
      SELECT array_agg('virtual-lesson-' || n::text ORDER BY n)
      FROM generate_series(1,
        CASE WHEN e.progress->>'type' = 'demo' THEN 1 ELSE
          -- Custom courses are scheduled in full even when only half paid.
          -- Match demoLessonOffsetFor: leave at least one purchased hour.
          greatest(1,
            CASE WHEN coalesce(e.progress->>'total_hours', '') ~ '^[0-9]+([.][0-9]+)?$'
              THEN ceil((e.progress->>'total_hours')::numeric)::int ELSE 1 END
            - CASE WHEN e.progress->>'type' = 'custom' THEN (
                SELECT count(*)::int FROM public.payment demo
                WHERE demo.learner_id = e.learner_id AND demo.payment_type = 'demo'
                  AND demo.status IN ('completed', 'upgraded')
              ) ELSE 0 END
          )
        END
      ) n
    ) END AS requested_lessons
  FROM ready e
)
INSERT INTO public.reschedule_requests
  (learner_id, type, status, lesson_ids, amount, payment_id)
SELECT learner_id, 'new', 'pending', requested_lessons, 0, payment_id
FROM request_lessons
WHERE cardinality(requested_lessons) > 0;

COMMIT;
