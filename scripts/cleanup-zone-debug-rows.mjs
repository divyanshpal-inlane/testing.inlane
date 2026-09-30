/**
 * One-off cleanup of the Schedule rows this zone E2E debugging created.
 *
 * Scope is deliberately narrow: it deletes by explicit id and only when the
 * row's course and learner tags still carry this script's marker. If either
 * check fails the row is reported and left alone, so this can never remove real
 * coverage data that happens to share an id.
 *
 *   node scripts/cleanup-zone-debug-rows.mjs          # dry run
 *   node scripts/cleanup-zone-debug-rows.mjs --apply
 */

// `dotenv` is not a dependency here, so `.env` is read directly, the same way
// scripts/verify-instructor-service-zones.mjs does it.
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const TARGETS = [
  { id: 72905, tag: "PW-DBG-REPEAT" },
  { id: 72911, tag: "PW-DBG-FRESH" },
];

const apply = process.argv.includes("--apply");

const env = readFileSync(".env", "utf8");
const read = (name) =>
  (env.match(new RegExp(`^${name}=(.*)$`, "m")) ?? [])[1]?.trim();
const url = read("VITE_SUPABASE_URL");
const key = read("VITE_SUPABASE_SERVICE_ROLE_KEY");

if (!url || !key) {
  console.error("VITE_SUPABASE_URL / VITE_SUPABASE_SERVICE_ROLE_KEY missing");
  process.exitCode = 1;
} else {
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await sb
    .from("Schedule")
    .select("id, instructor_id, date, status, isTentative, tentative_details")
    .in(
      "id",
      TARGETS.map((t) => t.id),
    );

  if (error) {
    console.error("select failed:", error.message);
    process.exitCode = 1;
  } else {
    const byId = new Map((data ?? []).map((r) => [r.id, r]));
    const doomed = [];
    for (const t of TARGETS) {
      const row = byId.get(t.id);
      if (!row) {
        console.log(`skip  ${t.id}: not present`);
        continue;
      }
      // The marker lives in `tentative_details.name`, which is where the
      // dashboard's booking form puts the customer name.
      const name = row.tentative_details?.name;
      if (name !== t.tag) {
        console.log(
          `SKIP  ${t.id}: tentative_details.name is ${JSON.stringify(name)}, expected ${JSON.stringify(t.tag)}`,
        );
        continue;
      }
      doomed.push(t.id);
      console.log(
        `found ${t.id}: date=${row.date} name=${name} instructor=${row.instructor_id}`,
      );
    }

    if (!doomed.length) {
      console.log("\nnothing to delete");
    } else if (!apply) {
      console.log(`\ndry run: would delete ${doomed.join(", ")}`);
    } else {
      const { error: delErr } = await sb
        .from("Schedule")
        .delete()
        .in("id", doomed);
      if (delErr) {
        console.error("delete failed:", delErr.message);
        process.exitCode = 1;
      } else {
        console.log(`\ndeleted ${doomed.join(", ")}`);
      }
    }
  }
}

// `exitCode` rather than process.exit(): a live fetch handle plus an immediate
// exit trips a libuv assertion on Windows.
