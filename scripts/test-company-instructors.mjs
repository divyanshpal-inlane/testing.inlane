import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const temp = await mkdtemp(join(tmpdir(), "co-guard-"));
try {
  await build({
    stdin: {
      contents:
        'export {instructorServesArea} from "./src/lib/sales-dashboard/availability";\n' +
        'export {isCompanyInstructor, isCompanyInstructorId} from "./src/lib/sales-dashboard/company-instructors";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(temp, "m.mjs"),
    alias: { "@": resolve("src") },
  });
  const { instructorServesArea, isCompanyInstructor, isCompanyInstructorId } =
    await import(pathToFileURL(join(temp, "m.mjs")));

  // A square polygon around the point we will search, plus legacy fields that
  // WOULD match the old name-list/radius fallback.
  const zone = [
    { lat: 12.92, lng: 77.59 },
    { lat: 12.92, lng: 77.61 },
    { lat: 12.94, lng: 77.61 },
    { lat: 12.94, lng: 77.59 },
    { lat: 12.92, lng: 77.59 },
  ];
  const pt = { lat: 12.93, lng: 77.6 };
  const legacy = { areas: ["HSR"], radiusKm: 7, lat: 12.93, lng: 77.6 };

  // [instructor fields, learnerArea, learner, expected]
  const cases = [
    // The DB flag wins, and survives a rename: the name is not on the list.
    [
      { name: "Backup Instructor (renamed)", isCompany: true, zone, ...legacy },
      "HSR",
      pt,
      false,
    ],
    // Name-list fallback still works before the migration is applied.
    [{ name: "Amanulla Khan", zone, ...legacy }, "HSR", pt, false],
    [{ name: "Krupakar Daniel Dennish", zone, ...legacy }, "HSR", pt, false],
    // Casing / stray-whitespace variants must still be recognised as company.
    [{ name: "  amanulla   KHAN  ", zone, ...legacy }, "HSR", pt, false],
    [
      {
        name: "krupakar daniel dennish",
        areas: ["Indiranagar"],
        radiusKm: 8,
        lat: 12.93,
        lng: 77.6,
      },
      "Indiranagar",
      pt,
      false,
    ],
    // Ordinary instructors are unaffected.
    [{ name: "SATHISH V", isCompany: false, zone, ...legacy }, "HSR", pt, true],
    [{ name: "Regular Instructor", areas: ["HSR"] }, "hsl", pt, false],
    // Unrelated company name is not caught.
    [{ name: "Amanulla", zone, ...legacy }, "HSR", pt, true],
  ];

  let pass = 0;
  for (const [fields, learnerArea, learner, expectMatch] of cases) {
    const got = instructorServesArea(
      { id: "x", ...fields },
      learnerArea,
      learner,
    );
    const ok = got === expectMatch;
    if (ok) pass++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  name=${JSON.stringify(fields.name)} ` +
        `flag=${String(fields.isCompany ?? "-").padEnd(5)} ` +
        `isCompany(name)=${String(isCompanyInstructor(fields.name)).padEnd(5)} ` +
        `servesArea=${String(got).padEnd(5)} expected=${expectMatch} ` +
        `zone=${fields.zone ? "yes" : "no "} legacyArea=${JSON.stringify(fields.areas ?? [])}`,
    );
  }

  // isCompanyInstructorId drives the dashboard filter off the DB flag set.
  const flagged = new Set(["id-amanulla", "id-krupakar"]);
  const idCases = [
    ["id-amanulla", true],
    ["id-krupakar", true],
    ["id-sathish", false],
    [null, false],
  ];
  let idPass = 0;
  for (const [id, expect] of idCases) {
    const got = isCompanyInstructorId(id, flagged);
    const ok = got === expect;
    if (ok) idPass++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  isCompanyInstructorId(${id}) = ${got} (expected ${expect})`,
    );
  }
  // An un-migrated DB returns an empty set -> must not throw, must not over-match.
  const emptyOk =
    isCompanyInstructorId("id-amanulla", new Set()) === false &&
    isCompanyInstructorId("id-amanulla", null) === false;
  if (emptyOk) idPass++;
  console.log(
    `${emptyOk ? "PASS" : "FAIL"}  empty/null flagged set is safe (no over-match)`,
  );

  const total = cases.length + idCases.length + 1;
  const gotPass = pass + idPass;
  console.log(`\n${gotPass}/${total} passed`);
  process.exitCode = gotPass === total ? 0 : 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
