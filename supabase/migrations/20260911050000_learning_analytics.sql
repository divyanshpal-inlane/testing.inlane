-- Requires the existing game analytics migrations. Events begin at deployment.
CREATE TABLE public.learning_analytics_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  tracking_since timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.learning_analytics_settings DEFAULT VALUES;
CREATE TABLE public.learning_content (
  course_id uuid NOT NULL,
  lesson_number integer NOT NULL CHECK(lesson_number > 0),
  content_id text NOT NULL,
  course_title text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('video','quiz')),
  questions jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(course_id,lesson_number,content_id)
);
CREATE TABLE public.learning_sessions (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES public."Learner"(id) ON DELETE CASCADE,
  course_id uuid NOT NULL,
  lesson_number integer NOT NULL,
  content_id text NOT NULL,
  sequence integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  coverage numeric NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  correct integer NOT NULL DEFAULT 0,
  wrong integer NOT NULL DEFAULT 0,
  timeouts integer NOT NULL DEFAULT 0,
  first_correct integer NOT NULL DEFAULT 0,
  first_total integer NOT NULL DEFAULT 0,
  FOREIGN KEY(course_id,lesson_number,content_id) REFERENCES public.learning_content
);
CREATE INDEX learning_sessions_report ON public.learning_sessions(learner_id,course_id,lesson_number,content_id,updated_at DESC);
ALTER TABLE public.learning_analytics_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.learning_analytics_settings, public.learning_content, public.learning_sessions FROM anon,authenticated;

CREATE FUNCTION public.record_learning_session(p_session_id uuid, p_course_id uuid, p_lesson_number integer,
  p_content_id text, p_sequence integer, p_snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_learner uuid;
  v_phone text := right(regexp_replace(auth.jwt()->>'phone','[^0-9]','','g'),10);
  v_content public.learning_content;
  v_old public.learning_sessions;
  v_duration numeric; v_active numeric; v_covered numeric := 0; v_end numeric := 0;
  v_range jsonb; v_response jsonb; v_question jsonb; v_value numeric;
  v_correct integer := 0; v_wrong integer := 0; v_timeouts integer := 0;
  v_first_correct integer := 0; v_first_total integer := 0;
  v_seen text[] := '{}'; v_terminal text[] := '{}'; v_key text;
  v_completed boolean := false;
BEGIN
  IF auth.uid() IS NULL OR length(v_phone) IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'Learner sign-in required' USING ERRCODE='42501';
  END IF;
  SELECT id INTO STRICT v_learner FROM public."Learner" WHERE right(regexp_replace(phone,'[^0-9]','','g'),10)=v_phone;
  IF NOT EXISTS (SELECT 1 FROM public.enrollment WHERE learner_id=v_learner AND course_id=p_course_id) THEN
    RAISE EXCEPTION 'Course enrollment required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT v_content FROM public.learning_content
    WHERE course_id=p_course_id AND lesson_number=p_lesson_number AND content_id=p_content_id;
  IF p_session_id IS NULL OR p_sequence IS NULL OR p_sequence < 1 OR p_sequence > 1000000
    OR p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR octet_length(p_snapshot::text)>500000 THEN
    RAISE EXCEPTION 'Invalid activity snapshot';
  END IF;
  -- Serialize concurrent snapshots of the same attempt, including its first insert.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text,0));
  SELECT * INTO v_old FROM public.learning_sessions WHERE id=p_session_id;
  IF FOUND THEN
    IF v_old.learner_id<>v_learner OR v_old.course_id<>p_course_id OR v_old.lesson_number<>p_lesson_number OR v_old.content_id<>p_content_id THEN
      RAISE EXCEPTION 'Attempt owner or content mismatch' USING ERRCODE='42501';
    END IF;
    IF v_old.sequence >= p_sequence THEN RETURN; END IF;
  END IF;
  FOREACH v_key IN ARRAY ARRAY['duration','active_ms','plays','pauses','seeks','errors'] LOOP
    IF jsonb_typeof(p_snapshot->v_key) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid numeric activity'; END IF;
    v_value := (p_snapshot->>v_key)::numeric;
    IF v_value < 0 OR v_value > (CASE WHEN v_key='active_ms' THEN 86400000 ELSE 100000 END) THEN RAISE EXCEPTION 'Activity outside limits'; END IF;
    IF v_key<>'duration' AND v_value < coalesce((v_old.snapshot->>v_key)::numeric,0) THEN RAISE EXCEPTION 'Activity cannot decrease'; END IF;
  END LOOP;
  IF jsonb_typeof(p_snapshot->'ranges') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_snapshot->'responses') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_snapshot->'finished') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid snapshot arrays'; END IF;
  IF jsonb_array_length(p_snapshot->'ranges')>2000 OR jsonb_array_length(p_snapshot->'responses')>2000 THEN RAISE EXCEPTION 'Too much activity'; END IF;
  -- Already accepted answers are immutable. Retried writes cannot inflate counts.
  IF v_old.id IS NOT NULL AND (jsonb_array_length(p_snapshot->'responses') < jsonb_array_length(v_old.snapshot->'responses')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_old.snapshot->'responses') WITH ORDINALITY a(value,n)
      WHERE a.value IS DISTINCT FROM p_snapshot->'responses'->((a.n-1)::integer))) THEN RAISE EXCEPTION 'Answers cannot be rewritten'; END IF;
  v_duration := (p_snapshot->>'duration')::numeric;
  v_active := (p_snapshot->>'active_ms')::numeric;
  IF v_content.kind='video' THEN
    IF jsonb_array_length(p_snapshot->'responses')<>0 THEN RAISE EXCEPTION 'Video cannot have answers'; END IF;
    FOR v_range IN SELECT value FROM jsonb_array_elements(p_snapshot->'ranges') LOOP
      IF jsonb_typeof(v_range)<>'array' OR jsonb_array_length(v_range)<>2 OR jsonb_typeof(v_range->0) IS DISTINCT FROM 'number' OR jsonb_typeof(v_range->1) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid video range'; END IF;
      IF (v_range->>0)::numeric < v_end OR (v_range->>1)::numeric <= (v_range->>0)::numeric OR (v_range->>1)::numeric > v_duration THEN RAISE EXCEPTION 'Invalid video coverage'; END IF;
      v_covered := v_covered + (v_range->>1)::numeric-(v_range->>0)::numeric;
      v_end := (v_range->>1)::numeric;
    END LOOP;
    IF v_duration>0 THEN v_covered:=least(1,v_covered/v_duration); ELSE v_covered:=0; END IF;
    v_completed:=v_covered>=0.9;
  ELSE
    IF jsonb_array_length(p_snapshot->'ranges')<>0 THEN RAISE EXCEPTION 'Quiz cannot have video ranges'; END IF;
    FOR v_response IN SELECT value FROM jsonb_array_elements(p_snapshot->'responses') LOOP
      SELECT value INTO v_question FROM jsonb_array_elements(v_content.questions) WHERE value->>'id'=v_response->>'question_id';
      IF v_question IS NULL OR jsonb_typeof(v_response->'elapsed_ms') IS DISTINCT FROM 'number'
        OR (v_response->>'elapsed_ms')::numeric NOT BETWEEN 0 AND 86400000
        OR NOT(v_response ? 'selected') THEN RAISE EXCEPTION 'Invalid quiz response'; END IF;
      v_key:=v_question->>'id';
      IF v_key=ANY(v_terminal) THEN RAISE EXCEPTION 'Question already resolved'; END IF;
      IF v_response->'selected'='null'::jsonb THEN
        v_timeouts:=v_timeouts+1; v_terminal:=array_append(v_terminal,v_key);
      ELSE
        IF jsonb_typeof(v_response->'selected')<>'string' OR NOT (v_question->'answers' ? (v_response->>'selected')) THEN RAISE EXCEPTION 'Unknown answer'; END IF;
        IF v_response->>'selected'=v_question->>'correct' THEN
          v_correct:=v_correct+1; v_terminal:=array_append(v_terminal,v_key);
          IF NOT(v_key=ANY(v_seen)) THEN v_first_correct:=v_first_correct+1; END IF;
        ELSE v_wrong:=v_wrong+1; END IF;
      END IF;
      IF NOT(v_key=ANY(v_seen)) THEN v_first_total:=v_first_total+1; v_seen:=array_append(v_seen,v_key); END IF;
    END LOOP;
    v_completed:=(p_snapshot->>'finished')::boolean AND cardinality(v_terminal)=jsonb_array_length(v_content.questions) AND cardinality(v_terminal)>0;
  END IF;
  INSERT INTO public.learning_sessions(id,learner_id,course_id,lesson_number,content_id,sequence,snapshot,coverage,completed,correct,wrong,timeouts,first_correct,first_total)
    VALUES(p_session_id,v_learner,p_course_id,p_lesson_number,p_content_id,p_sequence,p_snapshot,v_covered,v_completed,v_correct,v_wrong,v_timeouts,v_first_correct,v_first_total)
    ON CONFLICT(id) DO UPDATE SET sequence=EXCLUDED.sequence,snapshot=EXCLUDED.snapshot,coverage=EXCLUDED.coverage,
      completed=learning_sessions.completed OR EXCLUDED.completed,correct=EXCLUDED.correct,wrong=EXCLUDED.wrong,timeouts=EXCLUDED.timeouts,
      first_correct=EXCLUDED.first_correct,first_total=EXCLUDED.first_total,updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION public.record_learning_session(uuid,uuid,integer,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_learning_session(uuid,uuid,integer,text,integer,jsonb) TO authenticated;

-- Combines watched timeline segments across visits; repeats never inflate coverage.
CREATE FUNCTION public.learning_video_coverage(p_learner uuid,p_course uuid,p_lesson integer,p_content text)
RETURNS numeric LANGUAGE sql STABLE SET search_path='' AS $$
  WITH segments AS (
    SELECT numrange((r.value->>0)::numeric,(r.value->>1)::numeric,'[)') AS span,
      (s.snapshot->>'duration')::numeric AS duration
    FROM public.learning_sessions s CROSS JOIN LATERAL jsonb_array_elements(s.snapshot->'ranges') r
    WHERE s.learner_id=p_learner AND s.course_id=p_course AND s.lesson_number=p_lesson AND s.content_id=p_content
  ), combined AS (SELECT range_agg(span) AS spans, max(duration) AS duration FROM segments)
  SELECT least(1,coalesce((SELECT sum(upper(x)-lower(x)) FROM unnest(spans) x)/nullif(duration,0),0)) FROM combined;
$$;
REVOKE ALL ON FUNCTION public.learning_video_coverage(uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_learning_analytics(p_search text DEFAULT '',p_activity text DEFAULT 'all',p_course_id uuid DEFAULT NULL,p_lesson_number integer DEFAULT NULL,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb; v_phone boolean;
BEGIN
  IF NOT public.game_analytics_has_permission('game_analytics') THEN RAISE EXCEPTION 'Game Analytics permission required' USING ERRCODE='42501'; END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 1000000 OR p_activity IS NULL OR p_activity NOT IN ('all','active','unrecorded','incomplete','complete') OR (p_lesson_number IS NOT NULL AND p_lesson_number<1) THEN RAISE EXCEPTION 'Invalid filters'; END IF;
  v_phone:=public.game_analytics_has_permission('view_unmasked_phone_numbers');
  WITH learners AS (
    SELECT id,name,CASE WHEN v_phone THEN phone ELSE '******'||right(phone,4) END AS phone FROM public."Learner" l
    WHERE (coalesce(p_search,'')='' OR strpos(lower(coalesce(name,'')),lower(p_search))>0 OR (v_phone AND strpos(phone,p_search)>0))
      AND (p_course_id IS NULL OR EXISTS(SELECT 1 FROM public.enrollment e WHERE e.learner_id=l.id AND e.course_id=p_course_id))
  ), catalog AS (
    SELECT DISTINCT e.learner_id,c.* FROM public.enrollment e JOIN public.learning_content c USING(course_id)
    WHERE c.active AND (p_course_id IS NULL OR c.course_id=p_course_id) AND (p_lesson_number IS NULL OR c.lesson_number=p_lesson_number)
  ), items AS (
    SELECT l.id AS learner_id,c.course_id,c.course_title,c.lesson_number,c.content_id,c.title,c.kind,
      count(s.id) AS sessions,coalesce(sum((s.snapshot->>'plays')::integer),0) AS plays,
      count(s.id) FILTER(WHERE s.completed) AS completed_sessions,
      CASE WHEN c.kind='video' THEN public.learning_video_coverage(l.id,c.course_id,c.lesson_number,c.content_id) ELSE 0 END AS coverage,
      coalesce(sum((s.snapshot->>'active_ms')::numeric),0) AS active_ms,
      coalesce(sum(s.correct),0) AS correct,coalesce(sum(s.wrong),0) AS wrong,coalesce(sum(s.timeouts),0) AS timeouts,
      coalesce(sum(s.first_correct),0) AS first_correct,coalesce(sum(s.first_total),0) AS first_total,
      coalesce(sum((s.snapshot->>'pauses')::integer),0) AS pauses,
      coalesce(sum((s.snapshot->>'seeks')::integer),0) AS seeks,
      coalesce(sum((s.snapshot->>'errors')::integer),0) AS errors,max(s.updated_at) AS last_seen
    FROM learners l JOIN catalog c ON c.learner_id=l.id LEFT JOIN public.learning_sessions s
      ON s.learner_id=l.id AND s.course_id=c.course_id AND s.lesson_number=c.lesson_number AND s.content_id=c.content_id
    GROUP BY l.id,c.course_id,c.course_title,c.lesson_number,c.content_id,c.title,c.kind
  ), grouped AS (
    SELECT l.id AS learner_id,l.name,l.phone,
      count(i.content_id) FILTER(WHERE kind='video') AS videos_total,
      count(i.content_id) FILTER(WHERE kind='video' AND coverage>=0.9) AS videos_completed,
      count(i.content_id) FILTER(WHERE kind='quiz') AS quizzes_total,
      count(i.content_id) FILTER(WHERE kind='quiz' AND completed_sessions>0) AS quizzes_completed,
      coalesce(sum(i.sessions),0) AS sessions,coalesce(sum(i.active_ms),0) AS active_ms,
      coalesce(sum(i.correct),0) AS correct,coalesce(sum(i.wrong),0) AS wrong,coalesce(sum(i.timeouts),0) AS timeouts,
      coalesce(sum(i.first_correct),0) AS first_correct,coalesce(sum(i.first_total),0) AS first_total,max(i.last_seen) AS last_seen,
      coalesce(jsonb_agg(to_jsonb(i)-'learner_id' ORDER BY i.course_title,i.lesson_number,i.kind,i.title) FILTER(WHERE i.content_id IS NOT NULL),'[]') AS items
    FROM learners l LEFT JOIN items i ON i.learner_id=l.id GROUP BY l.id,l.name,l.phone
  ), filtered AS MATERIALIZED (
    SELECT * FROM grouped WHERE p_activity='all' OR (p_activity='active' AND sessions>0) OR (p_activity='unrecorded' AND sessions=0)
      OR (p_activity='incomplete' AND videos_completed+quizzes_completed<videos_total+quizzes_total)
      OR (p_activity='complete' AND videos_total+quizzes_total>0 AND videos_completed+quizzes_completed=videos_total+quizzes_total)
  ), page AS (SELECT * FROM filtered ORDER BY name NULLS LAST,learner_id LIMIT 50 OFFSET p_page*50)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name NULLS LAST,p.learner_id) FROM page p),'[]'),
    'total_rows',(SELECT count(*) FROM filtered),'tracking_since',(SELECT tracking_since FROM public.learning_analytics_settings WHERE singleton)) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_learning_analytics(text,text,uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_learning_analytics(text,text,uuid,integer,integer) TO authenticated;

CREATE FUNCTION public.get_learning_attempts(p_learner_id uuid,p_course_id uuid,p_lesson_number integer,p_content_id text,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.game_analytics_has_permission('game_analytics') THEN RAISE EXCEPTION 'Game Analytics permission required' USING ERRCODE='42501'; END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid page'; END IF;
  WITH filtered AS MATERIALIZED (
    SELECT s.*,c.kind,c.questions FROM public.learning_sessions s JOIN public.learning_content c USING(course_id,lesson_number,content_id)
    WHERE learner_id=p_learner_id AND course_id=p_course_id AND lesson_number=p_lesson_number AND content_id=p_content_id
  ), page AS (
    SELECT f.*,coalesce((SELECT jsonb_agg(jsonb_build_object('question',q.value->>'question','selected',r.value->'selected',
      'correct_answer',q.value->>'correct','correct',coalesce(r.value->>'selected'=q.value->>'correct',false),'elapsed_ms',r.value->'elapsed_ms') ORDER BY r.n)
      FROM jsonb_array_elements(f.snapshot->'responses') WITH ORDINALITY r(value,n)
      JOIN LATERAL jsonb_array_elements(f.questions) q ON q.value->>'id'=r.value->>'question_id'),'[]') AS responses
    FROM filtered f ORDER BY started_at DESC,id LIMIT 20 OFFSET p_page*20
  )
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p)-'questions' ORDER BY p.started_at DESC,p.id) FROM page p),'[]'),
    'total_rows',(SELECT count(*) FROM filtered)) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_learning_attempts(uuid,uuid,integer,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_learning_attempts(uuid,uuid,integer,text,integer) TO authenticated;
