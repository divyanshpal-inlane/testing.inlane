export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface KmlZone {
  name: string;
  rawName: string;
  kind: "polygon" | "point";
  coords: GeoPoint[];
}

let cachedZones: KmlZone[] | null = null;

export function normalizeName(s: string): string {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function coordsFromText(text: string | null | undefined): GeoPoint[] {
  if (!text) return [];
  const out: GeoPoint[] = [];
  for (const token of text.trim().split(/\s+/)) {
    const [lngStr, latStr] = token.split(",");
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
  }
  return out;
}

function extractPolygonCoords(pm: Element): GeoPoint[] {
  const el =
    pm.querySelector("Polygon > outerBoundaryIs > LinearRing > coordinates") ??
    pm.querySelector(
      "MultiGeometry > Polygon > outerBoundaryIs > LinearRing > coordinates",
    );
  const coords = coordsFromText(el?.textContent);
  return coords.length > 0 ? coords : [];
}

function extractPointCoords(pm: Element): GeoPoint | null {
  const el =
    pm.querySelector("Point > coordinates") ??
    pm.querySelector("MultiGeometry > Point > coordinates");
  const coords = coordsFromText(el?.textContent);
  return coords.length > 0 ? coords[0] : null;
}

export async function fetchKmlData(): Promise<KmlZone[]> {
  if (cachedZones) return cachedZones;
  const url = `${import.meta.env.BASE_URL}instructors.kml`;
  const resp = await fetch(url);
  if (!resp.ok)
    throw new Error(`Failed to load instructor zones (${resp.status}).`);
  const raw = await resp.text();
  const cleaned = raw.replace(/\sxmlns="[^"]*"/g, "");
  const doc = new DOMParser().parseFromString(cleaned, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error("Instructor zones file is not valid XML.");

  const zones: KmlZone[] = [];
  for (const pm of doc.querySelectorAll("Placemark")) {
    const rawName = (pm.querySelector("name")?.textContent ?? "").trim();
    const name = normalizeName(rawName);
    if (!name) continue;
    const polygon = extractPolygonCoords(pm);
    if (polygon.length > 0) {
      zones.push({ name, rawName, kind: "polygon", coords: polygon });
      continue;
    }
    const point = extractPointCoords(pm);
    if (point) zones.push({ name, rawName, kind: "point", coords: [point] });
  }
  cachedZones = zones;
  return zones;
}

export function pointInPolygon(pt: GeoPoint, ring: GeoPoint[]): boolean {
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

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const KML_ALIASES: Record<string, string> = {
  "abhishek n.c": "abhishek",
  suraj: "mohammed hassan (suraj)",
  "mohammed imran a": "mohammed imran a(hsr)",
  "a sagar rao bhonsela": "a sagar rao",
  "vinod kumara b": "vinod kumar",
  "vinod kumara": "vinod kumar",
  adnan: "adnan shama",
  "adnan yunus shama": "adnan shama",
  nirmal: "nirmal s",
  vamsi: "y vamsi krishna",
  "niteesh reddy": "nitheesh reddy",
  "ravi kumar bs": "ravi kumar b s",
  iftekar: "iftekhar",
  "bhanu sir": "bhanu prakash",
};

export function resolveInstructorName(
  kmlName: string,
  dbNames: Set<string>,
): string | null {
  if (dbNames.has(kmlName)) return kmlName;
  const alias = KML_ALIASES[kmlName];
  return alias && dbNames.has(alias) ? alias : null;
}

export const PROXIMITY_RADIUS_KM = 3;

export function matchLocation(
  zones: KmlZone[],
  pt: GeoPoint,
  radiusKm: number = PROXIMITY_RADIUS_KM,
): { names: string[]; via: "polygon" | "point" | "none" } {
  const matched = new Set<string>();
  const polygons: KmlZone[] = [];
  const points: KmlZone[] = [];
  for (const z of zones) (z.kind === "polygon" ? polygons : points).push(z);

  for (const z of polygons) {
    if (pointInPolygon(pt, z.coords)) matched.add(z.name);
  }
  if (matched.size > 0) return { names: [...matched], via: "polygon" };

  let nearest: { name: string; dist: number } | null = null;
  for (const z of points) {
    const dist = haversineKm(pt, z.coords[0]);
    if (dist <= radiusKm) matched.add(z.name);
    if (!nearest || dist < nearest.dist) nearest = { name: z.name, dist };
  }
  if (matched.size > 0) return { names: [...matched], via: "point" };
  if (nearest && nearest.dist <= radiusKm)
    return { names: [nearest.name], via: "point" };
  return { names: [], via: "none" };
}
