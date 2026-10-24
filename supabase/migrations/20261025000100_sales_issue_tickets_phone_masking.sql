-- Customer-phone masking for sales issue tickets.
--
-- The ticket list reads through sales_issue_tickets_view. Its phone_number is the
-- real number only for super admins and staff holding
-- "view_unmasked_customer_phone_numbers" (same permission as Learner Management,
-- Instructor Management and the Sales Dashboard); everyone else gets the app-wide
-- mask (nine X's + last two digits). Masking happens in Postgres, so an
-- unpermitted browser never receives the real number, and searching by phone
-- on the view only matches what that viewer is allowed to see.
--
-- The view runs as its owner (so it can read the table) and applies the same row
-- rule as the table policy: current_staff_has_permission('sales_issue_tickets').
-- Direct SELECT on the base table is revoked from `authenticated`.
-- Depends on 20261025000000_create_sales_issue_tickets.sql. Re-running is safe.

CREATE OR REPLACE VIEW public.sales_issue_tickets_view
WITH (security_invoker = false) AS
SELECT
  t.id,
  t.ticket_number,
  CASE
    WHEN public.current_staff_has_permission('view_unmasked_customer_phone_numbers')
      THEN t.phone_number
    ELSE 'XXXXXXXXX' || right(t.phone_number, 2)
  END AS phone_number,
  t.description,
  t.status,
  t.raised_by,
  t.raised_by_email,
  t.raised_by_name,
  t.created_at,
  t.updated_at,
  t.notification_status,
  t.notification_error
FROM public.sales_issue_tickets t
WHERE public.current_staff_has_permission('sales_issue_tickets');

REVOKE ALL ON public.sales_issue_tickets_view FROM PUBLIC, anon;
GRANT SELECT ON public.sales_issue_tickets_view TO authenticated, service_role;

REVOKE SELECT ON public.sales_issue_tickets FROM authenticated;
