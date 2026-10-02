// Compares the live `instructor_service_zones` rows against the KML source the
// sales availability dashboard used before the polygon migration, so we can
// prove the DB copy is faithful and that no coverage was lost.
//
//   node scripts/compare-kml-vs-db-zones.mjs
//
// Uses the SAME normalizeName()/resolveInstructorName() helpers as the live
// dashboard, so the KML_ALIASES spelling map is never duplicated.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const fs = require("node:fs");

const KML_PATH = "public/instructors.kml";

// --- KML parsing (mirrors src/lib/sales-dashboard/kml.ts) -------------------
function coordsFromText(text) {
  const out = [];
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    const [lngStr, latStr] = token.split(",");
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
  }
  return out;
}
function closeRing(ring) {
  if (ring.length < 3) return ring;
  const f = ring[0];
  const l = ring[ring.length - 1];
  return f.lat === l.lat && f.lng === l.lng ? ring : [...ring, { ...f }];
}
function parseKml(xml) {
  const zones = [];
  for (const pm of xml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const body = pm[1];
    const rawName = (body.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? "").trim();
    if (!rawName) continue;
    const description = (
      body.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? ""
    )
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<br\s*\/?>/gi, "\n")
      .trim();
    const poly = body.match(
      /<Polygon>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/,
    );
    if (poly) {
      const coords = closeRing(coordsFromText(poly[1]));
      if (coords.length >= 3)
        zones.push({ rawName, description, kind: "polygon", coords });
      continue;
    }
    const pt = body.match(
      /<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/,
    );
    if (pt) {
      const coords = coordsFromText(pt[1]).slice(0, 1);
      if (coords.length === 1)
        zones.push({ rawName, description, kind: "point", coords });
    }
  }
  return zones;
}
function loadEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional; callers fall back to the process environment.
  }
  return out;
}
// Max absolute difference between two rings, or null when shapes differ.
function ringDelta(a, b) {
  if (a.length !== b.length) return null;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(
      max,
      Math.abs(a[i].lat - b[i].lat),
      Math.abs(a[i].lng - b[i].lng),
    );
  }
  return max;
}

const temp = await mkdtemp(join(tmpdir(), "kml-vs-db-"));
try {
  await build({
    stdin: {
      contents:
        'export {normalizeName, resolveInstructorName, pointInPolygon, haversineKm} from "./src/lib/sales-dashboard/kml";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(temp, "kml.mjs"),
    alias: { "@": resolve("src") },
  });
  const { normalizeName, resolveInstructorName, pointInPolygon, haversineKm } =
    await import(pathToFileURL(join(temp, "kml.mjs")));

  const xml = await readFile(KML_PATH, "utf8");
  const zones = parseKml(xml);
  const kmlPolys = zones.filter((z) => z.kind === "polygon");
  const kmlPoints = zones.filter((z) => z.kind === "point");
  console.log(
    `KML: ${zones.length} placemarks — ${kmlPolys.length} polygons, ${kmlPoints.length} points\n`,
  );

  const env = loadEnv();
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key =
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY");
  const H = { apikey: key, Authorization: `Bearer ${key}` };

  const instructors = await fetch(
    `${url}/rest/v1/Instructor?select=id_instructor,name`,
    { headers: H },
  ).then((r) => r.json());
  const byNorm = new Map();
  for (const i of instructors)
    if (i.name) byNorm.set(normalizeName(i.name), i.id_instructor);
  const dbNorm = new Set(byNorm.keys());

  const live = await fetch(
    `${url}/rest/v1/instructor_service_zones?select=instructor_id,kind,coordinates,raw_name,description,Instructor(name)`,
    { headers: H },
  ).then((r) => r.json());
  const liveById = new Map(live.map((r) => [r.instructor_id, r]));
  console.log(
    `DB:  ${instructors.length} instructors, ${live.length} zone rows\n`,
  );

  // Resolve each KML polygon -> instructor id. Track collisions (KML has more
  // polygons than the schema allows rows per instructor).
  const kmlById = new Map();
  const collisions = [];
  for (const z of kmlPolys) {
    const resolved = resolveInstructorName(normalizeName(z.rawName), dbNorm);
    if (!resolved) {
      console.log(`  KML polygon UNRESOLVED: "${z.rawName}"`);
      continue;
    }
    const id = byNorm.get(resolved);
    if (kmlById.has(id)) {
      collisions.push({ id, kept: kmlById.get(id), dropped: z });
      continue; // backfill's Map kept the first; later one is silently lost
    }
    kmlById.set(id, z);
  }

  // ---- 1. faithful-copy check -------------------------------------------
  let exact = 0,
    near = 0,
    differing = 0,
    missing = 0;
  for (const [id, kml] of kmlById) {
    const row = liveById.get(id);
    if (!row) {
      missing++;
      console.log(
        `  MISSING in DB: ${kml.rawName} (${kml.coords.length} pts) — id ${id}`,
      );
      continue;
    }
    if (row.kind !== "polygon") {
      differing++;
      console.log(`  KIND differs: ${kml.rawName} — DB kind=${row.kind}`);
      continue;
    }
    const delta = ringDelta(kml.coords, row.coordinates);
    if (delta === null) {
      differing++;
      console.log(
        `  SHAPE differs: ${kml.rawName} — KML ${kml.coords.length} pts vs DB ${row.coordinates.length} pts`,
      );
    } else if (delta === 0) {
      exact++;
    } else {
      near++;
      console.log(`  NEAR-MISS: ${kml.rawName} — max coord delta ${delta}`);
    }
  }
  console.log(
    `\n1. KML polygon -> DB row fidelity: ${exact} identical, ${near} near-miss, ` +
      `${differing} shape/kind mismatch, ${missing} missing`,
  );

  // ---- 2. DB rows with no KML polygon ------------------------------------
  const orphans = live.filter((r) => !kmlById.has(r.instructor_id));
  console.log(`\n2. DB rows not backed by a KML polygon: ${orphans.length}`);
  for (const o of orphans)
    console.log(
      `  ${o.Instructor?.name ?? o.instructor_id} — kind=${o.kind} ${o.coordinates?.length}pts`,
    );

  // ---- 3. KML polygons that collapsed into one row -----------------------
  // The backfill used an unconditional rows.set(), so for a duplicated name the
  // LAST placemark won. Report which candidate the DB actually holds.
  console.log(`\n3. KML polygons sharing one instructor: ${collisions.length}`);
  for (const c of collisions) {
    const row = liveById.get(c.id);
    const dKept = ringDelta(c.kept.coords, row?.coordinates ?? []);
    const dDropped = ringDelta(c.dropped.coords, row?.coordinates ?? []);
    const inDb =
      dDropped === 0
        ? "the SECOND (backfill kept the last)"
        : dKept === 0
          ? "the FIRST"
          : "neither (differs from both)";
    console.log(`  ${c.kept.rawName} — DB holds ${inDb}`);
    console.log(`     first:  ${c.kept.coords.length} pts`);
    console.log(`     second: ${c.dropped.coords.length} pts`);
  }

  // ---- 4. point placemarks: old fallback no longer exists ----------------
  console.log(
    `\n4. Point placemarks: ${kmlPoints.length} in KML, ` +
      `${live.filter((r) => r.kind === "point").length} in DB.`,
  );
  // How many point-only instructors would lose matching entirely?
  const pointOnly = kmlPoints.filter((p) => {
    const resolved = resolveInstructorName(normalizeName(p.rawName), dbNorm);
    return resolved && !kmlById.has(byNorm.get(resolved));
  });
  console.log(
    `   point-only instructors (no polygon at all): ${pointOnly.length}`,
  );
  for (const p of pointOnly.slice(0, 20)) console.log(`     ${p.rawName}`);
  if (pointOnly.length > 20)
    console.log(`     ...and ${pointOnly.length - 20} more`);

  // ---- 5. name/description drift -----------------------------------------
  const nameDrift = [];
  for (const [id, kml] of kmlById) {
    const row = liveById.get(id);
    if (row && (row.raw_name ?? "") !== kml.rawName)
      nameDrift.push(`${kml.rawName} -> ${row.raw_name}`);
  }
  console.log(`\n5. raw_name drift vs KML: ${nameDrift.length}`);
  nameDrift.forEach((d) => console.log(`  ${d}`));

  // ---- 6. who loses the 3km point fallback --------------------------------
  // Old matchLocation(): polygons first, and the point fallback ran ONLY when
  // no polygon matched. New path is polygon-only, so any centroid that sits
  // outside its own polygon can no longer be reached.
  const centroidOf = new Map();
  for (const p of kmlPoints) {
    const resolved = resolveInstructorName(normalizeName(p.rawName), dbNorm);
    if (!resolved) continue;
    const id = byNorm.get(resolved);
    if (!centroidOf.has(id))
      centroidOf.set(id, { rawName: p.rawName, pt: p.coords[0] });
  }

  const noPolygon = [];
  const centroidOutside = [];
  for (const [id, c] of centroidOf) {
    const kmlPoly = kmlById.get(id);
    if (!kmlPoly) {
      noPolygon.push(`${c.rawName} (no polygon in KML at all)`);
      continue;
    }
    if (!liveById.has(id)) {
      noPolygon.push(`${c.rawName} (polygon not yet in DB)`);
      continue;
    }
    if (!pointInPolygon(c.pt, kmlPoly.coords)) {
      // Distance from the centroid to the nearest polygon vertex, as a rough
      // sense of how far outside it sits.
      let best = Infinity;
      for (const v of kmlPoly.coords)
        best = Math.min(best, haversineKm(c.pt, v));
      centroidOutside.push(
        `${c.rawName} — centroid ~${best.toFixed(1)} km from its polygon`,
      );
    }
  }
  console.log(
    `\n6. Reachable only via the dropped 3km point fallback: ` +
      `${noPolygon.length + centroidOutside.length} instructor(s)`,
  );
  console.log(
    `   (a) centroid exists but no polygon in DB: ${noPolygon.length}`,
  );
  noPolygon.forEach((s) => console.log(`     ${s}`));
  console.log(
    `   (b) centroid falls OUTSIDE its own polygon: ${centroidOutside.length}`,
  );
  centroidOutside.forEach((s) => console.log(`     ${s}`));
} finally {
  await rm(temp, { recursive: true, force: true });
}
