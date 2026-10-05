import { expect, type Page, test } from "@playwright/test";

// TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
//
// Verifies the monitoring pipeline without needing the (manual-apply) table to
// exist: the POST to sales_dashboard_temporary_logs is intercepted and its body
// asserted. This proves rows are shaped correctly, carry the authenticated
// identity, are batched, carry the customer name on booking events, and never
// contain a phone number or address.

type Row = Record<string, unknown>;

/** The customer name is recorded deliberately; the phone is not. */
const CUSTOMER_NAME = "Monitoring Fixture Rao";
const CUSTOMER_PHONE = "9123456789";

/** A free, full-hour grid cell. Same selector the booking-flow spec uses. */
const BOOKABLE_CELL = "td.cell.cell-free:not(.cell-half)";

/**
 * Capture log batches while making every write fail the way it would if the
 * migration had not been applied, so the dashboard is never waiting on a table
 * that may not exist.
 */
async function captureLogBatches(page: Page): Promise<Row[][]> {
  const batches: Row[][] = [];
  await page.route(
    "**/rest/v1/sales_dashboard_temporary_logs**",
    async (route) => {
      const body = route.request().postData();
      if (route.request().method() === "POST" && body) {
        try {
          batches.push(JSON.parse(body));
        } catch {
          /* not JSON, ignore */
        }
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42P01",
          message:
            'relation "public.sales_dashboard_temporary_logs" does not exist',
        }),
      });
    },
  );
  return batches;
}

async function searchAndAdd(page: Page, name: string) {
  const search = page.getByPlaceholder("Search or compare instructors…");
  await search.fill(name);
  const row = page.locator(".suggest-row", { hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  if (!(await row.getAttribute("class"))?.includes("added")) {
    await row.locator(".suggest-main").click();
    await expect(row).toHaveClass(/added/, { timeout: 15_000 });
  }
}

test.describe("temp monitoring", () => {
  test("emits identity-tagged, redacted, batched rows without breaking the dashboard", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const batches = await captureLogBatches(page);

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto("/admin/sales-dashboard");
    await page.waitForSelector(".sales-dashboard-root", { timeout: 20_000 });
    await searchAndAdd(page, "test_dp");
    await page.waitForTimeout(1000);

    const allRows = () => batches.flat();
    const byName = (n: string) => allRows().filter((r) => r.event_name === n);

    // The dashboard itself must be unaffected by the (failing) log writes.
    await expect(page.locator(".sales-dashboard-root")).toBeVisible();
    await expect(
      page.locator(".row", { hasText: "test_dp" }).first(),
    ).toBeVisible();

    // Nudge a few more actions so a batch flushes.
    await page.getByRole("button", { name: "Next month" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Previous month" }).click();
    await page.waitForTimeout(500);

    // Wait for the specific events, not merely the first flush. `trackEvent`
    // debounces its writes, so the month clicks land in a later batch than the
    // opening events; snapshotting `rows` as soon as ANY batch arrived raced
    // that and read zero `month_changed` rows even though both clicks had fired
    // (the page was back on the starting month, Previous disabled).
    await expect
      .poll(async () => allRows().length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => byName("month_changed").length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);

    const rows = allRows();
    const session = new Set(rows.map((r) => r.session_id));
    expect(session.size, "one session id for this tab").toBe(1);

    // dashboard_opened, instructor_added and the API timings must all be there.
    expect(byName("dashboard_opened").length).toBeGreaterThan(0);
    expect(byName("instructor_added").length).toBeGreaterThan(0);
    expect(byName("month_changed").length).toBeGreaterThanOrEqual(2);

    const apiRows = allRows().filter((r) => r.category === "api");
    expect(apiRows.length, "API calls are timed").toBeGreaterThan(0);
    for (const r of apiRows) {
      expect(typeof r.api_name).toBe("string");
      expect(typeof r.duration_ms).toBe("number");
      expect(r.http_method).toBeTruthy();
    }
    expect(apiRows.map((r) => r.api_name)).toContain(
      "app_settings.fetch_booking_flow",
    );

    // Identity: never anonymous. user_id is the admin/user record id when the
    // Go lookup resolved, auth_user_id is the Supabase Auth uid; either one is
    // enough to attribute the session.
    for (const r of rows) {
      expect(
        r.user_id ?? r.auth_user_id,
        "row is attributable to an authenticated user",
      ).toBeTruthy();
    }
    expect(
      rows.some((r) => r.auth_user_id),
      "Supabase Auth uid recorded",
    ).toBe(true);
    expect(
      rows.every((r) => r.session_id && r.ts),
      "session_id and ts on every row",
    ).toBe(true);

    // Redaction: a customer's phone typed into the booking form must not reach
    // the payload, and neither may any secret-bearing value.
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(CUSTOMER_PHONE);
    expect(serialized).not.toMatch(
      /"(password|apikey|access_token|refresh_token)":"(?!\s*\[)/i,
    );
    expect(serialized.length).toBeGreaterThan(100);

    // session_start/dashboard_opened must be recorded, not just actions.
    expect(byName("session_start").length).toBeGreaterThan(0);
    expect(byName("dashboard_opened").length).toBeGreaterThan(0);

    // Structure required by the migration.
    for (const r of rows) {
      for (const col of [
        "ts",
        "session_id",
        "category",
        "event_name",
        "device",
        "props",
      ]) {
        expect(r, `column ${col}`).toHaveProperty(col);
      }
      expect(["session", "user_action", "api", "error"]).toContain(r.category);
      // Regression guard: every key sent must be a real column. PostgREST
      // rejects the WHOLE batch if one key has no column, and the app swallows
      // that error -- a top-level `customer_name` (a column that only existed
      // in an unapplied migration) once silently stopped all logging. The name
      // travels in props.customer_name instead.
      expect(r, "no customer_name column").not.toHaveProperty("customer_name");
      // Present only on booking events; never a number-shaped value.
      const named = (r.props as Record<string, unknown> | null)?.customer_name;
      if (named !== undefined) {
        expect(typeof named).toBe("string");
        expect(String(named)).not.toMatch(/\d{6,}/);
      }
    }
    const device = rows[0].device as Record<string, unknown>;
    expect(device).toHaveProperty("browser");
    expect(device).toHaveProperty("os");
    expect(device).toHaveProperty("tz");

    expect(pageErrors, "no uncaught frontend errors").toEqual([]);
  });

  test("kill switch disables monitoring with no writes at all", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    let posts = 0;
    await page.route(
      "**/rest/v1/sales_dashboard_temporary_logs**",
      async (route) => {
        if (route.request().method() === "POST") posts += 1;
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: "{}",
        });
      },
    );
    await page.addInitScript(() => {
      localStorage.setItem("sales_dashboard_monitoring_off", "1");
    });

    await page.goto("/admin/sales-dashboard");
    await page.waitForSelector(".sales-dashboard-root", { timeout: 20_000 });
    await searchAndAdd(page, "test_dp");
    await page.waitForTimeout(6000);
    expect(posts, "no log writes while switched off").toBe(0);
  });

  test("attributes a booking to the customer by name, never by phone", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const batches = await captureLogBatches(page);

    await page.goto("/admin/sales-dashboard");
    await page.waitForSelector(".sales-dashboard-root", { timeout: 20_000 });
    await searchAndAdd(page, "test_dp");

    const row = page.locator(".row", { hasText: "test_dp" }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    // The grid paints cells before the Schedule fetch resolves, so wait for a
    // bookable hour rather than snapshotting count() (which reads 0 mid-fetch).
    const hasFreeHour = await row
      .locator(BOOKABLE_CELL)
      .first()
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasFreeHour, "no free hour available to open the booking modal");

    const heading = page.getByText("Create Tentative Slot Booking");
    // A re-render can eat the click, so retry on a fresh node.
    for (let attempt = 0; attempt < 3; attempt++) {
      const cell = row.locator(BOOKABLE_CELL).first();
      if ((await cell.count()) === 0) break;
      await cell.click();
      if (await heading.isVisible().catch(() => false)) break;
    }
    await expect(heading).toBeVisible({ timeout: 5_000 });

    // Type a customer, then close WITHOUT submitting: booking_cancelled is the
    // one event that needs no database write, so this needs no seed and leaves
    // no Schedule row behind.
    await page.getByPlaceholder("Enter customer name").fill(CUSTOMER_NAME);
    await page.getByPlaceholder("10-digit phone number").fill(CUSTOMER_PHONE);
    await page.getByRole("button", { name: "Close booking modal" }).click();

    const allRows = () => batches.flat();
    await expect
      .poll(
        () =>
          allRows().filter((r) => r.event_name === "booking_cancelled").length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    const cancelled = allRows().filter(
      (r) => r.event_name === "booking_cancelled",
    );
    for (const r of cancelled) {
      expect(
        (r.props as Record<string, unknown> | null)?.customer_name,
        "customer name on an abandoned booking",
      ).toBe(CUSTOMER_NAME);
    }
    // The name is allowed; the phone that was typed beside it is not.
    expect(JSON.stringify(cancelled)).not.toContain(CUSTOMER_PHONE);
    expect(JSON.stringify(allRows())).not.toContain(CUSTOMER_PHONE);
  });
});
