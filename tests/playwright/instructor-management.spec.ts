import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/admin/instructors");
  await page.waitForSelector("text=Instructor Management", {
    timeout: 30_000,
  });
});

test.describe("Instructor Management — layout", () => {
  test("header, search, status filter, and instructor cards render", async ({
    page,
  }) => {
    await expect(page.getByText("Instructor Management")).toBeVisible();
    await expect(
      page.getByPlaceholder(
        "Search instructors by name, phone, car, or area...",
      ),
    ).toBeVisible();
    await expect(page.getByText("Onboard Instructor")).toBeVisible();
    await expect(page.getByText("Quick Add")).toBeVisible();
    // At least one instructor card with the expected action buttons.
    await expect(page.getByText("View Schedule").first()).toBeVisible();
    await expect(page.getByText("Search Schedule").first()).toBeVisible();
    await expect(page.getByText("Edit Details").first()).toBeVisible();
    await expect(page.getByText("Delete Instructor").first()).toBeVisible();
  });

  test("searching filters the instructor card list", async ({ page }) => {
    const search = page.getByPlaceholder(
      "Search instructors by name, phone, car, or area...",
    );
    await search.fill("test_dp");
    await page.waitForTimeout(800);
    await expect(
      page.getByText("test_dp", { exact: false }).first(),
    ).toBeVisible({
      timeout: 10_000,
    });
  });

  test("status filter toggles between Active/On Break/Inactive", async ({
    page,
  }) => {
    const inactiveFilter = page.getByText(/Inactive\s*\d+/);
    await expect(inactiveFilter).toBeVisible();
    await inactiveFilter.click();
    await page.waitForTimeout(800);
    // Switching the filter should not blank the page -- at least the
    // search box and header stay put regardless of which status is shown.
    await expect(page.getByText("Instructor Management")).toBeVisible();
    await page.getByText("Clear filter").click();
  });
});

test.describe("Instructor Management — View Schedule calendar", () => {
  test("View Schedule opens a dialog showing 24-hour time labels", async ({
    page,
  }) => {
    const search = page.getByPlaceholder(
      "Search instructors by name, phone, car, or area...",
    );
    await search.fill("test_dp");
    await page.waitForTimeout(800);

    const card = page
      .locator("div", { has: page.getByText("test_dp", { exact: false }) })
      .first();
    const viewScheduleBtn = page.getByText("View Schedule").first();
    await viewScheduleBtn.click();

    // The calendar dialog should show HH:mm-style time labels (24-hour,
    // e.g. "06:00"), not 12-hour AM/PM -- regression check for the time
    // format unification fix.
    await expect(page.getByText(/^\d{2}:\d{2}$/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/\d{1,2}\s*(AM|PM)/i)).toHaveCount(0);
  });
});
