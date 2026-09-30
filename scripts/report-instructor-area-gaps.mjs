import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

function coordsFromText(t) {
  const out = [];
  for (const tok of (t || "").trim().split(/\s+/)) {
    if (!tok) continue;
    const [a, b] = tok.split(",");
    const lat = parseFloat(b),
      lng = parseFloat(a);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
  }
  return out;
}
function closeRing(r) {
  if (r.length < 3) return r;
  const f = r[0],
    l = r[r.length - 1];
  return f.lat === l.lat && f.lng === l.lng ? r : [...r, { ...f }];
}
function parseKml(xml) {
  const z = [];
  for (const pm of xml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const b = pm[1];
    const rawName = (b.match(/<name>([\s\S]*?)<\/name>/) || [, ""])[1].trim();
    if (!rawName) continue;
    const poly = b.match(
      /<Polygon>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/,
    );
    if (poly) {
      const c = closeRing(coordsFromText(poly[1]));
      if (c.length >= 3) z.push({ rawName, kind: "polygon", coords: c });
      continue;
    }
    const pt = b.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    if (pt) {
      const c = coordsFromText(pt[1]).slice(0, 1);
      if (c.length === 1) z.push({ rawName, kind: "point", coords: c });
    }
  }
  return z;
}
const fmt = (p) => (p ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : "—");
const bbox = (c) => {
  const b = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
  for (const p of c) {
    b.minLat = Math.min(b.minLat, p.lat);
    b.maxLat = Math.max(b.maxLat, p.lat);
    b.minLng = Math.min(b.minLng, p.lng);
    b.maxLng = Math.max(b.maxLng, p.lng);
  }
  return b;
};

const temp = await mkdtemp(join(tmpdir(), "gap-"));
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
    outfile: join(temp, "k.mjs"),
    alias: { "@": resolve("src") },
  });
  const { normalizeName, resolveInstructorName, pointInPolygon, haversineKm } =
    await import(pathToFileURL(join(temp, "k.mjs")));

  const env = Object.fromEntries(
    (await readFile(".env", "utf8"))
      .split("\n")
      .map((l) => {
        const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
        return m ? [m[1], m[2].replace(/^["']|["']$/g, "")] : null;
      })
      .filter(Boolean),
  );
  const U = env.VITE_SUPABASE_URL,
    K = env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  const H = { apikey: K, Authorization: `Bearer ${K}` };

  const zones = parseKml(await readFile("public/instructors.kml", "utf8"));
  const all = await fetch(
    `${U}/rest/v1/Instructor?select=id_instructor,name,status,enabled,areas,radius,latitude,longitude,phone,address`,
    { headers: H },
  ).then((r) => r.json());
  const dbZ = await fetch(
    `${U}/rest/v1/instructor_service_zones?select=instructor_id,coordinates,raw_name,Instructor(name)`,
    { headers: H },
  ).then((r) => r.json());
  const zonedById = new Map(dbZ.map((z) => [z.instructor_id, z]));
  const byNorm = new Map();
  for (const i of all)
    if (i.name) byNorm.set(normalizeName(i.name), i.id_instructor);
  const dbNorm = new Set(byNorm.keys());

  // KML polygon per instructor (last wins, matching the backfill), and KML point per instructor.
  const kmlPoly = new Map(),
    kmlPoint = new Map();
  for (const z of zones) {
    const r = resolveInstructorName(normalizeName(z.rawName), dbNorm);
    if (!r) continue;
    const id = byNorm.get(r);
    if (z.kind === "polygon") kmlPoly.set(id, z);
    else if (!kmlPoint.has(id)) kmlPoint.set(id, z);
  }

  // Group 1: no polygon at all -> location search can never return them.
  //   1a  had a KML placemark, so the old 3km fallback could reach them
  //   1b  no KML placemark at all -> invisible before the migration too
  const noPolyHadKml = [],
    noPolyNoKml = [];
  // Group 2: HAS a polygon (findable) but the KML pin sits outside it.
  const pinOutside = [];

  for (const i of all) {
    const id = i.id_instructor;
    const p = kmlPoint.get(id),
      k = kmlPoly.get(id);
    const dz = zonedById.get(id);
    const base = {
      id,
      name: i.name,
      status: i.status,
      enabled: i.enabled,
      phone: i.phone,
      address: i.address,
      areas: i.areas ?? [],
      radius: i.radius,
      legacy:
        i.latitude && i.longitude
          ? { lat: i.latitude, lng: i.longitude }
          : null,
      pin: p ? p.coords[0] : null,
      kmlPoly: k ? k.coords : null,
      dbPoly: dz ? dz.coordinates : null,
      kmlRaw: p?.rawName ?? k?.rawName ?? null,
    };
    if (!dz) {
      (p || k ? noPolyHadKml : noPolyNoKml).push(base);
      continue;
    }
    if (p) {
      const ring = dz.coordinates;
      if (!pointInPolygon(p.coords[0], ring)) {
        pinOutside.push({
          ...base,
          dist: Math.min(...ring.map((v) => haversineKm(p.coords[0], v))),
        });
      }
    }
  }

  const act = (r) => r.status === "active" && r.enabled !== false;
  const tally = (l) => ({
    total: l.length,
    active: l.filter(act).length,
    inactive: l.filter((r) => !act(r)).length,
  });
  const t1 = tally(noPolyHadKml),
    t2 = tally(noPolyNoKml),
    t3 = tally(pinOutside);

  const md = [];
  md.push("# Instructor service areas — who location search cannot reach");
  md.push(
    `\nGenerated ${new Date().toISOString().slice(0, 10)} · live DB + \`public/instructors.kml\`\n`,
  );
  md.push(
    `Instructors: **${all.length}** · with a drawn polygon (location-findable): **${zonedById.size}** · ` +
      `without: **${all.length - zonedById.size}**\n`,
  );
  md.push(
    `| Group | Count | Of those active | Meaning |\n|---|---|---|---|\n` +
      `| 1a. No polygon, but had a KML placemark | ${t1.total} | ${t1.active} | Was findable before, is not now — **regression** |\n` +
      `| 1b. No polygon, no KML placemark | ${t2.total} | ${t2.active} | Never findable by location, before or after |\n` +
      `| 2. Has a polygon, but KML pin outside it | ${t3.total} | ${t3.active} | Findable, but only strictly inside the drawn line |`,
  );

  md.push(
    `\n## Group 1a — REGRESSION: no polygon, KML had a pin (${t1.total})\n`,
  );
  md.push(
    `The old 3 km proximity fallback could surface these; polygon-only cannot. ` +
      `${t1.inactive} of ${t1.total} are inactive/disabled, so they are not bookable anyway.\n`,
  );
  md.push(`| Instructor | Status | KML pin | Legacy areas | Radius | Phone |`);
  md.push(`|---|---|---|---|---|---|`);
  for (const r of noPolyHadKml.sort((a, b) => a.name.localeCompare(b.name)))
    md.push(
      `| **${r.name}** | ${r.status ?? "-"}${r.enabled === false ? " + disabled" : ""} | ${fmt(r.pin)} | ${r.areas.join(", ") || "—"} | ${r.radius ?? "—"} | ${r.phone ?? "—"} |`,
    );

  const noKmlActive = noPolyNoKml.filter(act);
  md.push(`\n## Group 1b — No polygon and no KML placemark (${t2.total})\n`);
  md.push(
    `Never reachable by location, before or after. Not a regression. ` +
      `**${t2.inactive} of ${t2.total} are inactive/disabled.**\n`,
  );
  if (noKmlActive.length) {
    md.push(
      `### Active but not location-findable (${noKmlActive.length}) — review these\n`,
    );
    md.push(
      `| Instructor | Status | Legacy areas | Radius | Phone | Address |`,
    );
    md.push(`|---|---|---|---|---|---|`);
    for (const r of noKmlActive.sort((a, b) => a.name.localeCompare(b.name)))
      md.push(
        `| **${r.name}** | ${r.status ?? "-"} | ${r.areas.join(", ") || "—"} | ${r.radius ?? "—"} | ${r.phone ?? "—"} | ${(r.address ?? "—").slice(0, 60)} |`,
      );
  }
  const noKmlInactive = noPolyNoKml.filter((r) => !act(r));
  md.push(
    `\n### Inactive/disabled (${noKmlInactive.length}) — expected, no action\n`,
  );
  md.push(`| Instructor | Status | Legacy areas | Radius | Phone |`);
  md.push(`|---|---|---|---|---|`);
  for (const r of noKmlInactive.sort((a, b) => a.name.localeCompare(b.name)))
    md.push(
      `| ${r.name} | ${r.status ?? "-"}${r.enabled === false ? " + disabled" : ""} | ${r.areas.join(", ") || "—"} | ${r.radius ?? "—"} | ${r.phone ?? "—"} |`,
    );

  md.push(
    `\n## Group 2 — Has a polygon, but the KML pin sits OUTSIDE it (${t3.total})\n`,
  );
  md.push(
    `These **are** findable — only inside their drawn boundary. Listed because the ` +
      `field team's mental model is the pin, so "can't find him" reports usually mean the ` +
      `pin falls outside the drawing. Moving the vertex, not adding an instructor, is the fix.\n`,
  );
  md.push(
    `| Instructor | Status | Pin to polygon | Pin | Polygon bbox lat / lng | Legacy areas | Radius | Phone |`,
  );
  md.push(`|---|---|---|---|---|---|---|---|`);
  for (const r of pinOutside.sort((a, b) => b.dist - a.dist)) {
    const bb = bbox(r.dbPoly);
    md.push(
      `| **${r.name}** | ${r.status ?? "-"}${r.enabled === false ? " + disabled" : ""} | ${r.dist.toFixed(1)} km | ${fmt(r.pin)} | ${bb.minLat.toFixed(3)}–${bb.maxLat.toFixed(3)} / ${bb.minLng.toFixed(3)}–${bb.maxLng.toFixed(3)} | ${r.areas.join(", ") || "—"} | ${r.radius ?? "—"} | ${r.phone ?? "—"} |`,
    );
  }

  const out = "INSTRUCTOR_AREA_GAPS.md";
  await writeFile(out, md.join("\n") + "\n");
  console.log(`wrote ${out}\n`);
  console.log(md.join("\n"));
} finally {
  await rm(temp, { recursive: true, force: true });
}
