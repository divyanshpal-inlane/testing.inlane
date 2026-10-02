// Backfill instructor_service_zones from public/instructors.kml.
//
// Run from the project root:
//   node scripts/backfill-instructor-service-zones.mjs            # dry run, writes SQL only
//   node scripts/backfill-instructor-service-zones.mjs --parse-only  # validate parsing, no DB
//   node scripts/backfill-instructor-service-zones.mjs --overwrite # also UPDATE rows that
//                                                                   # already have a polygon
//   node scripts/backfill-instructor-service-zones.mjs --only="Ameen / Arokia,Salauddin" out.sql
//                                                                   # emit only these instructors,
//                                                                   # as DO UPDATE (implies
//                                                                   # --overwrite for those rows)
//
// Reads the KML, resolves each placemark to an Instructor row using the SAME
// normalizeName()/resolveInstructorName() helpers the live dashboard uses (so
// the KML_ALIASES spelling map is never duplicated here), and emits an
// idempotent SQL file. The script never writes to the database itself — review
// the generated SQL, then apply it with `supabase db push` or the SQL editor.
//
// Existing rows are left alone by default (DO NOTHING) so hand-drawn polygons
// are never clobbered by a re-run.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const KML_PATH =
  process.argv.find((a) => a.endsWith(".kml")) || "public/instructors.kml";
const OVERWRITE = process.argv.includes("--overwrite");
const PARSE_ONLY = process.argv.includes("--parse-only");
// Restrict the emitted rows to these instructors (KML raw_name or Instructor id),
// for incremental "the source KML changed" migrations. Such rows must overwrite,
// otherwise a re-run silently keeps the stale ring and fixes nothing.
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "")
  .slice("--only=".length)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT_PATH =
  process.argv.find((a) => a.endsWith(".sql")) ||
  "supabase/migrations/20260928_010000_backfill_instructor_service_zones.sql";

// Mirrors src/lib/sales-dashboard/kml.ts coordsFromText(): whitespace-separated
// "lng,lat[,alt]" tuples. The live parser uses DOMParser, which Node lacks, so
// the same token format is parsed here.
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

// KML rings are usually already closed; normalise so the stored ring always
// repeats the first point last (the zone CHECK constraint wants >= 3 vertices
// and the editor renders an open ring).
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
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") // strip XML CDATA wrapper
      .replace(/<br\s*\/?>/gi, "\n") // keep the line breaks readable
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
    for (const line of require("node:fs")
      .readFileSync(".env", "utf8")
      .split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* .env is optional; env vars may already be exported */
  }
  return out;
}

const temp = await mkdtemp(join(tmpdir(), "zone-backfill-"));
try {
  // Import the live name-resolution helpers so KML_ALIASES stays single-sourced.
  await build({
    stdin: {
      contents:
        'export {normalizeName, resolveInstructorName} from "./src/lib/sales-dashboard/kml";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(temp, "kml.mjs"),
    alias: { "@": resolve("src") },
  });
  const { normalizeName, resolveInstructorName } = await import(
    pathToFileURL(join(temp, "kml.mjs"))
  );

  const xml = await readFile(KML_PATH, "utf8");
  const zones = parseKml(xml);
  const polygonZones = zones.filter((z) => z.kind === "polygon");
  const pointZones = zones.filter((z) => z.kind === "point");
  console.log(
    `Parsed ${zones.length} placemarks from ${KML_PATH} (${polygonZones.length} polygons, ${pointZones.length} points).`,
  );
  if (!polygonZones.length)
    throw Error("No polygons found in the KML — aborting.");

  if (PARSE_ONLY) {
    const counts = polygonZones.map((z) => z.coords.length);
    const closed = polygonZones.filter(
      (z) =>
        z.coords[0].lat === z.coords[z.coords.length - 1].lat &&
        z.coords[0].lng === z.coords[z.coords.length - 1].lng,
    ).length;
    console.log(
      `Vertex counts: min ${Math.min(...counts)}, max ${Math.max(...counts)}, avg ${(
        counts.reduce((a, b) => a + b, 0) / counts.length
      ).toFixed(1)}`,
    );
    console.log(`Rings already closed: ${closed}/${polygonZones.length}`);
    console.log("parse-only: no database contacted.");
    process.exit(0);
  }

  const env = loadEnv();
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key =
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw Error(
      "Set VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY (in .env or the environment).",
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
  });

  // Read-only: instructor id + name, to resolve placemark names to ids.
  const { data: instructors, error } = await supabase
    .from("Instructor")
    .select("id_instructor, name");
  if (error) throw error;
  const byNormName = new Map();
  for (const i of instructors)
    if (i.name) byNormName.set(normalizeName(i.name), i.id_instructor);
  const dbNormNames = new Set(byNormName.keys());
  console.log(`Loaded ${instructors.length} instructors for name resolution.`);

  // One row per instructor (UNIQUE instructor_id). If an instructor somehow has
  // both a polygon and a point placemark, keep the polygon.
  const rows = new Map();
  let matched = 0;
  let skippedPoint = 0;
  for (const z of polygonZones) {
    const norm = normalizeName(z.rawName);
    const resolved = resolveInstructorName(norm, dbNormNames);
    if (!resolved) continue;
    matched++;
    rows.set(byNormName.get(resolved), { ...z, resolvedName: resolved });
  }
  for (const z of pointZones) {
    const norm = normalizeName(z.rawName);
    if (resolveInstructorName(norm, dbNormNames)) skippedPoint++;
  }

  const unmatched = polygonZones
    .filter(
      (z) => !resolveInstructorName(normalizeName(z.rawName), dbNormNames),
    )
    .map((z) => z.rawName);
  console.log(
    `Resolved ${matched}/${polygonZones.length} polygons to instructors (${skippedPoint} point-only placemarks skipped — points are centroids, not coverage).`,
  );
  if (unmatched.length)
    console.log(
      `Unmatched polygon names (${unmatched.length}):\n  ` +
        unmatched.join("\n  "),
    );

  if (ONLY.length) {
    const wanted = new Set(ONLY.map((s) => normalizeName(s)));
    for (const [instructorId, z] of [...rows]) {
      if (wanted.has(normalizeName(z.rawName)) || wanted.has(instructorId))
        continue;
      rows.delete(instructorId);
    }
    const missed = ONLY.filter(
      (s) =>
        ![...rows.values()].some(
          (z) => normalizeName(z.rawName) === normalizeName(s),
        ) && ![...rows.keys()].includes(s),
    );
    console.log(
      `--only: emitting ${rows.size} row(s) for [${ONLY.join(", ")}]` +
        (missed.length ? ` — NOT FOUND: ${missed.join(", ")}` : ""),
    );
    if (!rows.size)
      throw Error(
        "--only matched no instructors; refusing to write an empty migration.",
      );
  }

  const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
  const conflict =
    OVERWRITE || ONLY.length
      ? "DO UPDATE SET coordinates=EXCLUDED.coordinates, kind=EXCLUDED.kind, raw_name=EXCLUDED.raw_name, description=EXCLUDED.description, updated_at=now()"
      : "DO NOTHING";
  const values = [...rows.entries()]
    .map(([instructorId, z]) => {
      const ring = closeRing(z.coords);
      return (
        "(" +
        [
          quote(instructorId),
          quote("polygon"),
          quote(JSON.stringify(ring)) + "::jsonb",
          quote(z.rawName),
          z.description ? quote(z.description) : "NULL",
        ].join(",") +
        ")"
      );
    })
    .join(",\n");

  const sql =
    "-- Generated by scripts/backfill-instructor-service-zones.mjs from public/instructors.kml.\n" +
    `-- ${rows.size} polygon rows. Review before applying. Idempotent.\n` +
    (ONLY.length
      ? `-- Source KML changed for these instructors; rows are overwritten on purpose.\n`
      : "") +
    "INSERT INTO public.instructor_service_zones(instructor_id,kind,coordinates,raw_name,description) VALUES\n" +
    values +
    `\nON CONFLICT (instructor_id) ${conflict};\n`;
  await writeFile(OUT_PATH, sql);
  console.log(
    `Wrote ${rows.size} rows to ${OUT_PATH} (${OVERWRITE || ONLY.length ? "overwrite existing" : "skip existing"}). Apply when ready.`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
