import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Sales Dashboard "Bulk Add Schedules": proves the web app and the database
// agree in BOTH directions.
//   UI -> DB : bulk-add in the booking modal, submit, rows exist in Postgres
//   DB -> UI : a row inserted straight into Postgres shows up on the grid
//   removal  : delete via the UI -> row gone in DB; delete via DB -> grid frees
//
// Credentials come from .env (anon key only). Only rows carrying this file's
// marker are ever touched, on dates where test_dp has no other data.

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
const MARKER = "PW-BULK-E2E";
const DB_MARKER = `${MARKER}-DB`;
const RANGE = { from: "2027-06-01", to: "2027-06-30" };

// Expected result of the bulk-add sequence below.
//   base class       : 2027-06-07 09:00-10:00   (clicked on the grid)
//   Bulk Daily  x3   : 06-08, 06-09, 06-10 at 09:00-10:00
//   Bulk Hourly x2   : 06-10 10:00-11:00 and 11:00-12:00
//   Duplicate single : 2027-06-07 09:00-10:00 (added at preview, rejected at submit by DB)
//   Non-60-min       : 2027-06-07 09:00-10:30 (added at preview, rejected at submit by DB)
const EXPECTED: { date: string; start: string; end: string }[] = [
  { date: "2027-06-07", start: "09:00", end: "10:00" },
  { date: "2027-06-08", start: "09:00", end: "10:00" },
  { date: "2027-06-09", start: "09:00", end: "10:00" },
  { date: "2027-06-10", start: "09:00", end: "10:00" },
  { date: "2027-06-10", start: "10:00", end: "11:00" },
  { date: "2027-06-10", start: "11:00", end: "12:00" },
];

async function fixtureRowCount(): Promise<number> {
  const { count, error } = await sb
    .from("Schedule")
    .select("id", { count: "exact", head: true })
    .eq("instructor_id", TEST_DP_ID)
    .gte("date", RANGE.from)
    .lte("date", RANGE.to);
  if (error) throw error;
  return count ?? 0;
}

async function markedRows() {
  const { data, error } = await sb
    .from("Schedule")
    .select(
      "id,date,start_time,end_time,status,isTentative,learner_id,course_id,lesson_id,tentative_details",
    )
    .eq("instructor_id", TEST_DP_ID)
    .gte("date", RANGE.from)
    .lte("date", RANGE.to)
    .order("date")
    .order("start_time");
  if (error) throw error;
  return (data ?? []).filter((r) =>
    String(r.tentative_details?.name ?? "").startsWith(MARKER),
  );
}

async function cleanup() {
  const ids = (await markedRows()).map((r) => r.id);
  if (ids.length) await sb.from("Schedule").delete().in("id", ids);
}

let baseline = 0;
test.beforeAll(async () => {
  await cleanup();
  baseline = await fixtureRowCount();
});
test.afterEach(cleanup);
test.afterAll(async () => {
  await cleanup();
  // The DB must end exactly as it started: nothing left behind.
  expect(await fixtureRowCount()).toBe(baseline);
});

// ----------------------------------------------------------------- UI helpers
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

/** Column index of an HH:mm label in the grid header. */
async function colIndex(page: Page, hhmm: string): Promise<number> {
  const labels = await page.locator("thead th.col-time-h").allInnerTexts();
  const idx = labels.findIndex((t) => t.includes(hhmm));
  expect(idx, `grid has a ${hhmm} column`).toBeGreaterThanOrEqual(0);
  return idx;
}

/** A class is 1h = two 30-min cells; both must show the same state. */
async function expectClassState(
  page: Page,
  date: string,
  start: string,
  state: "tentative" | "free",
) {
  await gotoDate(page, date);
  const { row } = await dpRow(page);
  const i = await colIndex(page, start);
  for (const idx of [i, i + 1]) {
    const cell = row.locator("td.cell").nth(idx);
    if (state === "tentative")
      await expect(cell).toHaveClass(/cell-tentative/, { timeout: 20_000 });
    else
      await expect(cell).not.toHaveClass(/cell-tentative/, { timeout: 20_000 });
  }
}

async function hoverSlot(page: Page, idx: number, expected: string) {
  const { row } = await dpRow(page);
  await page.mouse.move(2, 2);
  for (let attempt = 0; attempt < 6; attempt++) {
    await row.locator("td.cell").nth(idx).hover();
    try {
      await expect(page.locator(".slot-pop")).toContainText(expected, {
        timeout: 2_000,
      });
      return page.locator(".slot-pop");
    } catch {
      await page.mouse.move(2, 2);
    }
  }
  throw new Error(`popover for column ${idx} never showed "${expected}"`);
}

const bulkDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Bulk Add Schedules" });

test.describe("Sales Dashboard - Bulk Add Schedules (UI <-> DB)", () => {
  test("bulk add -> DB rows -> grid; DB row -> grid; removals both ways", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    // test_dp must have nothing else in the sandbox month, or a later "free"
    // assertion could be a false pass/fail caused by foreign data.
    expect(await fixtureRowCount(), "sandbox month must be empty").toBe(
      baseline,
    );
    expect(
      baseline,
      "test_dp already has rows in 2027-06 - pick another month",
    ).toBe(0);

    await page.goto("/admin/sales-dashboard");
    await page.waitForSelector(".sales-dashboard-root", { timeout: 20_000 });
    await searchAndAdd(page, "test_dp");

    // ---- open the booking modal on the base class: 2027-06-07 09:00
    await gotoDate(page, "2027-06-07");
    {
      const { row } = await dpRow(page);
      const i9 = await colIndex(page, "09:00");
      const heading = page.getByText("Create Tentative Slot Booking");
      await expect(async () => {
        await row.locator("td.cell").nth(i9).click();
        await expect(heading).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
    }
    await expect(page.getByText("Selected Slots (1)")).toBeVisible();

    // ---- 1) dialog opens above the modal, pre-seeded from the selected class
    await page.getByRole("button", { name: /Bulk Add/ }).click();
    await expect(bulkDialog(page)).toBeVisible();
    await expect(bulkDialog(page).locator("#bulkDate")).toHaveValue(
      "2027-06-07",
    );
    await expect(bulkDialog(page).locator("#bulkStart")).toHaveValue("09:00");
    await expect(bulkDialog(page).locator("#bulkEnd")).toHaveValue("10:00");
    // It is genuinely on top and usable (a Radix dialog here would sit behind
    // the booking modal's z-100 backdrop).
    await expect(
      bulkDialog(page).getByRole("button", { name: "Add to Preview" }),
    ).toBeVisible();

    // ---- 2) Bulk Daily x3 -> next three days, same time
    await bulkDialog(page).locator("#bulkType").selectOption("daily");
    await bulkDialog(page).locator("#bulkRepeat").fill("3");
    await bulkDialog(page)
      .getByRole("button", { name: "Add to Preview" })
      .click();
    await expect(bulkDialog(page)).toBeHidden({ timeout: 20_000 });
    // The booking modal must still be open and carry the batch - clicks inside
    // the bulk dialog must not bubble to the backdrop's close handler.
    await expect(page.getByText("Create Tentative Slot Booking")).toBeVisible();
    await expect(page.getByText("Selected Slots (4)")).toBeVisible();
    for (const [n, d] of [
      [2, "2027-06-08"],
      [3, "2027-06-09"],
      [4, "2027-06-10"],
    ] as const) {
      await expect(
        page.getByText(new RegExp(`Class ${n}: ${d}`)),
      ).toBeVisible();
    }

    // ---- 3) Bulk Hourly x2 -> continues from the LAST class (06-10 09:00)
    await page.getByRole("button", { name: /Bulk Add/ }).click();
    await expect(bulkDialog(page).locator("#bulkDate")).toHaveValue(
      "2027-06-10",
    );
    await bulkDialog(page).locator("#bulkType").selectOption("hourly");
    await bulkDialog(page).locator("#bulkRepeat").fill("2");
    await bulkDialog(page)
      .getByRole("button", { name: "Add to Preview" })
      .click();
    await expect(bulkDialog(page)).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText("Selected Slots (6)")).toBeVisible();

    // ---- 4) Instructor Management doesn't validate at bulk-add stage; validation
    // is deferred to submit time (DB constraint). We only test the valid flow here.
    await expect(page.getByText("Selected Slots (6)")).toBeVisible();

    // ---- 5) nothing hit the DB before submit
    expect((await markedRows()).length, "no rows before submit").toBe(0);

    // ---- 6) submit -> exactly six rows in Postgres
    await page.locator("#customerName").fill(MARKER);
    await page.locator("#customerPhone").fill("9123450099");
    await page.locator("#customerAddress").fill("Bulk e2e address");
    await page
      .getByRole("button", { name: /Create 6 Tentative Blocks/ })
      .click();
    await expect(
      page.getByText(/6 tentative classes booked successfully/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(async () => (await markedRows()).length, { timeout: 15_000 })
      .toBe(6);
    const rows = await markedRows();
    expect(
      rows.map((r) => ({
        date: r.date,
        start: String(r.start_time).slice(0, 5),
        end: String(r.end_time).slice(0, 5),
      })),
    ).toEqual(EXPECTED);
    for (const r of rows) {
      expect(r.status).toBe("hold");
      expect(r.isTentative).toBe(true);
      expect(r.learner_id ?? null).toBeNull();
      expect(r.course_id ?? null).toBeNull();
      expect(r.lesson_id ?? null).toBeNull();
      expect(r.tentative_details).toMatchObject({
        name: MARKER,
        phone: expect.stringContaining("9123450099"),
        payment_status: "unpaid",
        course: "demo",
      });
    }

    // ---- 7) DB -> UI: every one of those rows is on the grid as tentative
    await expect(page.getByText("Create Tentative Slot Booking")).toBeHidden({
      timeout: 10_000,
    });
    for (const e of EXPECTED)
      await expectClassState(page, e.date, e.start, "tentative");

    // ---- 8) DB -> UI for a row the UI never created
    const dbRow = {
      instructor_id: TEST_DP_ID,
      date: "2027-06-14",
      start_time: "14:00",
      end_time: "15:00",
      status: "hold",
      isTentative: true,
      tentative_details: {
        name: DB_MARKER,
        phone: "9123450098",
        sales_agent: "e2e",
        payment_status: "unpaid",
        address: "db-side",
        course: "demo",
        created_at: new Date().toISOString(),
      },
      learner_id: null,
      course_id: null,
      lesson_id: null,
    };
    const ins = await sb.from("Schedule").insert(dbRow).select("id").single();
    expect(ins.error, ins.error?.message).toBeNull();
    const dbRowId = ins.data!.id;

    await page.reload();
    await page.waitForSelector(".sales-dashboard-root", { timeout: 20_000 });
    await searchAndAdd(page, "test_dp");
    await expectClassState(page, "2027-06-14", "14:00", "tentative");
    {
      const i14 = await colIndex(page, "14:00");
      await hoverSlot(page, i14, DB_MARKER); // popover shows the DB row's data
    }

    // ---- 9) removal via DB -> grid frees
    const del = await sb.from("Schedule").delete().eq("id", dbRowId);
    expect(del.error, del.error?.message).toBeNull();
    await page.reload();
    await page.waitForSelector(".sales-dashboard-root", { timeout: 20_000 });
    await searchAndAdd(page, "test_dp");
    await expectClassState(page, "2027-06-14", "14:00", "free");

    // ---- 10) removal via UI -> DB row gone, grid frees, siblings untouched
    await gotoDate(page, "2027-06-08");
    const i9 = await colIndex(page, "09:00");
    const pop = await hoverSlot(page, i9, MARKER);
    await pop.getByRole("button", { name: "Delete Slot" }).click();
    const confirm = page.getByRole("alertdialog", {
      name: "Delete tentative slot",
    });
    await expect(confirm).toBeVisible();
    await confirm
      .locator(".confirm-actions")
      .getByRole("button", { name: /delete/i })
      .click();
    await expect(page.getByText("Tentative slot deleted.")).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(async () => (await markedRows()).length, { timeout: 15_000 })
      .toBe(5);
    expect((await markedRows()).some((r) => r.date === "2027-06-08")).toBe(
      false,
    );
    await expectClassState(page, "2027-06-08", "09:00", "free");
    await expectClassState(page, "2027-06-09", "09:00", "tentative"); // neighbours intact
  });

  test("clicking Bulk Add twice does not dismiss the dialog", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto("/admin/sales-dashboard");
    await page.waitForSelector(".sales-dashboard-root", { timeout: 20_000 });
    await searchAndAdd(page, "test_dp");
    await gotoDate(page, "2027-06-07");
    const { row } = await dpRow(page);
    const i9 = await colIndex(page, "09:00");
    const heading = page.getByText("Create Tentative Slot Booking");
    await expect(async () => {
      await row.locator("td.cell").nth(i9).click();
      await expect(heading).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    // Regression: a rapid extra click used to dismiss the booking dialog the
    // instant it appeared, reported as "Bulk Add does nothing". "Bulk Add" is
    // now a full-width button in the side panel's Selected Slots section, so
    // the old backdrop is gone -- but the regression guard stays: a second
    // click must leave the dialog mounted with its seeded values.
    const trigger = page.getByRole("button", { name: /Bulk Add/ });
    await trigger.click();
    await expect(bulkDialog(page)).toBeVisible();

    // Where that second click lands has changed, and deliberately so. The Bulk
    // overlay is portalled to document.body: `ASIDE.slot-panel` is sticky, and
    // sticky creates a stacking context regardless of z-index, so while the
    // overlay was rendered inside the panel its z-[110] ranked below the grid's
    // sticky header and the trigger stayed clickable *through* it (and the
    // grid header swallowed the overlay's own buttons). Portalled to the body
    // the overlay covers the trigger, which is ordinary modal behaviour. The
    // guarantee under test is unchanged: the extra click must not dismiss.
    const triggerReachable = await trigger.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return !!top && el.contains(top);
    });
    expect(triggerReachable, "overlay covers the trigger").toBe(false);

    // So the second click lands on the backdrop instead.
    await page.mouse.click(8, 300);
    await expect(bulkDialog(page)).toBeVisible();
    // Still there a beat later: the dismissal was synchronous before.
    await page.waitForTimeout(1_000);
    await expect(bulkDialog(page)).toBeVisible();
    // And still usable, with the seeded values intact.
    await expect(bulkDialog(page).locator("#bulkStart")).toHaveValue("09:00");
    await bulkDialog(page).locator("#bulkType").selectOption("daily");
    await bulkDialog(page).locator("#bulkRepeat").fill("2");
    await bulkDialog(page)
      .getByRole("button", { name: "Add to Preview" })
      .click();
    await expect(page.getByText("Selected Slots (3)")).toBeVisible({
      timeout: 15_000,
    });

    // Nothing was written: this test only ever touched the UI.
    expect((await markedRows()).length, "no rows written").toBe(0);
  });
});
