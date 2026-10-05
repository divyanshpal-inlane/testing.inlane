-- Generated from "Lane instructor driving zones.kmz" (exported 2026-10-03).
-- 1 polygon row. Review before applying. Idempotent (DO NOTHING).
-- The KMZ point "Syed Alishan" (Mysuru) belongs to the existing instructor
-- "Syed Ali shan " (49f4d921-5e9c-4ab8-8a43-823e96bf0260, Dr Rajkumar Rd, Mysuru). Its polygon is the
-- UNNAMED placemark "Polygon 148" (16 pts), which scripts/clean-instructors-kml.mjs
-- drops as an editor scratch item. It contains both the KMZ point and the
-- instructor's saved residence, so it is his service area.
-- DO NOTHING: this instructor had no zone, so nothing is overwritten.
INSERT INTO public.instructor_service_zones(instructor_id,kind,coordinates,raw_name,description) VALUES
('49f4d921-5e9c-4ab8-8a43-823e96bf0260','polygon','[{"lat":12.3346552,"lng":76.6508469},{"lat":12.32397,"lng":76.6491032},{"lat":12.3132013,"lng":76.6534536},{"lat":12.3081289,"lng":76.6595169},{"lat":12.3059914,"lng":76.6654083},{"lat":12.3042932,"lng":76.6736123},{"lat":12.3058428,"lng":76.6791067},{"lat":12.3059257,"lng":76.6835705},{"lat":12.3057361,"lng":76.6884633},{"lat":12.3061851,"lng":76.6929791},{"lat":12.3086527,"lng":76.6998504},{"lat":12.3148309,"lng":76.7025163},{"lat":12.3314193,"lng":76.6960856},{"lat":12.344138,"lng":76.6746022},{"lat":12.3429373,"lng":76.6570487},{"lat":12.3346552,"lng":76.6508469}]','Syed Alishan','Timings: 6 AM to 9 AM 5 PM to 8 PM')
ON CONFLICT (instructor_id) DO NOTHING;
