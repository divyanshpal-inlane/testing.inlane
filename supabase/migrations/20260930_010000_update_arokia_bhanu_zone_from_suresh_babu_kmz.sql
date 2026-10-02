-- Generated from "Lane instructor driving zones.kmz" (exported 2026-09-30).
-- 1 polygon row. Review before applying. Idempotent.
-- The KML placemark "Suresh Babu" is the service area for instructor
-- "Arokia (BHANU)" (78b4fbf0-f847-47bd-b373-a5cae63f3c69). Its previous ring
-- came from the 2026-09-28 export (20 pts); this export redraws it as 23 pts.
-- Overwritten on purpose - DO NOTHING would silently keep the stale ring.
INSERT INTO public.instructor_service_zones(instructor_id,kind,coordinates,raw_name,description) VALUES
('78b4fbf0-f847-47bd-b373-a5cae63f3c69','polygon','[{"lat":12.9818861,"lng":77.608939},{"lat":12.9783481,"lng":77.6152597},{"lat":12.9773735,"lng":77.6197933},{"lat":12.9774026,"lng":77.6256143},{"lat":12.9805298,"lng":77.6302732},{"lat":12.9830711,"lng":77.6330808},{"lat":12.9839654,"lng":77.6378748},{"lat":12.9861979,"lng":77.6430981},{"lat":12.9904513,"lng":77.6495337},{"lat":12.9932785,"lng":77.6491167},{"lat":13.001014,"lng":77.6460593},{"lat":13.0035828,"lng":77.644313},{"lat":13.0069744,"lng":77.6414318},{"lat":13.0090198,"lng":77.6404075},{"lat":13.0105418,"lng":77.6365835},{"lat":13.0126369,"lng":77.6342377},{"lat":13.0147213,"lng":77.6295},{"lat":13.0142689,"lng":77.6223108},{"lat":13.0116769,"lng":77.6090708},{"lat":13.0057691,"lng":77.6030891},{"lat":13.0004466,"lng":77.6019139},{"lat":12.986153,"lng":77.6046023},{"lat":12.9818861,"lng":77.608939}]'::jsonb,'Suresh Babu','6 am to 4 pm
sunday off
I20
hindi kannada,')
ON CONFLICT (instructor_id) DO UPDATE SET coordinates=EXCLUDED.coordinates, kind=EXCLUDED.kind, raw_name=EXCLUDED.raw_name, description=EXCLUDED.description, updated_at=now();
