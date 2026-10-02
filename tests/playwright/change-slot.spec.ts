import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Sales Dashboard booking modal: a conflicting class shows a bare "Conflict"
// badge and a "Change slot" button. Clicking it sends Sales to the calendar;
// double-clicking a FREE slot there replaces that class (same position) and
// reopens the modal. Nothing is submitted, so the DB only ever holds the one
// seeded conflict row, which is removed afterwards.

function envVar(name: string): string {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} missing from .env`);
}

const sb = createClient(
  envVar("VITE_SUPABASE_URL"),
  envVar("VITE_SUPABASE_ANON_KEY"),
);
const TEST_DP_ID = "34239456-159b-42a0-8184-a0e11954cfd0"; // "test_dp"
const MARKER = "PW-CHANGE-SLOT-E2E";
const RANGE = { from: "2027-07-01", to: "2027-07-31" };

async function monthRowCount(): Promise<number> {
  const { count, error } = await sb
    .from("Schedule")
    .select("id", { count: "exact", head: true })
    .eq("instructor_id", TEST_DP_ID)
    .gte("date", RANGE.from)
    .lte("date", RANGE.to);
  if (error) throw error;
  return count ?? 0;
}

async function cleanup() {
  const { data } = await sb
    .from("Schedule")
    .select("id,tentative_details")
    .eq("instructor_id", TEST_DP_ID)
    .gte("date", RANGE.from)
    .lte("date", RANGE.to);
  const ids = (data ?? [])
    .filter((r) => String(r.tentative_details?.name ?? "").startsWith(MARKER))
    .map((r) => r.id);
  if (ids.length) await sb.from("Schedule").delete().in("id", ids);
}

let baseline = 0;
test.beforeAll(async () => {
  await cleanup();
  baseline = await monthRowCount();
});
test.afterAll(async () => {
  await cleanup();
  expect(await monthRowCount()).toBe(baseline);
});

const MONTH_ABBREV = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

async function searchAndAdd(page: Page, name: string) {
  const search = page.getByPlaceholder("Search or compare instructors…");
  await search.fill(name);
  const row = page.locator(".suggest-row", { hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  if (!(await row.getAttribute("class"))?.includes("added")) {
    await row.locator(".suggest-main").click();
    await expect(row).toHaveClass(/added/, { timeout: 15_000 });
  }
  await search.fill("");
  await page.keyboard.press("Escape");
}

async function gotoDate(page: Page, date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const abbrev = MONTH_ABBREV[month - 1];
  for (let i = 0; i < 24; i++) {
    const label = (await page.locator(".cal-month").innerText()).trim();
    if (label.includes(abbrev) && label.includes(String(year))) break;
    await page.getByLabel("Next month").click();
    await expect
      .poll(async () => (await page.locator(".cal-month").innerText()).trim(), {
        timeout: 10_000,
      })
      .not.toBe(label);
  }
  await expect(page.locator(".tab").first()).toBeVisible({ timeout: 30_000 });
  const tab = page
    .locator(".tab")
    .filter({
      has: page.locator("strong", { hasText: new RegExp(`^${day}$`) }),
    })
    .first();
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveClass(/\bactive\b/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

async function dpRow(page: Page) {
  const row = page.locator(".row", { hasText: "test_dp" }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const labels = await page.locator("thead th.col-time-h").allInnerTexts();
  await expect(row.locator("td.cell")).toHaveCount(labels.length, {
    timeout: 20_000,
  });
  return { row, labels };
}

async function dblclickSlot(
  page: Page,
  hhmm: string,
  until: () => Promise<void>,
) {
  const { row, labels } = await dpRow(page);
  const idx = labels.findIndex((t) => t.includes(hhmm));
  expect(idx, `grid has a ${hhmm} column`).toBeGreaterThanOrEqual(0);
  await expect(async () => {
    await row.locator("td.cell").nth(idx).dblclick();
    await until();
  }).toPass({ timeout: 30_000 });
}

const classRow = (page: Page, text: string) =>
  page.locator("div.rounded-md", { hasText: text });

test("conflicting class: bare 'Conflict' badge + Change slot replaces it from the calendar", async ({
  page,
}) => {
  test.setTimeout(180_000);
  expect(baseline, "test_dp already has rows in 2027-07").toBe(0);

  // A real conflict: test_dp is already busy 2027-07-08 09:00-10:00.
  const ins = await sb.from("Schedule").insert({
    instructor_id: TEST_DP_ID,
    date: "2027-07-08",
    start_time: "09:00",
    end_time: "10:00",
    status: "hold",
    isTentative: true,
    tentative_details: {
      name: `${MARKER}-seed`,
      phone: "9123450097",
      sales_agent: "e2e",
      payment_status: "unpaid",
      address: "seed",
      course: "demo",
      created_at: new Date().toISOString(),
    },
    learner_id: null,
    course_id: null,
    lesson_id: null,
  });
  expect(ins.error, ins.error?.message).toBeNull();

  await page.goto("/admin/sales-dashboard");
  await page.waitForSelector(".sales-dashboard-root", { timeout: 20_000 });
  await searchAndAdd(page, "test_dp");

  // Base class 07-07 09:00, then Bulk Daily x2 -> 07-08 (conflict), 07-09.
  const heading = page.getByText("Create Tentative Slot Booking");
  await gotoDate(page, "2027-07-07");
  await dblclickSlot(page, "09:00", () =>
    expect(heading).toBeVisible({ timeout: 3_000 }),
  );
  await page.getByRole("button", { name: /Bulk Add/ }).click();
  const dlg = page.getByRole("dialog", { name: "Bulk Add Schedules" });
  await dlg.locator("#bulkType").selectOption("daily");
  await dlg.locator("#bulkRepeat").fill("2");
  await dlg.getByRole("button", { name: "Add to Preview" }).click();
  await expect(dlg).toBeHidden({ timeout: 20_000 });

  // All 3 classes are kept (nothing filtered out).
  await expect(page.getByText("Selected Slots (3)")).toBeVisible();

  // Class 2 (07-08) is the conflict: bare badge, no reason text, Change slot.
  const conflictRow = classRow(page, "Class 2: 2027-07-08");
  await expect(conflictRow.getByText("Conflict", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(conflictRow).not.toContainText("(");
  await expect(conflictRow).not.toContainText(/busy|not available/i);
  await expect(
    classRow(page, "Class 3: 2027-07-09").getByText("Free", { exact: true }),
  ).toBeVisible();
  // Free rows offer no Change slot; submit is blocked while a conflict stands.
  await expect(page.getByRole("button", { name: /Change slot/ })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("button", { name: /Create 3 Tentative Blocks/ }),
  ).toBeDisabled();

  // Change slot -> modal hides, banner names the class being replaced.
  await page.getByRole("button", { name: "Change slot for class 2" }).click();
  await expect(heading).toBeHidden();
  await expect(page.getByText("Pick a new slot for Class 2")).toBeVisible();

  // Double-click a FREE slot (07-12 09:00) -> replaces Class 2 in place.
  await gotoDate(page, "2027-07-12");
  await dblclickSlot(page, "09:00", () =>
    expect(heading).toBeVisible({ timeout: 3_000 }),
  );
  await expect(page.getByText("Selected Slots (3)")).toBeVisible();
  const replaced = classRow(page, "Class 2: 2027-07-12");
  await expect(replaced.getByText("Free", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("2027-07-08")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Change slot/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /Create 3 Tentative Blocks/ }),
  ).toBeEnabled();
});
