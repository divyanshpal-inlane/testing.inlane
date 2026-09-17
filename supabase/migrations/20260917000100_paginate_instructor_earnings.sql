-- Keep name, phone and KAM search in the database before PostgREST applies
-- the requested range. EXISTS avoids duplicate instructors for multiple KAMs.
CREATE OR REPLACE FUNCTION public.get_earnings_instructors(p_search TEXT DEFAULT '')
RETURNS TABLE (id_instructor UUID, name TEXT, phone TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT i.id_instructor, i.name::TEXT, i.phone::TEXT
    FROM public."Instructor" i
    WHERE COALESCE(p_search, '') = ''
       OR strpos(lower(COALESCE(i.name, '')), lower(p_search)) > 0
       OR strpos(lower(COALESCE(i.phone, '')), lower(p_search)) > 0
       OR EXISTS (
           SELECT 1
           FROM public.kam_instructor ki
           JOIN public."KAM" k ON k.id = ki.kam_id
           WHERE ki.instructor_id = i.id_instructor
             AND strpos(lower(k.name), lower(p_search)) > 0
       );
$$;

GRANT EXECUTE ON FUNCTION public.get_earnings_instructors(TEXT) TO anon, authenticated;
