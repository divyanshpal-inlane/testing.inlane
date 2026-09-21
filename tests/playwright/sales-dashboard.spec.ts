import { expect, type Page, test } from "@playwright/test";
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
const PAID_INFO_MARKER = "PW-SUITE-PAID-INFO-BOOKING";

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
    .filter(
      (r) =>
        r.tentative_details?.name === TEST_MARKER ||
        r.tentative_details?.name === PAID_INFO_MARKER,
    )
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
    // Month navigation is chevrons + a plain label, not a select (the
    // dropdown was intentionally removed as redundant with the chevrons).
    await expect(page.getByLabel("Previous month")).toBeVisible();
    await expect(page.getByLabel("Next month")).toBeVisible();
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

  test("Reset removes every instructor from the roster", async ({ page }) => {
    // "Clear all" was folded into Reset (no separate button, no confirm
    // prompt — both later, intentional refactors of the original feature).
    await searchAndAdd(page, "test_dp");
    await page.getByRole("button", { name: "Reset dashboard" }).click();
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

test.describe("Sales Dashboard — status:booked tentative rows (Instructor Management format)", () => {
  // Regression test for a real production mismatch: Instructor Management's
  // own tentative-booking feature writes status:"booked" + isTentative:true
  // + tentative_details.paid_info (e.g. "Half paid"), instead of the Sales
  // Dashboard's own status:"hold" + tentative_details.payment_status
  // ("half_paid"). Before the fix, resolveInfo() in SalesDashboard.tsx only
  // checked isTentative when status was "hold", so these rows rendered as
  // plain purple "Booked class" instead of yellow "Tentative" -- and
  // separately, paymentStatus extraction in useSalesData.ts only read
  // payment_status, so even once classified as tentative such a row would
  // default to "unpaid" (wrongly offering Override on an already-paid
  // slot). Seeds a synthetic row far in the future rather than depending on
  // any specific real production row.
  const SEED_DATE = "2027-05-06";
  const SEED_START = "14:00:00";

  test.afterEach(async () => {
    await sb
      .from("Schedule")
      .delete()
      .eq("instructor_id", TEST_DP_ID)
      .eq("date", SEED_DATE)
      .eq("start_time", SEED_START);
  });

  test("a status:booked + isTentative:true + paid_info row shows as yellow Tentative, not purple Booked, and offers no Override (already paid)", async ({
    page,
  }) => {
    const { error } = await sb.from("Schedule").insert({
      instructor_id: TEST_DP_ID,
      date: SEED_DATE,
      start_time: SEED_START,
      end_time: "15:00:00",
      status: "booked",
      isTentative: true,
      tentative_details: {
        name: PAID_INFO_MARKER,
        phone: "9123450099",
        paid_info: "Half paid",
        pickup_location: "Regression test address",
        description: "Regression test course",
      },
      learner_id: null,
      course_id: null,
      lesson_id: null,
    });
    expect(error).toBeNull();

    await searchAndAdd(page, "test_dp");
    const row = page.locator(".row", { hasText: "test_dp" }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Navigate to May 2027.
    for (let i = 0; i < 10; i++) {
      const label = await page.locator(".cal-month").innerText();
      if (label.includes("May") && label.includes("2027")) break;
      await page.getByLabel("Next month").click();
      await page.waitForTimeout(150);
    }
    await page
      .locator(".tab")
      .filter({ has: page.locator("strong", { hasText: /^6$/ }) })
      .first()
      .click();
    await page.waitForTimeout(500);

    const timeLabels = await page
      .locator("thead th.col-time-h")
      .allInnerTexts();
    const idx = timeLabels.findIndex((t) => t.includes("14:00"));
    const cell = row.locator("td.cell").nth(idx);

    await expect(cell).toHaveClass(/cell-tentative/);
    await expect(cell).not.toHaveClass(/cell-booked/);

    await cell.hover();
    const popover = page.locator(".slot-pop");
    // Title text content is "Tentative" -- CSS text-transform: uppercase
    // only changes how it's rendered, not toContainText()'s raw match.
    await expect(popover).toContainText("Tentative");
    await expect(popover).toContainText(PAID_INFO_MARKER);
    await expect(
      popover.getByRole("button", { name: /Override Slot/i }),
    ).toHaveCount(0);
    // No sales_agent recorded on this row (Instructor Management's format
    // doesn't write one) -- Delete Slot must NOT appear. A real production
    // incident: this defaulted to "allow delete when creator is unknown"
    // at first, which let any logged-in account delete a real customer's
    // tentative hold from another module. Must fail closed instead.
    await expect(
      popover.getByRole("button", { name: "Delete Slot" }),
    ).toHaveCount(0);
    await expect(popover).toContainText("No creator recorded for this slot");
  });
});

test.describe("Sales Dashboard — tentative delete restricted to creator", () => {
  const SEED_DATE = "2027-05-08";
  const OWN_MARKER = "PW-SUITE-DELETE-OWNED";
  const OTHER_MARKER = "PW-SUITE-DELETE-OTHER";

  test.afterEach(async () => {
    await sb
      .from("Schedule")
      .delete()
      .eq("instructor_id", TEST_DP_ID)
      .eq("date", SEED_DATE);
  });

  test("creator sees Delete Slot; a different sales agent's slot does not offer it", async ({
    page,
  }) => {
    // Discover the logged-in account's name the same way the app does --
    // open the booking modal once and read the locked Sales Agent field.
    await searchAndAdd(page, "test_dp");
    const row = page.locator(".row", { hasText: "test_dp" }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    for (let i = 0; i < 10; i++) {
      const label = await page.locator(".cal-month").innerText();
      if (label.includes("May") && label.includes("2027")) break;
      await page.getByLabel("Next month").click();
      await page.waitForTimeout(150);
    }
    await page
      .locator(".tab")
      .filter({ has: page.locator("strong", { hasText: /^8$/ }) })
      .first()
      .click();
    await page.waitForTimeout(500);

    const freeCell = row.locator("td.cell.cell-free").first();
    await freeCell.dblclick();
    await expect(page.getByText("Create Tentative Slot Booking")).toBeVisible();
    await expect
      .poll(
        async () => (await page.locator("#salesAgent").inputValue()).length,
        {
          timeout: 10_000,
        },
      )
      .toBeGreaterThan(0);
    const currentUserName = await page.locator("#salesAgent").inputValue();
    await page.getByRole("button", { name: "Cancel" }).click();

    const { error } = await sb.from("Schedule").insert([
      {
        instructor_id: TEST_DP_ID,
        date: SEED_DATE,
        start_time: "10:00:00",
        end_time: "11:00:00",
        status: "hold",
        isTentative: true,
        tentative_details: {
          name: OWN_MARKER,
          phone: "9123450020",
          sales_agent: currentUserName,
          payment_status: "unpaid",
          address: "owned addr",
          course: "demo",
          created_at: new Date().toISOString(),
        },
        learner_id: null,
        course_id: null,
        lesson_id: null,
      },
      {
        instructor_id: TEST_DP_ID,
        date: SEED_DATE,
        start_time: "13:00:00",
        end_time: "14:00:00",
        status: "hold",
        isTentative: true,
        tentative_details: {
          name: OTHER_MARKER,
          phone: "9123450021",
          sales_agent: "Someone Else Entirely",
          payment_status: "unpaid",
          address: "other addr",
          course: "demo",
          created_at: new Date().toISOString(),
        },
        learner_id: null,
        course_id: null,
        lesson_id: null,
      },
    ]);
    expect(error).toBeNull();

    await page.reload();
    await page.waitForSelector(".sales-dashboard-root", { timeout: 15_000 });
    await page.waitForTimeout(1000);
    for (let i = 0; i < 10; i++) {
      const label = await page.locator(".cal-month").innerText();
      if (label.includes("May") && label.includes("2027")) break;
      await page.getByLabel("Next month").click();
      await page.waitForTimeout(150);
    }
    await page
      .locator(".tab")
      .filter({ has: page.locator("strong", { hasText: /^8$/ }) })
      .first()
      .click();
    await page.waitForTimeout(500);
    const row2 = page.locator(".row", { hasText: "test_dp" }).first();

    const timeLabels = await page
      .locator("thead th.col-time-h")
      .allInnerTexts();
    const idx10 = timeLabels.findIndex((t) => t.includes("10:00"));
    const idx13 = timeLabels.findIndex((t) => t.includes("13:00"));

    await row2.locator("td.cell").nth(idx10).hover();
    await expect(
      page.locator(".slot-pop").getByRole("button", { name: "Delete Slot" }),
    ).toBeVisible();

    await row2.locator("td.cell").nth(idx13).hover();
    await expect(
      page.locator(".slot-pop").getByRole("button", { name: "Delete Slot" }),
    ).toHaveCount(0);
    await expect(page.locator(".slot-pop")).toContainText(
      "Someone Else Entirely",
    );

    // Deleting the owned slot uses an in-app confirm dialog, not the
    // browser's native window.confirm() -- a "dialog" event firing here
    // would mean the old native prompt is still in play.
    let nativeDialogFired = false;
    page.on("dialog", () => {
      nativeDialogFired = true;
    });

    await row2.locator("td.cell").nth(idx10).hover();
    await page
      .locator(".slot-pop")
      .getByRole("button", { name: "Delete Slot" })
      .click();
    const confirmDialog = page.getByRole("alertdialog", {
      name: "Delete tentative slot",
    });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText(OWN_MARKER);
    expect(nativeDialogFired).toBe(false);

    // Cancel dismisses without deleting.
    await confirmDialog
      .locator(".confirm-actions")
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(confirmDialog).not.toBeVisible();
    const { data: stillThere } = await sb
      .from("Schedule")
      .select("id")
      .eq("instructor_id", TEST_DP_ID)
      .eq("date", SEED_DATE)
      .eq("start_time", "10:00:00");
    expect(stillThere?.length).toBe(1);

    // Confirming actually deletes it.
    await row2.locator("td.cell").nth(idx10).hover();
    await page
      .locator(".slot-pop")
      .getByRole("button", { name: "Delete Slot" })
      .click();
    await confirmDialog
      .locator(".confirm-actions")
      .getByRole("button", { name: "Delete Slot" })
      .click();
    await expect(page.getByText("Tentative slot deleted.")).toBeVisible({
      timeout: 10_000,
    });
    const { data: afterDelete } = await sb
      .from("Schedule")
      .select("id")
      .eq("instructor_id", TEST_DP_ID)
      .eq("date", SEED_DATE)
      .eq("start_time", "10:00:00");
    expect(afterDelete?.length).toBe(0);
  });
});
