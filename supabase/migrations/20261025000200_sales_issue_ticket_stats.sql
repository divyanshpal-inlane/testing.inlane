-- Analytics for the Sales Issue Tickets page. One round trip, computed in Postgres
-- over the SAME filters the table uses (date range + search), so the dashboard is
-- always consistent with the list. Only holders of the "sales_issue_tickets" permission
-- may call it. Search by phone
-- respects masking: viewers without view_unmasked_customer_phone_numbers can only
-- match against the masked number they are allowed to see.
-- Depends on 20261025000000 / 20261025000100. Re-running is safe.

CREATE OR REPLACE FUNCTION public.sales_issue_ticket_stats(
  p_from timestamptz DEFAULT NULL,   -- inclusive
  p_to timestamptz DEFAULT NULL,     -- exclusive
  p_search text DEFAULT NULL,
  p_tz text DEFAULT 'Asia/Kolkata'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  can_phone boolean;
  term text := lower(btrim(coalesce(p_search, '')));
  digits text;
  d1 date;
  d2 date;
  gran text;
  result jsonb;
BEGIN
  IF NOT public.current_staff_has_permission('sales_issue_tickets') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  can_phone := public.current_staff_has_permission('view_unmasked_customer_phone_numbers');
  digits := regexp_replace(term, '\D', '', 'g');

  CREATE TEMP TABLE IF NOT EXISTS _sit_f (LIKE public.sales_issue_tickets) ON COMMIT DROP;
  -- NB: Supabase's API layer (pg-safeupdate) rejects DELETE without a WHERE.
  DELETE FROM _sit_f WHERE true;
  INSERT INTO _sit_f
  SELECT t.* FROM public.sales_issue_tickets t
  WHERE (p_from IS NULL OR t.created_at >= p_from)
    AND (p_to IS NULL OR t.created_at < p_to)
    AND (
      term = ''
      OR strpos(lower(t.ticket_number), term) > 0
      OR (digits <> '' AND strpos(
            CASE WHEN can_phone THEN t.phone_number
                 ELSE 'XXXXXXXXX' || right(t.phone_number, 2) END, digits) > 0)
    );

  SELECT (min(created_at AT TIME ZONE p_tz))::date, (max(created_at AT TIME ZONE p_tz))::date
    INTO d1, d2 FROM _sit_f;
  IF p_from IS NOT NULL THEN d1 := (p_from AT TIME ZONE p_tz)::date; END IF;
  IF p_to IS NOT NULL THEN d2 := ((p_to - interval '1 second') AT TIME ZONE p_tz)::date; END IF;
  d2 := least(coalesce(d2, current_date), (now() AT TIME ZONE p_tz)::date);
  d1 := coalesce(d1, d2);
  gran := CASE WHEN d2 - d1 <= 120 THEN 'day' ELSE 'month' END;

  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM _sit_f),
    'to_do', (SELECT count(*) FROM _sit_f WHERE status = 'To Do'),
    'in_progress', (SELECT count(*) FROM _sit_f WHERE status = 'In Progress'),
    'resolved', (SELECT count(*) FROM _sit_f WHERE status = 'Resolved'),
    'raised_today', (SELECT count(*) FROM _sit_f
                     WHERE (created_at AT TIME ZONE p_tz)::date = (now() AT TIME ZONE p_tz)::date),
    'email_not_sent', (SELECT count(*) FROM _sit_f WHERE notification_status <> 'sent'),
    'avg_resolution_hours', (
      SELECT round((avg(extract(epoch FROM updated_at - created_at)) / 3600)::numeric, 1)
      FROM _sit_f WHERE status = 'Resolved'),
    'oldest_open_hours', (
      SELECT round((extract(epoch FROM now() - min(created_at)) / 3600)::numeric, 1)
      FROM _sit_f WHERE status <> 'Resolved'),
    'granularity', gran,
    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', b::date, 'count', coalesce(c.n, 0)) ORDER BY b), '[]'::jsonb)
      FROM generate_series(
             CASE WHEN gran = 'month' THEN date_trunc('month', d1) ELSE d1 END,
             d2,
             CASE WHEN gran = 'month' THEN interval '1 month' ELSE interval '1 day' END) b
      LEFT JOIN (
        SELECT (CASE WHEN gran = 'month' THEN date_trunc('month', created_at AT TIME ZONE p_tz)
                     ELSE date_trunc('day', created_at AT TIME ZONE p_tz) END)::date AS k, count(*) AS n
        FROM _sit_f GROUP BY 1) c ON c.k = b::date),
    'top_raisers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', nm, 'count', n) ORDER BY n DESC, nm), '[]'::jsonb)
      FROM (SELECT coalesce(nullif(raised_by_name, ''), nullif(raised_by_email, ''), 'Unknown') AS nm, count(*) AS n
            FROM _sit_f GROUP BY 1 ORDER BY n DESC, nm LIMIT 5) r)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_issue_ticket_stats(timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_issue_ticket_stats(timestamptz, timestamptz, text, text) TO authenticated, service_role;
