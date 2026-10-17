// Distance helpers for the Zone Map's "Measure distance" tool (instructor home
// -> any location). Pure except `fetchRoadRoute`, which needs Google Maps, so
// tests/map-distance.test.mjs can load everything else.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle ("as the crow flies") distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "850 m", "3.2 km", "18 km" -- metres below 1 km, one decimal below 100 km. */
export function formatKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** "1 min", "44 min", "1 h 05 min". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

export type ParsedCoordinates =
  | { ok: true; at: LatLng; swapped: boolean }
  | { ok: false; error: string };

// Roughly India: used only to spot a "lng, lat" paste that would otherwise be
// accepted (both numbers are valid latitudes/longitudes) and put the pin in the
// wrong country.
const inIndiaLat = (v: number) => v >= 5 && v <= 38;
const inIndiaLng = (v: number) => v >= 66 && v <= 99;

/**
 * Parses "12.9716, 77.5946" (also "12.9716 77.5946", "12.9716;77.5946", with an
 * optional degree sign, N/S/E/W letters, or surrounding brackets -- the formats
 * Google Maps and phones produce). A "longitude, latitude" paste that is
 * unambiguously India is corrected and flagged `swapped`.
 */
export function parseCoordinates(text: string): ParsedCoordinates {
  const cleaned = text
    .replace(/[()[\]]/g, " ")
    .replace(/°/g, "")
    // "12.97 N" -> "12.97N" so the compass letter stays with its number
    .replace(/(\d)\s+([NSEWnsew])(?![A-Za-z])/g, "$1$2")
    .trim();
  if (!cleaned) return { ok: false, error: "Enter latitude and longitude." };

  const tokens = cleaned.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length !== 2) {
    return {
      ok: false,
      error: 'Enter two numbers, like "12.9716, 77.5946" (latitude first).',
    };
  }

  const num = (t: string): number | null => {
    const m = /^(-?\d+(?:\.\d+)?)([NSEWnsew])?$/.exec(t);
    if (!m) return null;
    const v = Number(m[1]);
    return /[SsWw]/.test(m[2] ?? "") ? -Math.abs(v) : v;
  };
  const a = num(tokens[0]);
  const b = num(tokens[1]);
  if (a === null || b === null) {
    return { ok: false, error: "Those don't look like numbers." };
  }

  let lat = a;
  let lng = b;
  let swapped = false;
  if (inIndiaLng(a) && inIndiaLat(b) && !(inIndiaLat(a) && inIndiaLng(b))) {
    lat = b;
    lng = a;
    swapped = true;
  }
  if (lat < -90 || lat > 90) {
    return { ok: false, error: "Latitude must be between -90 and 90." };
  }
  if (lng < -180 || lng > 180) {
    return { ok: false, error: "Longitude must be between -180 and 180." };
  }
  return { ok: true, at: { lat, lng }, swapped };
}

export interface RoadRoute {
  meters: number;
  seconds: number;
}

const routeCache = new Map<string, RoadRoute | null>();
const key = (a: LatLng, b: LatLng) =>
  `${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

/**
 * Driving distance and time between two points, or `null` when it cannot be
 * had (API disabled / quota / no route / offline). Never throws: the caller
 * shows the straight-line figure instead.
 *
 * Tries the current `Route.computeRoutes`, then the older `DirectionsService`
 * (Google deprecated it in 2026 but it still works, and the app's other map
 * code uses it). No live traffic is included.
 */
export async function fetchRoadRoute(
  maps: typeof google.maps,
  from: LatLng,
  to: LatLng,
): Promise<RoadRoute | null> {
  const k = key(from, to);
  if (routeCache.has(k)) return routeCache.get(k) ?? null;

  let result: RoadRoute | null = null;
  try {
    const lib = (await maps.importLibrary(
      "routes",
    )) as google.maps.RoutesLibrary;

    try {
      const res = await lib.Route.computeRoutes({
        origin: from,
        destination: to,
        travelMode: "DRIVING" as google.maps.TravelMode,
        fields: ["distanceMeters", "durationMillis"],
      });
      const r = res.routes?.[0];
      if (r?.distanceMeters != null) {
        result = {
          meters: r.distanceMeters,
          seconds: Math.round((r.durationMillis ?? 0) / 1000),
        };
      }
    } catch {
      /* fall through to the older API */
    }

    if (!result) {
      const res = await new lib.DirectionsService().route({
        origin: from,
        destination: to,
        travelMode: "DRIVING" as google.maps.TravelMode,
        region: "IN",
      });
      const leg = res.routes?.[0]?.legs?.[0];
      if (leg?.distance && leg.duration) {
        result = { meters: leg.distance.value, seconds: leg.duration.value };
      }
    }
  } catch {
    result = null;
  }

  // Only successes are cached, so a transient failure is retried next time.
  if (result) routeCache.set(k, result);
  return result;
}
