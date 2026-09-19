import { readFileSync } from "node:fs";

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Cleans up via the same anon-key Supabase client / pattern used by
// tests/backend-suite.mjs, so a booking created by this UI test doesn't
// linger in the database after the test finishes.
const sb = createClient(
  "https://csnzgfzxnscumvjefpon.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzbnpnZnp4bnNjdW12amVmcG9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjMyODEyMDksImV4cCI6MjAzODg1NzIwOX0.Go70qkJn_MsIjU9QgRy1HbIUGmY-M7wmNg6MU77VaDk",
);
const TEST_DP_ID = "34239456-159b-42a0-8184-a0e11954cfd0"; // "test_dp"
const TEST_MARKER = "PW-SUITE-TEST-BOOKING";

test.afterEach(async () => {
  // Belt-and-braces cleanup: remove anything this suite created, matched
  // by a marker string in tentative_details.name rather than by id (the
  // UI test never sees the row's id).
  const { data } = await sb
    .from("Schedule")
    .select("id, tentative_details")
    .eq("instructor_id", TEST_DP_ID)
    .eq("isTentative", true);
  const toDelete = (data ?? [])
    .filter((r) => r.tentative_details?.name === TEST_MARKER)
    .map((r) => r.id);
  if (toDelete.length > 0) {
    await sb.from("Schedule").delete().in("id", toDelete);
  }
});

test.beforeEach(async ({ page }) => {
  await page.goto("/admin/sales-dashboard");
  await page.waitForSelector(".sales-dashboard-root", { timeout: 30_000 });
});

test.describe("Sales Dashboard — layout", () => {
  test("header, controls, and legend render", async ({ page }) => {
    await expect(page.getByText("Instructor availability")).toBeVisible();
    await expect(
      page.getByPlaceholder("Search or compare instructors…"),
    ).toBeVisible();
    await expect(page.getByLabel("Select month")).toBeVisible();
    await expect(page.getByLabel("Sort instructors")).toBeVisible();
    await expect(page.getByLabel("Toggle dark theme")).toBeVisible();
    await expect(page.getByLabel("Help")).toBeVisible();
  });

  test("theme toggle switches and persists across reload", async ({ page }) => {
    const toggle = page.getByLabel("Toggle dark theme");
    const root = page.locator(".sales-dashboard-root");
    const before = await root.getAttribute("data-theme");
    await toggle.click();
    const after = await root.getAttribute("data-theme");
    expect(after).not.toBe(before);

    await page.reload();
    await page.waitForSelector(".sales-dashboard-root");
    await expect(page.locator(".sales-dashboard-root")).toHaveAttribute(
      "data-theme",
      after!,
    );
    // Leave it as we found it for the next test run.
    await toggle.click();
  });

  test("help modal opens and closes", async ({ page }) => {
    await page.getByLabel("Help").click();
    await expect(page.getByLabel("How to use this dashboard")).toBeVisible();
    await page.getByLabel("Close help").click();
    await expect(
      page.getByLabel("How to use this dashboard"),
    ).not.toBeVisible();
  });
});

async function searchAndAdd(page: Page, name: string) {
  const search = page.getByPlaceholder("Search or compare instructors…");
  await search.fill(name);
  const row = page.locator(".suggest-row", { hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const addBtn = row.locator(".suggest-main");
  // Already in roster from a previous run/test -- nothing to do.
  if ((await row.getAttribute("class"))?.includes("added")) return;
  await addBtn.click();
  await expect(row).toHaveClass(/added/, { timeout: 15_000 });
}

test.describe("Sales Dashboard — search, roster, and persistence", () => {
  test("searching shows suggestions and adding loads the instructor into the grid", async ({
    page,
  }) => {
    await searchAndAdd(page, "test_dp");
    await expect(
      page.locator(".instructor-cell", { hasText: "test_dp" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("roster and search text persist across a reload", async ({ page }) => {
    await searchAndAdd(page, "test_dp");
    await page.reload();
    await page.waitForSelector(".sales-dashboard-root");
    await expect(
      page.getByPlaceholder("Search or compare instructors…"),
    ).toHaveValue("test_dp");
    await expect(
      page.locator(".instructor-cell", { hasText: "test_dp" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Clear all removes every instructor from the roster", async ({
    page,
  }) => {
    await searchAndAdd(page, "test_dp");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(
      page.locator(".instructor-cell", { hasText: "test_dp" }),
    ).not.toBeVisible();
  });
});

test.describe("Sales Dashboard — location map collapse persistence", () => {
  test("collapsing the location search panel persists across reload", async ({
    page,
  }) => {
    const collapseBtn = page.getByLabel("Collapse the search by location card");
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();
    await expect(
      page.getByLabel("Expand the search by location card"),
    ).toBeVisible();

    await page.reload();
    await page.waitForSelector(".sales-dashboard-root");
    await expect(
      page.getByLabel("Expand the search by location card"),
    ).toBeVisible();

    // Leave it expanded again for the next test run.
    await page.getByLabel("Expand the search by location card").click();
  });
});

test.describe("Sales Dashboard — tentative booking flow", () => {
  test("double-clicking a free slot, filling the form, and submitting creates a tentative booking", async ({
    page,
  }) => {
    await searchAndAdd(page, "test_dp");
    const row = page.locator(".row", { hasText: "test_dp" }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Try the currently selected date first, then a few date tabs, until a
    // free (bookable) cell is found -- avoids depending on one specific
    // date always having a free hour for this fixture instructor.
    const dateTabs = page.locator(".tab");
    const tabCount = await dateTabs.count();
    let freeCell = null;
    for (let i = 0; i < Math.min(tabCount, 6); i++) {
      if (i > 0) {
        await dateTabs.nth(i).click();
        await page.waitForTimeout(300);
      }
      const candidate = row.locator("td.cell.cell-free").first();
      if ((await candidate.count()) > 0) {
        freeCell = candidate;
        break;
      }
    }
    test.skip(
      !freeCell,
      "no free slot found for test_dp across the first 6 visible dates",
    );
    if (!freeCell) return;

    await freeCell.dblclick();

    await expect(page.getByText("Create Tentative Slot Booking")).toBeVisible({
      timeout: 5_000,
    });
    await page.locator("#customerName").fill(TEST_MARKER);
    await page.locator("#customerPhone").fill("9123456789");
    await page.locator("#customerAddress").fill("Playwright test address");
    // Sales Agent is read-only (locked to the logged-in account) --
    // regression check for that fix. The value comes from
    // useCurrentAdmin()/useCurrentUser(), an async identity lookup (the
    // latter calls an edge function) independent of this flow, so give it
    // a moment to resolve rather than asserting on it immediately.
    await expect(page.locator("#salesAgent")).toHaveAttribute("readonly", "");
    await expect
      .poll(
        async () => (await page.locator("#salesAgent").inputValue()).length,
        {
          timeout: 10_000,
        },
      )
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: /Create Tentative Block/ }).click();

    // In-modal success message, then the dashboard-level toast after the
    // modal closes.
    await expect(page.getByText(/booked successfully/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("phone number input rejects non-digits and caps at 10 characters", async ({
    page,
  }) => {
    await searchAndAdd(page, "test_dp");
    const row = page.locator(".row", { hasText: "test_dp" }).first();
    const freeCell = row.locator("td.cell.cell-free").first();
    if ((await freeCell.count()) === 0) {
      test.skip(true, "no free slot available to open the booking modal");
      return;
    }
    await freeCell.dblclick();
    await expect(page.getByText("Create Tentative Slot Booking")).toBeVisible();
    const phoneInput = page.locator("#customerPhone");
    // pressSequentially types one character at a time, firing onChange per
    // keystroke like a real user -- .fill() sets the whole string via one
    // native DOM write, which the input's own maxLength=10 HTML attribute
    // truncates to 10 *characters* (not digits) before React's onChange
    // (which extracts only digits) ever sees it, understating how many
    // digits actually reach the app's own validation.
    await phoneInput.pressSequentially("abc123def4567890");
    await expect(phoneInput).toHaveValue("1234567890");
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});
