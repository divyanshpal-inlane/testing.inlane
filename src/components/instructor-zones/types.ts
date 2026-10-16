// A type alias (not an interface) so ZoneCoordinate[] is assignable to the
// supabase `Json` type used by instructor_service_zones.coordinates.
export type ZoneCoordinate = {
  lat: number;
  lng: number;
};
