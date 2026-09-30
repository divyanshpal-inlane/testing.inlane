// Clean a raw Google-Earth "driving zones" KML export into the backfill input
// that public/instructors.kml is expected to be.
//
//   node scripts/clean-instructors-kml.mjs <raw-doc.kml>            # dry run, lists drops
//   node scripts/clean-instructors-kml.mjs <raw-doc.kml> --apply   # rewrite public/instructors.kml
//
// The export ships with editor scratch geometry that is NOT instructor coverage:
// Google Maps auto-names pasted features "Point 126" / "Polygon 148", and the
// heatmap workflow leaves "Non-demand area - interior gap N" / "Kodathi road trim
// part N" polygons behind. Points are centroids rather than coverage, so the
// backfill skips them anyway, but they still have to leave the file or every
// re-run reports phantom placemarks.
//
// Placemark bodies are copied VERBATIM (gaps included) so the only diff between
// the raw export and the cleaned file is the set of dropped placemarks.

import { readFileSync, writeFileSync } from "node:fs";

const SRC = process.argv[2];
const APPLY = process.argv.includes("--apply");
const OUT = "public/instructors.kml";

if (!SRC || !SRC.toLowerCase().endsWith(".kml")) {
  console.error(
    "usage: node scripts/clean-instructors-kml.mjs <raw-doc.kml> [--apply]",
  );
  process.exit(2);
}

// Editor scratch geometry, not instructor service areas.
const JUNK_NAME = /^(?:point|polygon)\s+\d+$|^non-demand area\b|\?\?$/i;

const xml = readFileSync(SRC, "utf8");
const spans = [...xml.matchAll(/<Placemark>[\s\S]*?<\/Placemark>/g)].map(
  (m) => {
    const text = m[0];
    const name = (text.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? "")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .trim();
    return { start: m.index, end: m.index + text.length, text, name };
  },
);

if (!spans.length) {
  console.error(`No <Placemark> found in ${SRC} — aborting.`);
  process.exit(1);
}

const dropped = [];
let kept = "";
let cursor = 0;
for (const s of spans) {
  kept += xml.slice(cursor, s.start);
  cursor = s.end;
  if (JUNK_NAME.test(s.name)) dropped.push(s.name);
  else kept += s.text;
}
kept += xml.slice(cursor);

const keptCount = spans.length - dropped.length;
console.log(
  `${SRC}: ${spans.length} placemarks -> keeping ${keptCount}, dropping ${dropped.length}`,
);
for (const n of dropped) console.log(`  - ${n}`);

if (!APPLY) {
  console.log(`\ndry run — pass --apply to rewrite ${OUT}`);
} else {
  writeFileSync(OUT, kept);
  console.log(`\nwrote ${OUT} (${keptCount} placemarks, ${kept.length} bytes)`);
}
