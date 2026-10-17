// Pure geometry for the service-area (white / grey) editor. No Google Maps or
// React imports, so tests/service-area-geometry.test.mjs can load this file.

export interface LatLng {
  lat: number;
  lng: number;
}

/** Ray-cast point-in-ring (even-odd). The ring may be open or closed. */
export function pointInRing(pt: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.lat > pt.lat !== b.lat > pt.lat &&
      pt.lng < ((b.lng - a.lng) * (pt.lat - a.lat)) / (b.lat - a.lat) + a.lng
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function cross(o: LatLng, a: LatLng, b: LatLng): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

/**
 * True when the two segments properly cross (an X). Touching at an endpoint or
 * running along each other does NOT count: neighbouring areas legitimately
 * share a boundary, and float noise there must not read as an overlap.
 */
function segmentsCross(
  p1: LatLng,
  p2: LatLng,
  p3: LatLng,
  p4: LatLng,
): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** A ring whose own edges cross each other (a bow-tie / figure-eight). */
export function ringSelfIntersects(ring: LatLng[]): boolean {
  const n = ring.length;
  if (n < 4) return false; // a triangle cannot cross itself
  for (let i = 0; i < n; i++) {
    const a1 = ring[i];
    const a2 = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Edges that share a vertex are neighbours, not crossings.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsCross(a1, a2, ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Two areas overlap when any pair of edges properly cross, or one lies inside
 * the other (a vertex of one strictly inside the other). Sharing a boundary is
 * fine.
 */
export function ringsOverlap(a: LatLng[], b: LatLng[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (
        segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])
      )
        return true;
    }
  }
  // No edges cross: either disjoint or one contains the other. A vertex test
  // on both sides covers containment either way round.
  return pointInRing(a[0], b) || pointInRing(b[0], a);
}

/** Centroid of the vertices; good enough to test "is this pocket in an area". */
export function vertexCentroid(ring: LatLng[]): LatLng {
  const n = ring.length || 1;
  return {
    lat: ring.reduce((s, p) => s + p.lat, 0) / n,
    lng: ring.reduce((s, p) => s + p.lng, 0) / n,
  };
}

/** Signed area in degrees² (sign = winding), used to orient holes. */
export function signedArea(ring: LatLng[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.lng * b.lat - b.lng * a.lat;
  }
  return s;
}

/**
 * Whether a point is in the served (white) area: inside some serviceable ring
 * and inside no excluded ring.
 */
export function isServiceable(
  pt: LatLng,
  serviceable: LatLng[][],
  excluded: LatLng[][],
): boolean {
  return (
    serviceable.some((r) => pointInRing(pt, r)) &&
    !excluded.some((r) => pointInRing(pt, r))
  );
}
