#!/usr/bin/env node
// TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
//
// Reads sales_dashboard_temporary_logs and prints the pre-ship usage + health
// report. Uses the SERVICE ROLE key (the table has no client read policy by
// design -- the browser can only append).
//
//   node scripts/sales-dashboard-report.mjs
//   node scripts/sales-dashboard-report.mjs --days 7
//   node scripts/sales-dashboard-report.mjs --since 2026-10-01 --json out.json
//   node scripts/sales-dashboard-report.mjs --export out.csv
//
// Env: VITE_SUPABASE_URL + VITE_SUPABASE_SERVICE_ROLE_KEY (from .env).

import { readFileSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const TABLE = "sales_dashboard_temporary_logs";

function env(name) {
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall through */
  }
  return process.env[name];
}

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const days = Number(flag("days") ?? 7);
const since =
  flag("since") ?? new Date(Date.now() - days * 864e5).toISOString();
const jsonOut = flag("json");
const csvOut = flag("export");

const url = env("VITE_SUPABASE_URL");
const key = env("VITE_SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY are required (put them in .env).",
  );
  // Not process.exit(): on Windows that trips a libuv assertion when a live
  // fetch handle is still open.
  process.exitCode = 1;
} else {
  await report();
}

async function report() {
  const sb = createClient(url, key, {
    auth: { persistSession: false },
  });

  const { data, error } = await sb
    .from(TABLE)
    .select(
      "ts,user_id,auth_user_id,user_name,user_role,session_id,category,event_name,success,instructor_id,slot_date,slot_start,error_code,error_message,api_name,http_method,http_status,duration_ms,props",
    )
    .gte("ts", since)
    .order("ts", { ascending: true })
    .limit(500000);
  if (error) {
    console.error(`${TABLE}: ${error.message}`);
    console.error(
      "If this says the relation does not exist, apply supabase/migrations/20261002_000000_sales_dashboard_temporary_logs.sql first.",
    );
    process.exitCode = 1;
    return;
  }

  const rows = data ?? [];
  const pct = (n, d) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
  const num = (n) => (n == null ? "-" : n.toLocaleString("en-IN"));
  const hours = (ms) => (ms == null ? "-" : `${(ms / 36e5).toFixed(2)}h`);

  const users = new Map();
  const sessions = new Map();
  const events = new Map();
  const apis = new Map();
  const instructors = new Map();
  const hourBins = new Map();
  const weekdayBins = new Map();
  const errors = new Map();
  const slots = new Map();
  const customers = new Map();

  const bump = (map, key, n = 1) => {
    const cur = map.get(key) ?? { count: 0, ok: 0, fail: 0, total: 0, n: 0 };
    cur.count += n;
    map.set(key, cur);
  };

  for (const r of rows) {
    // Fall back to the auth uid when the admin/user record lookup never resolved,
    // so a session is still attributable to a person.
    const who = r.user_name || r.user_id || r.auth_user_id || "(unidentified)";
    const u = users.get(who) ?? {
      user_id: r.user_id,
      auth_user_id: r.auth_user_id,
      user_name: r.user_name,
      role: r.user_role,
      sessions: new Set(),
      wall: 0,
      active: 0,
      bookings: 0,
      classes: 0,
      attempts: 0,
      failed: 0,
    };
    u.sessions.add(r.session_id);
    if (r.event_name === "dashboard_closed") {
      u.wall += Number(r.props?.wall_ms ?? 0);
      u.active += Number(r.props?.active_ms ?? 0);
    }
    if (r.event_name === "booking_created") u.classes += 1;
    if (r.event_name === "booking_started") {
      u.bookings += 1;
      u.attempts += 1;
    }
    if (r.event_name === "booking_failed") {
      u.attempts += 1;
      u.failed += 1;
    }
    users.set(who, u);

    sessions.set(r.session_id, (sessions.get(r.session_id) ?? 0) + 1);

    const e = events.get(r.event_name) ?? { ok: 0, fail: 0, null: 0 };
    if (r.success === true) e.ok += 1;
    else if (r.success === false) e.fail += 1;
    else e.null += 1;
    events.set(r.event_name, e);

    if (r.category === "api") {
      const a = apis.get(r.api_name) ?? {
        calls: 0,
        ok: 0,
        fail: 0,
        total: 0,
        timed: 0,
        max: 0,
        statuses: new Map(),
      };
      a.calls += 1;
      if (r.success) a.ok += 1;
      else a.fail += 1;
      if (typeof r.duration_ms === "number") {
        a.total += r.duration_ms;
        a.timed += 1;
        if (r.duration_ms > a.max) a.max = r.duration_ms;
      }
      if (r.http_status)
        a.statuses.set(r.http_status, (a.statuses.get(r.http_status) ?? 0) + 1);
      apis.set(r.api_name, a);
    }

    if (r.instructor_id && r.event_name === "booking_created") {
      instructors.set(
        r.instructor_id,
        (instructors.get(r.instructor_id) ?? 0) + 1,
      );
    }
    if (r.slot_start && r.event_name === "booking_created") {
      const key = String(r.slot_start).slice(0, 5);
      slots.set(key, (slots.get(key) ?? 0) + 1);
    }

    // Customer-level rollup. Only booking-scoped events carry a name, so the
    // other categories cannot skew it.
    // Stored in props.customer_name (no dedicated column).
    const customerName = r.props?.customer_name;
    if (customerName) {
      const c = customers.get(customerName) ?? {
        classes: 0,
        attempts: 0,
        failed: 0,
        staff: new Set(),
        sessions: new Set(),
      };
      c.sessions.add(r.session_id);
      c.staff.add(who);
      if (r.event_name === "booking_created") c.classes += 1;
      if (r.event_name === "booking_submitted") c.attempts += 1;
      if (r.event_name === "booking_failed") {
        c.attempts += 1;
        c.failed += 1;
      }
      customers.set(customerName, c);
    }

    const d = new Date(r.ts);
    const hour = `${String(d.getHours()).padStart(2, "0")}:00`;
    hourBins.set(hour, (hourBins.get(hour) ?? 0) + 1);
    const wd = d.toLocaleDateString("en-IN", {
      weekday: "short",
      timeZone: "Asia/Kolkata",
    });
    weekdayBins.set(wd, (weekdayBins.get(wd) ?? 0) + 1);

    if (r.error_message) {
      const k = `${r.event_name || r.category} :: ${r.error_code ?? "-"} :: ${String(r.error_message).slice(0, 90)}`;
      bump(errors, k);
    }
  }

  const top = (m, n = 10) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  const totalApi = [...apis.values()].reduce((a, b) => a + b.calls, 0);
  const failedApi = [...apis.values()].reduce((a, b) => a + b.fail, 0);
  const attempts = [...users.values()].reduce((a, u) => a + u.attempts, 0);
  const failures = [...users.values()].reduce((a, u) => a + u.failed, 0);

  const out = [];
  const p = (s = "") => out.push(s);

  p("=".repeat(78));
  p(`SALES DASHBOARD — TEMPORARY MONITORING REPORT`);
  p(`window: ${since} → now (${days}d default)   rows: ${num(rows.length)}`);
  p("=".repeat(78));

  p("\n1. WHO USED IT, AND FOR HOW LONG");
  p("-".repeat(78));
  p(
    "user                     sessions   wall-time   active-time   classes  attempts  failed",
  );
  for (const u of [...users.values()].sort((a, b) => b.active - a.active)) {
    p(
      `${(u.user_name ?? "(unidentified)").padEnd(24)} ${String(u.sessions.size).padStart(7)}   ${hours(u.wall).padStart(9)}   ${hours(u.active).padStart(10)}   ${String(u.classes).padStart(7)}  ${String(u.attempts).padStart(8)}  ${String(u.failed).padStart(6)}`,
    );
  }
  if (!users.size) p("(no rows)");

  p("\n2. BOOKINGS & CLASSES PER USER");
  p("-".repeat(78));
  p(`total booking attempts (double-click + submit): ${num(attempts)}`);
  p(
    `failed attempts:                               ${num(failures)}  (${pct(failures, attempts)})`,
  );
  p(
    `classes created (booking_created rows):       ${num([...users.values()].reduce((a, u) => a + u.classes, 0))}`,
  );
  p(`sessions:                                     ${num(sessions.size)}`);

  p("\n3. CUSTOMERS BOOKED (who booked, who handled it)");
  p("-".repeat(78));
  p("customer                      classes  submits  failed  handled-by");
  for (const [name, c] of [...customers.entries()].sort(
    (a, b) => b[1].classes - a[1].classes || b[1].attempts - a[1].attempts,
  )) {
    p(
      `${name.slice(0, 26).padEnd(26)} ${String(c.classes).padStart(9)}  ${String(c.attempts).padStart(7)}  ${String(c.failed).padStart(6)}  ${[...c.staff].join(", ").slice(0, 30)}`,
    );
  }
  if (!customers.size) p("(no customer names recorded yet)");

  p("\n4. MOST-BOOKED INSTRUCTORS");
  p("-".repeat(78));
  for (const [id, n] of top(instructors, 10))
    p(`${String(id).padEnd(40)} ${n}`);
  if (!instructors.size) p("(none)");

  p("\n5. MOST-USED TIME SLOTS (start time)");
  p("-".repeat(78));
  for (const [t, n] of top(slots, 12))
    p(`${t}  ${"#".repeat(Math.min(n, 40))} ${n}`);
  if (!slots.size) p("(none)");

  p("\n6. API HEALTH");
  p("-".repeat(78));
  p(
    `api calls: ${num(totalApi)}   failures: ${num(failedApi)} (${pct(failedApi, totalApi)})`,
  );
  p(
    "api                                        calls   fail   avg_ms      max_ms   statuses",
  );
  for (const [name, a] of [...apis.entries()].sort(
    (x, y) => y[1].calls - x[1].calls,
  )) {
    const avg = a.timed ? (a.total / a.timed).toFixed(0) : "-";
    p(
      `${String(name).padEnd(42)} ${String(a.calls).padStart(5)} ${String(a.fail).padStart(6)}   ${String(avg).padStart(6)}   ${String(a.max || "-").padStart(7)}   ${[...a.statuses.entries()].map(([s, n]) => `${s}x${n}`).join(",") || "-"}`,
    );
  }
  if (!apis.size) p("(none)");

  p("\n7. ERRORS & FAILURES (grouped)");
  p("-".repeat(78));
  for (const [k, v] of [...errors.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)) {
    p(`${String(v.count).padStart(5)}  ${k}`);
  }
  if (!errors.size) p("(none)");

  p("\n8. EVENT MIX");
  p("-".repeat(78));
  for (const [name, e] of [...events.entries()].sort(
    (a, b) =>
      b[1].ok + b[1].fail + b[1].null - (a[1].ok + a[1].fail + a[1].null),
  )) {
    p(
      `${String(name).padEnd(34)} ok=${String(e.ok).padStart(5)} fail=${String(e.fail).padStart(4)} n=${String(e.null).padStart(4)}`,
    );
  }

  p(
    "\n9. ACTIVITY BY HOUR (IST-local of the report host; shift +5:30 for IST)",
  );
  p("-".repeat(78));
  for (const [h, n] of [...hourBins.entries()].sort()) {
    p(`${h}  ${"#".repeat(Math.min(n, 50))} ${n}`);
  }

  p("\n10. ACTIVITY BY WEEKDAY");
  p("-".repeat(78));
  for (const [w, n] of top(weekdayBins, 7))
    p(`${w}  ${"#".repeat(Math.min(n, 50))} ${n}`);

  const text = out.join("\n");
  console.log(text);

  if (jsonOut) {
    writeFileSync(
      jsonOut,
      JSON.stringify(
        {
          since,
          rows: rows.length,
          users: [...users.values()].map((u) => ({
            ...u,
            sessions: u.sessions.size,
          })),
          apis: [...apis.entries()].map(([name, a]) => ({
            name,
            ...a,
            statuses: [...a.statuses],
          })),
          events: [...events.entries()].map(([name, e]) => ({ name, ...e })),
          errors: [...errors.entries()].map(([message, v]) => ({
            message,
            ...v,
          })),
          instructors: [...instructors.entries()],
          slots: [...slots.entries()],
        },
        null,
        2,
      ),
    );
    console.error(`\nwrote ${jsonOut}`);
  }
  if (csvOut) {
    const head =
      "ts,user_name,session_id,category,event_name,success,instructor_id,slot_date,slot_start,api_name,http_status,duration_ms,error_code,error_message";
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    writeFileSync(
      csvOut,
      [
        head,
        ...rows.map((r) =>
          [
            r.ts,
            r.user_name,
            r.session_id,
            r.category,
            r.event_name,
            r.success,
            r.instructor_id,
            r.slot_date,
            r.slot_start,
            r.api_name,
            r.http_status,
            r.duration_ms,
            r.error_code,
            r.error_message,
          ]
            .map(esc)
            .join(","),
        ),
      ].join("\n"),
    );
    console.error(`wrote ${csvOut} (${rows.length} rows)`);
  }
  // closes async function report()
}
