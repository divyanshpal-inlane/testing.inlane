-- Filter before PostgREST applies count/order/range. SQL STABLE and invoker
-- security allow inlining and preserve the Learner table's existing RLS.
CREATE OR REPLACE FUNCTION public.get_car_leads(
  search_term text DEFAULT '',
  area_filter text DEFAULT 'all',
  planning_filter text DEFAULT 'all'
)
RETURNS SETOF public."Learner"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT l.*
  FROM public."Learner" l
  WHERE (
    l.driving_motivation = 'Finally buy my own car'
    OR l.car_intent_planning = 'Yes'
    OR l.car_purchase_timeline ~ '[^[:space:]]'
  )
    -- Literal substring search preserves the existing name/phone search,
    -- including searches containing punctuation or SQL wildcard characters.
    AND strpos(
      lower(coalesce(l.name, '') || ' ' || coalesce(l.phone, '')),
      lower(search_term)
    ) > 0
    AND (area_filter = 'all' OR l.area = area_filter)
    AND (
      planning_filter = 'all'
      OR (planning_filter = 'yes' AND l.car_intent_planning = 'Yes')
      OR (planning_filter = 'onboarding' AND l.driving_motivation IS NOT NULL)
    );
$$;

-- Return only distinct areas, so the dropdown does not depend on the page
-- being viewed and never needs to download every lead.
CREATE OR REPLACE FUNCTION public.get_car_lead_areas()
RETURNS TABLE(area text)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT DISTINCT l.area
  FROM public.get_car_leads() l
  WHERE l.area IS NOT NULL AND l.area <> ''
  ORDER BY l.area;
$$;

REVOKE ALL ON FUNCTION public.get_car_leads(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_car_lead_areas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_car_leads(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_car_lead_areas() TO authenticated;

NOTIFY pgrst, 'reload schema';
