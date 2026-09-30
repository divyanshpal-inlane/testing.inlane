// Audits public/instructors.kml for data-quality problems. Read-only; prints a
// report to stdout. Lives in the repo because the KML is the backfill source and
// these checks should be re-runnable whenever Ops re-exports it.
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

// Bundle the live name-resolution helpers out of kml.ts (same trick as
// backfill-instructor-service-zones.mjs) so KML_ALIASES stays single-sourced.
// Without this the DB cross-check below compared raw normalized strings, and
// every aliased spelling showed up as a false "no placemark" / "no zone row"
// finding — e.g. KML's "Mohan Kumar K S" against Instructor "mohan kumar ks".
let resolveInstructorName = null;
const kmlTemp = await mkdtemp(join(tmpdir(), "kml-audit-"));
try {
  // vite's CJS entry is a loader function, so `("esbuild")` selects the
  // subpath — same shape as backfill-instructor-service-zones.mjs.
  const { build } = createRequire(require.resolve("vite"))("esbuild");
  await build({
    stdin: {
      contents:
        'export {resolveInstructorName} from "./src/lib/sales-dashboard/kml";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(kmlTemp, "kml.mjs"),
    alias: { "@": join(process.cwd(), "src") },
  });
  ({ resolveInstructorName } = await import(
    `file://${join(kmlTemp, "kml.mjs").replace(/\\/g, "/")}`
  ));
} catch (e) {
  console.error(
    "audit-instructors-kml: could not load resolveInstructorName from kml.ts " +
      `(${e.message}); the DB cross-check below will report aliased names as ` +
      "unresolved. Run from the repo root with deps installed.",
  );
  process.exitCode = 1;
}

const KML = process.argv[2] || "public/instructors.kml";
const xml = readFileSync(KML, "utf8");

// ---------- parse ----------
const items = [];
for (const m of xml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
  const b = m[1];
  const name = ((b.match(/<name>([\s\S]*?)<\/name>/) || "")[1] || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .trim();
  const descRaw =
    (b.match(/<description>([\s\S]*?)<\/description>/) || "")[1] || "";
  const poly = /<Polygon>([\s\S]*?)<\/Polygon>/.exec(b);
  const pt = /<Point>([\s\S]*?)<\/Point>/.exec(b);
  const coordXml = (poly || pt || [])[1] || "";
  const tuples = (coordXml.match(/<coordinates>([\s\S]*?)<\/coordinates>/) || [
    "",
    "",
  ])[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const pts = tuples.map((t) => {
    const [lng, lat, alt] = t.split(",").map(Number);
    return { lat, lng, alt };
  });
  items.push({
    name,
    kind: poly ? "polygon" : pt ? "point" : "none",
    pts,
    hasAlt: tuples.some((t) => t.split(",").length > 2),
    alt: pts.some((p) => Number.isFinite(p.alt) && p.alt !== 0),
    desc: descRaw
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim(),
  });
}

const polys = items.filter((i) => i.kind === "polygon");
const points = items.filter((i) => i.kind === "point");
const key = (n) => n.toLowerCase().replace(/\s+/g, " ").trim();
const R = 6371,
  rad = Math.PI / 180;

const open = (r) =>
  JSON.stringify(r[0]) === JSON.stringify(r[r.length - 1]) ? r.slice(0, -1) : r;
function areaKm2(ring) {
  const r = open(ring);
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p1 = r[i],
      p2 = r[(i + 1) % r.length];
    a +=
      rad *
      (p2.lng - p1.lng) *
      (2 + Math.sin(p1.lat * rad) + Math.sin(p2.lat * rad));
  }
  return Math.abs((a * R * R) / 2);
}
function centroid(ring) {
  const r = open(ring);
  let x = 0,
    y = 0,
    z = 0;
  for (const p of r) {
    ((x += p.lng * rad), (y += p.lat * rad), (z += 1));
  }
  return { lat: y / z / rad, lng: x / z / rad };
}
function inRing(pt, ring) {
  const r = open(ring);
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const yi = r[i].lat,
      xi = r[i].lng,
      yj = r[j].lat,
      xj = r[j].lng;
    if (
      yi > pt.lat !== yj > pt.lat &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}
function haversine(a, b) {
  const dLat = (b.lat - a.lat) * rad,
    dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// proper segment intersection test (shared endpoints excluded)
function selfIntersects(ring) {
  const r = open(ring);
  const n = r.length;
  if (n < 4) return false;
  const seg = (i) => [r[i], r[(i + 1) % n]];
  const cross = (o, a, b) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const onSeg = (a, b, p) =>
    Math.min(a.lng, b.lng) - 1e-12 <= p.lng &&
    p.lng <= Math.max(a.lng, b.lng) + 1e-12 &&
    Math.min(a.lat, b.lat) - 1e-12 <= p.lat &&
    p.lat <= Math.max(a.lat, b.lat) + 1e-12;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a1, a2] = seg(i),
        [b1, b2] = seg(j);
      const d1 = cross(a1, a2, b1),
        d2 = cross(a1, a2, b2);
      const d3 = cross(b1, b2, a1),
        d4 = cross(b1, b2, a2);
      if (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0) return true;
      if (d1 === 0 && onSeg(a1, a2, b1)) return true;
      if (d2 === 0 && onSeg(a1, a2, b2)) return true;
      if (d3 === 0 && onSeg(b1, b2, a1)) return true;
      if (d4 === 0 && onSeg(b1, b2, a2)) return true;
    }
  }
  return false;
}
const bbox = (r) => ({
  minLat: Math.min(...r.map((p) => p.lat)),
  maxLat: Math.max(...r.map((p) => p.lat)),
  minLng: Math.min(...r.map((p) => p.lng)),
  maxLng: Math.max(...r.map((p) => p.lng)),
});

const out = [];
const P = (s = "") => out.push(s);
P(`KML audit — ${KML}`);
P(
  `placemarks: ${items.length} (${polys.length} polygons, ${points.length} points, ${items.length - polys.length - points.length} other)`,
);
P("");

// ---------- 1. geometry validity ----------
P("## 1. Geometry validity");
const notClosed = polys.filter(
  (p) => JSON.stringify(p.pts[0]) !== JSON.stringify(p.pts.at(-1)),
);
const tooFew = polys.filter((p) => open(p.pts).length < 3);
const outOfRange = polys.filter((p) =>
  p.pts.some(
    (q) =>
      Math.abs(q.lat) > 90 ||
      Math.abs(q.lng) > 180 ||
      !Number.isFinite(q.lat) ||
      !Number.isFinite(q.lng),
  ),
);
const selfInt = polys.filter((p) => selfIntersects(p.pts));
const dupVertex = polys.filter((p) => {
  const r = open(p.pts);
  return r.some(
    (q, i) => i > 0 && q.lat === r[i - 1].lat && q.lng === r[i - 1].lng,
  );
});
const tiny = polys.filter((p) => areaKm2(p.pts) < 0.5);
const zero = polys.filter((p) => areaKm2(p.pts) < 0.01);
P(
  `unclosed rings: ${notClosed.length}${notClosed.length ? " -> " + notClosed.map((p) => p.name).join(", ") : ""}`,
);
P(`rings with <3 distinct vertices: ${tooFew.length}`);
P(`out-of-range / non-finite coords: ${outOfRange.length}`);
P(
  `SELF-INTERSECTING rings: ${selfInt.length}${selfInt.length ? " -> " + selfInt.map((p) => `${p.name} (${open(p.pts).length} pts)`).join("; ") : ""}`,
);
P(`duplicate consecutive vertices: ${dupVertex.length}`);
P(
  `area < 0.5 km2: ${tiny.length}  ${tiny.map((p) => `${p.name} ${areaKm2(p.pts).toFixed(2)}km2`).join("; ")}`,
);
P(`degenerate area (< 0.01 km2): ${zero.length}`);
const altPolys = polys.filter((p) => p.hasAlt),
  altPts = points.filter((p) => p.hasAlt);
P(
  `coords carrying altitude: ${altPolys.length} polygons, ${altPts.length} points`,
);
const counts = polys.map((p) => open(p.pts).length);
P(
  `vertex count min/max/avg: ${Math.min(...counts)}/${Math.max(...counts)}/${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)}`,
);
const areas = polys.map((p) => areaKm2(p.pts));
P(
  `area min/max/median km2: ${Math.min(...areas).toFixed(2)}/${Math.max(...areas).toFixed(2)}/${areas.sort((a, b) => a - b)[Math.floor(areas.length / 2)].toFixed(2)}`,
);
P("");

// ---------- 2. names / descriptions ----------
P("## 2. Names and descriptions");
const nameWs = items.filter((i) => i.name !== i.name.trim());
const nameWeird = items.filter((i) =>
  /[?]{2,}|\(copy\)|test|mock|temp|dummy/i.test(i.name),
);
const noDesc = items.filter((i) => !i.desc);
const nullDesc = items.filter((i) => /^null$/i.test(i.desc.trim()));
const mojibake = items.filter((i) => /Ã|â€|Â|\uFFFD/.test(i.desc + i.name));
const money = items.filter((i) =>
  /₹|\brs\.?\b|\bprice\b|\bpricing\b|\bfee\b|\bcost\b|\bdiscount\b/i.test(
    i.desc,
  ),
);
P(
  `names with leading/trailing whitespace: ${nameWs.length}${nameWs.length ? " -> " + [...new Set(nameWs.map((i) => JSON.stringify(i.name)))].join(", ") : ""}`,
);
P(
  `suspicious names (??/copy/test/mock/temp/dummy): ${nameWeird.length}${nameWeird.length ? " -> " + nameWeird.map((i) => i.name).join(", ") : ""}`,
);
P(
  `empty description: ${noDesc.length}${noDesc.length ? " -> " + noDesc.map((i) => i.name).join(", ") : ""}`,
);
P(
  `description is the literal text "null": ${nullDesc.length}${nullDesc.length ? " -> " + nullDesc.map((i) => i.name).join(", ") : ""}`,
);
P(
  `mojibake in name/description: ${mojibake.length}${mojibake.length ? " -> " + mojibake.map((i) => i.name).join(", ") : ""}`,
);
P(
  `description contains pricing/sales text: ${money.length}${money.length ? " -> " + money.map((i) => i.name).join(", ") : ""}`,
);
P("");

// ---------- 3. name collisions ----------
P("## 3. Name collisions inside the KML");
const byName = new Map();
for (const i of items)
  (
    byName.get(key(i.name)) ?? byName.set(key(i.name), []).get(key(i.name))
  ).push(i);
const dupNames = [...byName.entries()].filter(([, v]) => v.length > 1);
P(`names appearing more than once: ${dupNames.length}`);
for (const [k, v] of dupNames) {
  const polyN = v.filter((x) => x.kind === "polygon").length;
  P(
    `  ${JSON.stringify(k)}: ${v.length} placemarks, ${polyN} polygon(s)${polyN > 1 ? "  <-- CONFLICT" : ""}`,
  );
}
const nearDup = [];
for (let i = 0; i < polys.length; i++)
  for (let j = i + 1; j < polys.length; j++) {
    if (key(polys[i].name) === key(polys[j].name)) continue;
    const a = open(polys[i].pts),
      b = open(polys[j].pts);
    const bs = new Set(b.map((q) => `${q.lat},${q.lng}`));
    const shared = a.filter((q) => bs.has(`${q.lat},${q.lng}`)).length;
    if (shared >= 3 && shared / Math.min(a.length, b.length) > 0.5)
      nearDup.push({
        a: polys[i].name,
        b: polys[j].name,
        shared,
        of: Math.min(a.length, b.length),
      });
  }
P(`polygons sharing >50% of the shorter ring's vertices: ${nearDup.length}`);
for (const d of nearDup)
  P(`  ${d.a} <-> ${d.b}: ${d.shared}/${d.of} identical vertices`);
P("");

// ---------- 4. centroid vs polygon ----------
P("## 4. Point placemark vs its own polygon");
const polyByName = new Map(polys.map((p) => [key(p.name), p]));
const outside = [],
  noPoly = [],
  noPoint = [];
for (const p of points) {
  const poly = polyByName.get(key(p.name));
  if (!poly) {
    noPoly.push(p.name);
    continue;
  }
  const c = centroid(poly.pts);
  if (!inRing(p.pts[0], poly.pts))
    outside.push({ name: p.name, km: haversine(p.pts[0], c), at: p.pts[0], c });
}
for (const p of polys)
  if (!points.some((q) => key(q.name) === key(p.name))) noPoint.push(p.name);
P(`point falls OUTSIDE its own polygon: ${outside.length} of ${points.length}`);
for (const o of outside.sort((a, b) => b.km - a.km))
  P(
    `  ${o.name}: point at ${o.at.lat.toFixed(5)},${o.at.lng.toFixed(5)} is ${o.km.toFixed(1)} km from the polygon's vertex-average (${o.c.lat.toFixed(4)},${o.c.lng.toFixed(4)})`,
  );
P(`point with no polygon at all: ${noPoly.length} -> ${noPoly.join(", ")}`);
P(
  `polygon with no point: ${noPoint.length}${noPoint.length ? " -> " + noPoint.join(", ") : ""}`,
);
P("");

// ---------- 5. polygon overlaps (grid estimate) ----------
P("## 5. Polygon vs polygon overlap");
const bp = polys.map((p) => ({ p, b: bbox(p.pts) }));
const overlaps = [];
for (let i = 0; i < bp.length; i++) {
  for (let j = i + 1; j < bp.length; j++) {
    const A = bp[i],
      B = bp[j];
    if (key(A.p.name) === key(B.p.name)) continue;
    if (
      A.b.maxLat < B.b.minLat ||
      B.b.maxLat < A.b.minLat ||
      A.b.maxLng < B.b.minLng ||
      B.b.maxLng < A.b.minLng
    )
      continue;
    const minLat = Math.max(A.b.minLat, B.b.minLat),
      maxLat = Math.min(A.b.maxLat, B.b.maxLat);
    const minLng = Math.max(A.b.minLng, B.b.minLng),
      maxLng = Math.min(A.b.maxLng, B.b.maxLng);
    const N = 26;
    let both = 0,
      cell = ((maxLat - minLat) / N) * ((maxLng - minLng) / N);
    if (cell <= 0) continue;
    for (let u = 0; u < N; u++)
      for (let v = 0; v < N; v++) {
        const q = {
          lat: minLat + ((u + 0.5) / N) * (maxLat - minLat),
          lng: minLng + ((v + 0.5) / N) * (maxLng - minLng),
        };
        if (inRing(q, A.p.pts) && inRing(q, B.p.pts)) both++;
      }
    if (!both) continue;
    const km2 = both * cell * 111.32 * 111.32 * Math.cos(13 * rad);
    const aA = areaKm2(A.p.pts),
      aB = areaKm2(B.p.pts);
    const pctOfSmaller = (100 * km2) / Math.min(aA, aB);
    if (km2 >= 0.5)
      overlaps.push({
        a: A.p.name,
        b: B.p.name,
        km2,
        pct: pctOfSmaller,
        aA,
        aB,
      });
  }
}
overlaps.sort((x, y) => y.km2 - x.km2);
P(
  `polygon pairs with >= 0.5 km2 shared area: ${overlaps.length} of ${(polys.length * (polys.length - 1)) / 2} possible pairs`,
);
for (const o of overlaps)
  P(
    `  ${o.km2.toFixed(1)} km2 — ${o.a} (${o.aA.toFixed(1)}) <-> ${o.b} (${o.aB.toFixed(1)}) = ${o.pct.toFixed(0)}% of the smaller`,
  );
P("");

// ---------- 6. nested polygons ----------
P("## 6. Fully-contained polygons");
const nested = [];
for (let i = 0; i < bp.length; i++)
  for (let j = 0; j < bp.length; j++) {
    if (i === j || key(bp[i].p.name) === key(bp[j].p.name)) continue;
    const big = bp[i],
      small = bp[j];
    if (areaKm2(small.p.pts) >= areaKm2(big.p.pts)) continue;
    if (open(small.p.pts).every((q) => inRing(q, big.p.pts)))
      nested.push(`${small.p.name} inside ${big.p.name}`);
  }
P(
  `fully contained pairs: ${nested.length}${nested.length ? " -> " + nested.join("; ") : ""}`,
);
P("");

// ---------- 7. DB cross-check ----------
P("## 7. Cross-check against the live DB");
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.includes("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const sb = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data: instr } = await sb
  .from("Instructor")
  .select("id_instructor,name,status,is_company_instructor");
// Alias-aware lookup: dbNames holds every Instructor.name normalized with the
// same key() the KML side uses, and resolveKml() returns the DB name a placemark
// actually resolves to (or null). This replaces a raw key() === key() compare,
// which reported known spelling aliases as missing data.
const dbNames = new Set(instr.map((i) => key(i.name || "")));
const resolveKml = (kmlName) => {
  if (resolveInstructorName)
    return resolveInstructorName(key(kmlName), dbNames);
  return dbNames.has(key(kmlName)) ? key(kmlName) : null;
};
const noKml = instr.filter(
  (i) => !items.some((p) => resolveKml(p.name) === key(i.name || "")),
);
P(`Instructor rows: ${instr.length}`);
P(`Instructor rows with NO placemark in the KML: ${noKml.length}`);
for (const i of noKml)
  P(
    `  ${JSON.stringify(i.name)} [${i.status}]${i.is_company_instructor ? " COMPANY BACKUP" : ""}`,
  );
const activeNoKml = noKml.filter((i) => i.status === "active");
P(
  `  of which status=active: ${activeNoKml.length} -> ${activeNoKml.map((i) => i.name).join(", ")}`,
);
P(
  `on_break with no placemark: ${noKml.filter((i) => i.status === "on_break").length}`,
);
const { data: zones } = await sb
  .from("instructor_service_zones")
  .select("instructor_id,kind,coordinates,Instructor(name)");
const zoneById = new Map(zones.map((z) => [z.instructor_id, z]));
const polyResolved = polys.filter((p) => {
  const hit = instr.find((i) => resolveKml(p.name) === key(i.name || ""));
  return hit && zoneById.has(hit.id_instructor);
});
P(
  `polygons resolving to an Instructor that HAS a zone row: ${polyResolved.length}/${polys.length}`,
);
const noZone = polys.filter((p) => {
  const hit = instr.find((i) => resolveKml(p.name) === key(i.name || ""));
  return !hit || !zoneById.has(hit.id_instructor);
});
if (noZone.length)
  P(`  polygons with no zone row: ${noZone.map((p) => p.name).join(", ")}`);
// Reverse direction: a live zone whose instructor has no KML placemark.
// Alias-aware too — resolved as "does ANY placemark resolve to this Instructor",
// not a literal name compare, otherwise "mohan kumar ks" is reported as
// unbacked simply because the KML spells it "Mohan Kumar K S".
const extraZones = zones.filter(
  (z) =>
    !items.some((p) => resolveKml(p.name) === key(z.Instructor?.name || "")),
);
P(
  `live zone rows with no KML polygon: ${extraZones.length}${extraZones.length ? " -> " + extraZones.map((z) => `${z.Instructor?.name} (${z.coordinates.length} pts, ${z.kind})`).join("; ") : ""}`,
);
P(
  `live zone rows per instructor >1: ${instr.filter((i) => zones.filter((z) => z.instructor_id === i.id_instructor).length > 1).length}`,
);

console.log(out.join("\n"));

// Clean up the bundled helper. Uses the awaited rm rather than exiting, so the
// live Supabase client's socket is not severed mid-flight (that trips a libuv
// assertion on Windows — the same reason verify-instructor-service-zones.mjs
// sets process.exitCode instead of calling process.exit()).
await rm(kmlTemp, { recursive: true, force: true });
