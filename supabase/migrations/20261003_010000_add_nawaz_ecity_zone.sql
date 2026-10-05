-- Generated from "Lane instructor driving zones.kmz" (re-exported 2026-10-03).
-- 1 polygon row. Review before applying. Idempotent (DO NOTHING).
-- The KMZ placemark "NAWAZ" belongs to the existing instructor
-- "Mohammed Nawaz" (be7338ab-8952-4aba-ba07-1cba6d41f5da, phone 9980805589, Electronic City, Bengaluru),
-- which had no service-area polygon. The ring contains both the KMZ point
-- "NAWAZ" and the instructor's saved residence.
-- NOTE: 16 vertices exceeds MAX_VERTICES (200) in
-- ZoneDrawingEditor, so the boundary cannot be reshaped in the UI until it is
-- simplified. Inserted by script, which does not enforce that app-level cap.
-- DO NOTHING: this instructor had no zone, so nothing is overwritten.
INSERT INTO public.instructor_service_zones(instructor_id,kind,coordinates,raw_name,description) VALUES
('be7338ab-8952-4aba-ba07-1cba6d41f5da','polygon','[{"lat":12.8211991,"lng":77.6438811},{"lat":12.8177771,"lng":77.6540282},{"lat":12.8203064,"lng":77.6663115},{"lat":12.8319857,"lng":77.6712706},{"lat":12.8425486,"lng":77.6716521},{"lat":12.8502102,"lng":77.6680662},{"lat":12.8557889,"lng":77.6632597},{"lat":12.858541,"lng":77.6554777},{"lat":12.8609956,"lng":77.649069},{"lat":12.8600286,"lng":77.6425078},{"lat":12.8568302,"lng":77.6361754},{"lat":12.8516979,"lng":77.6321318},{"lat":12.8436644,"lng":77.629843},{"lat":12.8343661,"lng":77.6315977},{"lat":12.8246211,"lng":77.6354887},{"lat":12.8211991,"lng":77.6438811}]','NAWAZ',NULL)
ON CONFLICT (instructor_id) DO NOTHING;
