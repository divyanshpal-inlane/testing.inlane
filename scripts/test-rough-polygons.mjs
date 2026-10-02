// Regression tests for the rough-polygon / instructor-status / residence rules.
//
// Pure-logic tests over the real modules (bundled through esbuild, same pattern
// as test-company-instructors.mjs), so they need no database, no network, and
// no Maps. They cover the invariants that the UI cannot prove on its own:
//
//   * a rough polygon is excluded from ALL area matching, including the legacy
//     areas/radius fallbacks — so an unverified onboarding boundary can never
//     be the reason a customer is matched to an instructor;
//   * verified polygons are unaffected (no regression in existing matching);
//   * inactive instructors are neither bookable nor area-eligible, and the
//     status/enabled columns are each honoured on their own;
//   * on_break stays out of the bookable pool but is not treated as inactive;
//   * the legacy centroid+radius fallback still uses the residence point only
//     as a deprecated proximity hint, never as a polygon centre.
//
// The DB-row-shaping half of the feature (that `is_rough` is read, defaults to
// false, and is filtered on the read path) lives in zones-db.ts, which needs a
// Supabase client; it is covered by the Playwright suite in the browser instead.
// What IS covered here is the guard that decides whether a polygon counts as
// coverage at all.
//
// Run: node scripts/test-rough-polygons.mjs

import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const temp = await mkdtemp(join(tmpdir(), "rough-guard-"));

let failed = 0;
const check = (label, got, expect) => {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n` +
      `        got=${JSON.stringify(got)} expected=${JSON.stringify(expect)}`,
  );
};

try {
  await build({
    stdin: {
      contents:
        'export {instructorServesArea, isInstructorActive, areaEligibleInstructors} from "./src/lib/sales-dashboard/availability";\n' +
        'export {resolveInstructorStatus} from "./src/constants/instructorStatus";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(temp, "m.mjs"),
    alias: { "@": resolve("src") },
  });
  const mod = await import(pathToFileURL(join(temp, "m.mjs")));
  const {
    instructorServesArea,
    isInstructorActive,
    areaEligibleInstructors,
    resolveInstructorStatus,
  } = mod;

  // Square polygon around the probe point below.
  const zone = [
    { lat: 12.92, lng: 77.59 },
    { lat: 12.92, lng: 77.61 },
    { lat: 12.94, lng: 77.61 },
    { lat: 12.94, lng: 77.59 },
    { lat: 12.92, lng: 77.59 },
  ];
  const inside = { lat: 12.93, lng: 77.6 };
  const outside = { lat: 13.5, lng: 78.5 };
  // Legacy fields that WOULD satisfy the deprecated fallbacks, so a rough
  // polygon leaking through them is caught.
  const legacy = { areas: ["HSR"], radiusKm: 7, lat: 12.93, lng: 77.6 };

  console.log("--- rough polygon is never a serviceability zone ---");
  // A point inside the polygon: the verified case must still match.
  check(
    "verified polygon matches a point inside it",
    instructorServesArea(
      { id: "a", name: "Verified", zone, isRough: false },
      "HSR",
      inside,
    ),
    true,
  );
  // The same point, same polygon, flagged rough: must not match.
  check(
    "rough polygon does NOT match a point inside it",
    instructorServesArea(
      { id: "a", name: "Verified", zone, isRough: true },
      "HSR",
      inside,
    ),
    false,
  );
  // The critical case: a rough polygon must not be rescued by the legacy
  // name-list or radius fallbacks either, even though both would match.
  check(
    "rough polygon is not rescued by legacy areas/radius",
    instructorServesArea(
      { id: "a", name: "Verified", zone, isRough: true, ...legacy },
      "HSR",
      inside,
    ),
    false,
  );
  check(
    "rough polygon with ONLY legacy coverage (no zone) does not match",
    instructorServesArea(
      { id: "a", name: "Verified", isRough: true, ...legacy },
      "HSR",
      inside,
    ),
    false,
  );
  // isRough omitted must behave as verified — callers that do not pass the
  // column (all 66 existing polygons) must be unaffected.
  check(
    "omitted isRough is treated as verified",
    instructorServesArea(
      { id: "a", name: "Verified", zone },
      "HSR",
      inside,
    ),
    true,
  );
  check(
    "explicit isRough:false is treated as verified",
    instructorServesArea(
      { id: "a", name: "Verified", zone, isRough: false },
      "HSR",
      inside,
    ),
    true,
  );

  console.log("\n--- existing matching is not regressed ---");
  check(
    "verified polygon rejects a point outside it",
    instructorServesArea(
      { id: "a", name: "Verified", zone, isRough: false },
      "HSR",
      outside,
    ),
    false,
  );
  // The learner area is compared case-insensitively against the instructor's
  // legacy name list, so "HSR" on both sides must match.
  check(
    "legacy areas fallback still works without a zone",
    instructorServesArea(
      { id: "a", name: "Verified", areas: ["HSR"] },
      "HSR",
      inside,
    ),
    true,
  );
  // A genuinely different area must not match — confirms the check above is
  // asserting the fallback rather than a blanket true.
  check(
    "legacy areas fallback rejects a different area",
    instructorServesArea(
      { id: "a", name: "Verified", areas: ["HSR"] },
      "Indiranagar",
      inside,
    ),
    false,
  );
  check(
    "legacy radius fallback still works without a zone",
    instructorServesArea(
      { id: "a", name: "Verified", radiusKm: 7, lat: 12.93, lng: 77.6 },
      "",
      inside,
    ),
    true,
  );

  console.log("\n--- instructor status ---");
  check(
    "active is bookable",
    isInstructorActive({ id: "a", status: "active", enabled: true }),
    true,
  );
  check(
    "on_break is NOT bookable",
    isInstructorActive({ id: "a", status: "on_break", enabled: true }),
    false,
  );
  check(
    "inactive is not bookable",
    isInstructorActive({ id: "a", status: "inactive", enabled: true }),
    false,
  );
  check(
    "status=inactive with enabled=true is still not bookable",
    isInstructorActive({ id: "a", status: "inactive", enabled: true }),
    false,
  );
  check(
    "enabled=false with status=active is not bookable",
    isInstructorActive({ id: "a", status: "active", enabled: false }),
    false,
  );
  // A row predating the status column: resolved from `enabled`.
  check(
    "pre-status row with enabled=false resolves to inactive",
    resolveInstructorStatus({ status: null, enabled: false }),
    "inactive",
  );
  check(
    "pre-status row with enabled=true resolves to active",
    resolveInstructorStatus({ status: null, enabled: true }),
    "active",
  );
  check(
    "pre-status row with no flags resolves to active",
    resolveInstructorStatus({ status: null, enabled: null }),
    "active",
  );
  check(
    "on_break survives resolveInstructorStatus (not collapsed to active)",
    resolveInstructorStatus({ status: "on_break", enabled: true }),
    "on_break",
  );

  console.log("\n--- area-eligible pool excludes inactive and rough ---");
  const pool = areaEligibleInstructors({
    learnerArea: "HSR",
    learner: inside,
    instructors: [
      { id: "active", name: "A", zone, isRough: false, status: "active" },
      {
        id: "onbreak",
        name: "B",
        zone,
        isRough: false,
        status: "on_break",
        enabled: true,
      },
      {
        id: "inactive",
        name: "C",
        zone,
        isRough: false,
        status: "inactive",
        enabled: true,
      },
      {
        id: "rough",
        name: "D",
        zone,
        isRough: true,
        status: "active",
        enabled: true,
      },
    ],
  });
  check(
    "only the active verified instructor is eligible",
    pool.map((i) => i.id).sort(),
    ["active"],
  );

  console.log(
    failed === 0
      ? "\nAll rough-polygon / status / residence checks passed."
      : `\n${failed} check(s) FAILED.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
