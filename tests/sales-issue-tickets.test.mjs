// Run: node --test tests/sales-issue-tickets.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    Intl,
    Date,
    console,
  });
  return module.exports;
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const server = load("../supabase/functions/_shared/sales-issue-tickets.ts");
const client = load("../src/lib/sales-issue-tickets/validation.ts");
const dates = load("../src/lib/sales-issue-tickets/dateFilters.ts");

test("phone: client and server rules agree", () => {
  const cases = [
    ["9876543210", "9876543210"],
    ["+91 98765-43210", "9876543210"],
    ["919876543210", "9876543210"],
    ["09876543210", "9876543210"],
    ["(987) 654 3210", "9876543210"],
    ["5876543210", null], // must start 6-9
    ["98765", null],
    ["abcdefghij", null],
    ["98765432101", null],
    ["", null],
    ["9876543210; DROP TABLE x", null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(server.normalizeTicketPhone(input), expected, input);
    assert.equal(client.normalizeTicketPhone(input), expected, input);
  }
  assert.equal(server.normalizeTicketPhone(null), null);
  assert.match(client.validatePhone(""), /required/i);
  assert.match(client.validatePhone("123"), /valid/i);
  assert.equal(client.validatePhone("9876543210"), null);
});

test("description: optional, trimmed, length-capped", () => {
  assert.deepEqual(plain(server.cleanDescription(undefined)), {
    ok: true,
    value: null,
  });
  assert.deepEqual(plain(server.cleanDescription("   ")), { ok: true, value: null });
  assert.deepEqual(plain(server.cleanDescription("  hi  ")), {
    ok: true,
    value: "hi",
  });
  assert.equal(server.cleanDescription("x".repeat(2001)).ok, false);
  assert.equal(server.cleanDescription(5).ok, false);
  assert.ok(client.validateDescription("x".repeat(2001)));
});

test("status: only the three permitted values", () => {
  for (const s of ["To Do", "In Progress", "Resolved"])
    assert.equal(server.isTicketStatus(s), true);
  for (const s of ["Done", "todo", "", null, undefined])
    assert.equal(server.isTicketStatus(s), false);
});

test("email: subject, body fields, HTML escaping, plain-text fallback", () => {
  const mail = server.buildTicketEmail({
    ticketNumber: "SIT-000042",
    phoneNumber: "9876543210",
    description: "<script>alert(1)</script> & more",
    createdAt: "2026-10-25T06:30:00.000Z",
    raisedBy: "Asha · asha@inlane.in",
    status: "To Do",
  });
  assert.equal(
    mail.subject,
    "[Sales Support Ticket] SIT-000042 — 9876543210",
  );
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("&lt;script&gt;"));
  assert.match(mail.text, /Ticket ID: SIT-000042/);
  assert.match(mail.text, /Raised by: Asha/);
  assert.match(mail.text, /Status: To Do/);
  assert.match(mail.text, /12:00 pm IST|12:00 PM IST/i); // 06:30Z = 12:00 IST

  const empty = server.buildTicketEmail({
    ticketNumber: "SIT-1",
    phoneNumber: "9876543210",
    description: null,
    createdAt: "2026-10-25T06:30:00.000Z",
    raisedBy: "x",
    status: "To Do",
  });
  assert.match(empty.text, /No description provided/);
});

test("sanitizeError never leaks secrets and is capped", () => {
  const msg = server.sanitizeError(
    new Error("auth failed for user bob@x.com password hunter2hunter2"),
    ["hunter2hunter2", "bob@x.com"],
  );
  assert.ok(!msg.includes("hunter2"));
  assert.ok(!msg.includes("bob@x.com"));
  assert.ok(server.sanitizeError("a".repeat(1000)).length <= 300);
});

// ---- date presets -----------------------------------------------------------
const local = (y, m, d) => new Date(y, m - 1, d).toISOString();
const NOW = new Date(2026, 9, 25, 15, 45); // 25 Oct 2026, local

test("presets: Today / Last 15 / Last 30 are calendar-day inclusive", () => {
  assert.deepEqual(plain(dates.resolveDateRange("today", NOW)), {
    from: local(2026, 10, 25),
    to: local(2026, 10, 26),
  });
  assert.equal(
    dates.resolveDateRange("last15", NOW).from,
    local(2026, 10, 11), // today + preceding 14 days
  );
  assert.equal(dates.resolveDateRange("last30", NOW).from, local(2026, 9, 26));
  assert.deepEqual(plain(dates.resolveDateRange("all", NOW)), {
    from: null,
    to: null,
  });
});

test("Last 1 Month is a calendar month and differs from Last 30 Days", () => {
  const m = dates.resolveDateRange("lastMonth", NOW);
  assert.equal(m.from, local(2026, 9, 25));
  assert.notEqual(m.from, dates.resolveDateRange("last30", NOW).from);
  // clamping: 31 Mar -> 28 Feb (2026 is not a leap year), 31 Dec -> 30 Nov
  assert.equal(
    dates.resolveDateRange("lastMonth", new Date(2026, 2, 31)).from,
    local(2026, 2, 28),
  );
  assert.equal(
    dates.resolveDateRange("lastMonth", new Date(2026, 11, 31)).from,
    local(2026, 11, 30),
  );
  assert.equal(
    dates.resolveDateRange("lastMonth", new Date(2026, 0, 15)).from,
    local(2025, 12, 15),
  );
});

test("custom range includes both end dates and is validated", () => {
  const r = dates.resolveDateRange("custom", NOW, {
    start: "2026-10-01",
    end: "2026-10-05",
  });
  assert.equal(r.from, local(2026, 10, 1));
  assert.equal(r.to, local(2026, 10, 6)); // exclusive => 5 Oct fully included
  const same = dates.resolveDateRange("custom", NOW, {
    start: "2026-10-05",
    end: "2026-10-05",
  });
  assert.equal(same.to, local(2026, 10, 6));

  assert.match(dates.validateCustomRange("2026-10-06", "2026-10-05"), /after/);
  assert.match(dates.validateCustomRange("", "2026-10-05"), /both/);
  assert.match(dates.validateCustomRange("2026-02-31", "2026-03-01"), /valid/);
  assert.equal(dates.validateCustomRange("2026-10-01", "2026-10-05"), null);
  assert.equal(
    dates.resolveDateRange("custom", NOW, { start: "2026-10-09", end: "2026-10-01" }),
    null,
  );
});

test("search term sanitiser strips PostgREST filter syntax", () => {
  assert.equal(dates.sanitizeSearchTerm("SIT-0001,status.eq.x)"), "SIT-0001status.eq.x");
  assert.equal(dates.sanitizeSearchTerm("98%_76*"), "9876");
});

// ---- migration guarantees (static) -----------------------------------------
const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261025000000_create_sales_issue_tickets.sql",
    import.meta.url,
  ),
  "utf8",
);

test("migration: constraints, defaults, indexes and RLS are declared", () => {
  assert.match(sql, /ticket_number text NOT NULL UNIQUE/);
  assert.match(sql, /status text NOT NULL DEFAULT 'To Do'/);
  assert.match(sql, /status IN \('To Do', 'In Progress', 'Resolved'\)/);
  assert.match(sql, /notification_status IN \('pending', 'sent', 'failed'\)/);
  assert.match(sql, /created_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /idx_sales_issue_tickets_created_at/);
  assert.match(sql, /idx_sales_issue_tickets_status/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /handle_updated_at\(\)/);
});

test("migration: browser role is read-only (no write policy or grant)", () => {
  assert.match(sql, /GRANT SELECT ON public\.sales_issue_tickets TO authenticated/);
  assert.doesNotMatch(sql, /FOR (INSERT|UPDATE|DELETE|ALL)/);
  assert.doesNotMatch(sql, /GRANT (ALL|INSERT|UPDATE|DELETE)[^;]*TO authenticated/);
  assert.match(
    sql,
    /USING \(public\.current_staff_has_permission\('sales_issue_tickets'\)\)/,
  );
});

test("edge function: identity comes from the JWT, secrets stay server-side", () => {
  const fn = readFileSync(
    new URL("../supabase/functions/sales-issue-tickets/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(fn, /raised_by: caller\.userId/);
  assert.match(fn, /raised_by_email: caller\.email/);
  assert.doesNotMatch(fn, /body\.raised_by|body\.email/);
  assert.match(fn, /replyTo/);
  assert.match(fn, /SUPPORT_EMAIL/);
  const front = readFileSync(
    new URL("../src/queries/salesIssueTickets.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(front, /service_role|SERVICE_ROLE/);
});

test("phone masking: view masks in SQL, edge function masks responses", () => {
  const view = readFileSync(
    new URL(
      "../supabase/migrations/20261025000100_sales_issue_tickets_phone_masking.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(view, /view_unmasked_customer_phone_numbers/);
  assert.match(view, /'XXXXXXXXX' \|\| right\(t\.phone_number, 2\)/);
  assert.match(view, /REVOKE SELECT ON public\.sales_issue_tickets FROM authenticated/);
  const fn = readFileSync(
    new URL("../supabase/functions/sales-issue-tickets/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(fn, /view_unmasked_customer_phone_numbers/);
  assert.doesNotMatch(fn, /json\(200, \{ ticket(: (data|existing|ticket|created))? \}\)/);
  const q = readFileSync(
    new URL("../src/queries/salesIssueTickets.ts", import.meta.url),
    "utf8",
  );
  assert.match(q, /sales_issue_tickets_view/);
  assert.doesNotMatch(q, /\.from\("sales_issue_tickets"/);
});

test("analytics: permission-gated RPC, same filters as the table", () => {
  const stats = readFileSync(
    new URL(
      "../supabase/migrations/20261025000200_sales_issue_ticket_stats.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(stats, /current_staff_has_permission\('sales_issue_tickets'\)/);
  assert.match(stats, /REVOKE ALL ON FUNCTION[^;]*FROM PUBLIC, anon/);
  assert.match(stats, /'XXXXXXXXX' \|\| right\(t\.phone_number, 2\)/);
  const page = readFileSync(
    new URL("../src/routes/admin/SalesIssueTickets.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /useSalesIssueTicketStats\(\s*\{ range:/);
});

test("analytics SQL has no bare DELETE (Supabase API rejects it)", () => {
  const stats = readFileSync(
    new URL(
      "../supabase/migrations/20261025000200_sales_issue_ticket_stats.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const m of stats.matchAll(/DELETE FROM[^;]*;/g)) {
    assert.match(m[0], /WHERE/i, m[0]);
  }
  assert.match(stats, /'raised_today'/);
});
