-- Sales issue reporting & ticket management.
--
-- Sales staff raise an issue (customer phone + optional description); Support
-- (support@inlane.in) is e-mailed and works the ticket through To Do ->
-- In Progress -> Resolved on the admin "Sales Issue Tickets" page.
--
-- Security model
--   * WRITES go through the `sales-issue-tickets` edge function only (service
--     role). It derives the creator from the verified JWT, so a browser can
--     never choose `raised_by` / `raised_by_email`. The `authenticated` role
--     gets SELECT only; there is deliberately no INSERT/UPDATE/DELETE policy.
--   * READS are limited by RLS to super admins and to staff holding the
--     staff holding the `sales_issue_tickets` permission (Admin -> admin_permissions,
--     team member -> user_permissions) and super admins; everyone else gets nothing.
--   * The edge function lets any logged-in staff account (Admin or User) create
--     tickets, and requires `sales_issue_tickets` (or super admin) to change status.
--
-- Manual apply (DDL): run in the Supabase SQL editor / psql. Re-running is safe.
-- Requires public.handle_updated_at() (already used by other tables).

DO $$
BEGIN
  IF to_regprocedure('public.handle_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'Required helper public.handle_updated_at() is missing.';
  END IF;
END;
$$;

-- Human-readable, race-free ticket numbers: SIT-000001, SIT-000002, ...
CREATE SEQUENCE IF NOT EXISTS public.sales_issue_ticket_seq START 1;

CREATE TABLE IF NOT EXISTS public.sales_issue_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE
    DEFAULT ('SIT-' || lpad(nextval('public.sales_issue_ticket_seq')::text, 6, '0')),
  -- Normalised 10-digit Indian mobile (the edge function validates + normalises).
  phone_number text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'To Do',
  raised_by uuid,
  raised_by_email text,
  raised_by_name text,
  -- Browser-generated key: a double click / network retry of the SAME submit
  -- returns the existing ticket instead of creating a second one.
  client_request_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  notification_status text NOT NULL DEFAULT 'pending',
  notification_error text,
  notification_sent_at timestamptz,
  CONSTRAINT sales_issue_tickets_status_check
    CHECK (status IN ('To Do', 'In Progress', 'Resolved')),
  CONSTRAINT sales_issue_tickets_notification_status_check
    CHECK (notification_status IN ('pending', 'sent', 'failed')),
  CONSTRAINT sales_issue_tickets_phone_check
    CHECK (phone_number ~ '^[6-9][0-9]{9}$'),
  CONSTRAINT sales_issue_tickets_description_len
    CHECK (description IS NULL OR char_length(description) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_sales_issue_tickets_created_at
  ON public.sales_issue_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_issue_tickets_status
  ON public.sales_issue_tickets (status);
CREATE INDEX IF NOT EXISTS idx_sales_issue_tickets_phone
  ON public.sales_issue_tickets (phone_number);
-- ticket_number is already indexed by its UNIQUE constraint.

DROP TRIGGER IF EXISTS trg_sales_issue_tickets_updated_at ON public.sales_issue_tickets;
CREATE TRIGGER trg_sales_issue_tickets_updated_at
  BEFORE UPDATE ON public.sales_issue_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Does the signed-in staff member hold <p_permission>? Super admins hold all.
-- Mirrors is_admin_or_team_member(): Admin by uuid or last-10-digit phone, team
-- member ("User") by phone.
CREATE OR REPLACE FUNCTION public.current_staff_has_permission(p_permission text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone10 text := RIGHT(REGEXP_REPLACE(COALESCE(auth.jwt()->>'phone', ''), '[^0-9]', '', 'g'), 10);
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Admin" a
    WHERE (a.id = auth.uid()
           OR (v_phone10 <> '' AND RIGHT(REGEXP_REPLACE(a.phone, '[^0-9]', '', 'g'), 10) = v_phone10))
      AND (
        a.is_super_admin = true
        OR EXISTS (
          SELECT 1 FROM admin_permissions ap
          WHERE ap.admin_id = a.id AND ap.permission = p_permission
        )
      )
  ) THEN
    RETURN true;
  END IF;

  IF v_phone10 <> '' AND EXISTS (
    SELECT 1 FROM "User" u
    JOIN user_permissions up ON up.user_id = u.id
    WHERE RIGHT(REGEXP_REPLACE(u.phone, '[^0-9]', '', 'g'), 10) = v_phone10
      AND up.permission = p_permission
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.current_staff_has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff_has_permission(text) TO authenticated, service_role;

ALTER TABLE public.sales_issue_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_issue_tickets FROM anon;
REVOKE ALL ON public.sales_issue_tickets FROM authenticated;
GRANT SELECT ON public.sales_issue_tickets TO authenticated;
GRANT ALL ON public.sales_issue_tickets TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sales_issue_ticket_seq TO service_role;

DROP POLICY IF EXISTS "Ticket managers can view sales issue tickets" ON public.sales_issue_tickets;
CREATE POLICY "Ticket managers can view sales issue tickets"
  ON public.sales_issue_tickets FOR SELECT
  USING (public.current_staff_has_permission('sales_issue_tickets'));
