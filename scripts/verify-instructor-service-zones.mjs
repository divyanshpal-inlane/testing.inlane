#!/usr/bin/env node
// Verifies that the live `instructor_service_zones` polygons still match the
// generated backfill migrations, and reports anything that drifted.
//
//   node scripts/verify-instructor-service-zones.mjs
//   node scripts/verify-instructor-service-zones.mjs --fix   # rewrite drifted rows
//
// Requires VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY in .env.
import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS_DIR = "supabase/migrations";

// Every migration that inserts polygons is replayed in timestamp order, honouring
// each file's ON CONFLICT clause, so a later DO UPDATE correctly supersedes the
// original backfill. Without this the checker would call every later fix "drift".
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{8}_\d{6}_.*\.sql$/.test(f))
  .filter((f) =>
    /INSERT INTO public\.instructor_service_zones/.test(
      readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"),
    ),
  )
  .sort();

if (!files.length) {
  console.error(
    `No instructor_service_zones migrations found in ${MIGRATIONS_DIR}`,
  );
  process.exit(1);
}

const env = readFileSync(".env", "utf8");
const SUPA = (env.match(/^VITE_SUPABASE_URL=(.*)$/m) || [])[1]?.trim();
const KEY = (env.match(/^VITE_SUPABASE_SERVICE_ROLE_KEY=(.*)$/m) ||
  [])[1]?.trim();
if (!SUPA || !KEY) {
  console.error(
    "VITE_SUPABASE_URL / VITE_SUPABASE_SERVICE_ROLE_KEY missing from .env",
  );
  process.exit(1);
}
const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

const expected = new Map();
for (const f of files) {
  const sql = readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8");
  const overwrites = /ON CONFLICT \(instructor_id\) DO UPDATE/i.test(sql);
  let applied = 0;
  for (const [, id, coords] of sql.matchAll(
    /\('([0-9a-f-]{36})','polygon','(\[\{[^']*?\}\])'/g,
  )) {
    if (!overwrites && expected.has(id)) continue;
    expected.set(id, JSON.parse(coords.replace(/''/g, "'")));
    applied++;
  }
  console.log(
    `  ${f}: ${applied} row(s) ${overwrites ? "DO UPDATE" : "DO NOTHING"}`,
  );
}
console.log(`migration polygons: ${expected.size}`);

const live = await fetch(
  `${SUPA}/rest/v1/instructor_service_zones?select=instructor_id,coordinates,kind,Instructor(name)`,
  { headers: H },
).then((r) => r.json());
console.log(`live rows:          ${live.length}`);

const drifted = live.filter((row) => {
  const want = expected.get(row.instructor_id);
  return want && JSON.stringify(want) !== JSON.stringify(row.coordinates);
});

for (const row of drifted) {
  console.log(
    `  DRIFT ${row.Instructor?.name ?? row.instructor_id}: ` +
      `live=${row.coordinates?.length}pts migration=${expected.get(row.instructor_id).length}pts`,
  );
}

// Structural sanity that the loader in src/lib/sales-dashboard/zones-db.ts relies on.
let bad = 0;
for (const row of live) {
  const c = row.coordinates;
  const closed =
    Array.isArray(c) &&
    c.length >= 4 &&
    JSON.stringify(c[0]) === JSON.stringify(c[c.length - 1]);
  const inRange =
    Array.isArray(c) &&
    c.every((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
  if (!Array.isArray(c) || !closed || !inRange || row.kind !== "polygon") {
    bad++;
    console.log(
      `  INVALID ${row.Instructor?.name ?? row.instructor_id}: ` +
        `kind=${row.kind} pts=${c?.length} closed=${closed} inRange=${inRange}`,
    );
  }
}
console.log(`structurally invalid rows: ${bad}`);

const extra = live.filter((r) => !expected.has(r.instructor_id));
for (const row of extra) {
  console.log(
    `  NOT IN MIGRATION ${row.Instructor?.name ?? row.instructor_id}`,
  );
}

if (process.argv.includes("--fix") && drifted.length) {
  for (const row of drifted) {
    const res = await fetch(
      `${SUPA}/rest/v1/instructor_service_zones?instructor_id=eq.${row.instructor_id}`,
      {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({ coordinates: expected.get(row.instructor_id) }),
      },
    );
    console.log(`  restored ${row.Instructor?.name}: HTTP ${res.status}`);
  }
} else if (drifted.length) {
  console.log("\npass --fix to rewrite drifted rows from the migration");
}

// NB: use exitCode, not process.exit() — exiting with a live fetch handle
// trips a libuv assertion on Windows (UV_HANDLE_CLOSING).
process.exitCode = drifted.length || bad ? 1 : 0;
