import type { GeoPoint } from "./kml";

/**
 * Used only when `booking_flow.nearby_radius_km` is not set in app_settings.
 * The real value is a DB setting; this just keeps the feature usable before
 * anyone has configured it.
 */
export const DEFAULT_NEARBY_RADIUS_KM = 3;

/**
 * Cap on how many nearby instructors a location search adds (closest first),
 * used when `booking_flow.nearby_max_results` is not set. Keeps a search from
 * loading every instructor around the pin, which is what made it slow.
 */
export const DEFAULT_NEARBY_MAX_RESULTS = 5;

const KM_PER_DEGREE_LAT = 111.32;

/**
 * Shortest distance, in km, from `pt` to the BOUNDARY of a polygon ring.
 *
 * Walks every side of the ring and finds the closest point on that side (the
 * foot of the perpendicular from `pt`, or the nearer corner when the foot falls
 * past either end), then keeps the smallest distance. It does not test whether
 * `pt` is inside -- callers do that first with `pointInPolygon`.
 *
 * Over a city the earth is treated as flat: corners are converted to km around
 * `pt` (1 deg lat ~ 111.32 km, 1 deg lng ~ 111.32 * cos(lat) km), which is
 * accurate to metres at this scale and avoids spherical maths per side.
 */
export function distanceToPolygonKm(pt: GeoPoint, ring: GeoPoint[]): number {
  if (ring.length === 0) return Infinity;
  const kmPerDegLng = KM_PER_DEGREE_LAT * Math.cos((pt.lat * Math.PI) / 180);
  const toXY = (p: GeoPoint): [number, number] => [
    (p.lng - pt.lng) * kmPerDegLng,
    (p.lat - pt.lat) * KM_PER_DEGREE_LAT,
  ];

  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = toXY(ring[j]);
    const [bx, by] = toXY(ring[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    // The pin is the origin, so the projection parameter is -A.(B-A)/|B-A|^2.
    const t =
      lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}
