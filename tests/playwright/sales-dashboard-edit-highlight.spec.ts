import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://csnzgfzxnscumvjefpon.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzbnpnZnp4bnNjdW12amVmcG9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjMyODEyMDksImV4cCI6MjAzODg1NzIwOX0.Go70qkJn_MsIjU9QgRy1HbIUGmY-M7wmNg6MU77VaDk",
);
const DP = "34239456-159b-42a0-8184-a0e11954cfd0";
const DATE = "2027-05-21";
const clear = () =>
  sb.from("Schedule").delete().eq("instructor_id", DP).eq("date", DATE);
test.beforeEach(clear);
test.afterEach(clear);

async function open(page: Page) {
  await page.goto("/admin/sales-dashboard");
  await page.waitForSelector(".sales-dashboard-root", { timeout: 30_000 });
  const search = page.getByPlaceholder("Search or compare instructors…");
  await search.fill("test_dp");
  const sug = page.locator(".suggest-row", { hasText: "test_dp" }).first();
  await expect(sug).toBeVisible({ timeout: 10_000 });
  await expect(sug)
    .toHaveClass(/added/, { timeout: 2_000 })
    .catch(() => undefined);
  if (!((await sug.getAttribute("class")) ?? "").includes("added")) {
    await sug.locator(".suggest-main").click();
    await expect(sug).toHaveClass(/added/, { timeout: 15_000 });
  }
}
async function gotoDate(page: Page) {
  for (let i = 0; i < 14; i++) {
    const label = (await page.locator(".cal-month").innerText()).trim();
    if (label.includes("May") && label.includes("2027")) break;
    await page.getByRole("button", { name: "Next month" }).click();
    await expect
      .poll(async () => (await page.locator(".cal-month").innerText()).trim())
      .not.toBe(label);
  }
  const tab = page
    .locator(".tab")
    .filter({ has: page.locator("strong", { hasText: /^21$/ }) })
    .first();
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveClass(/\bactive\b/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

test("blue highlight covers only the picked half-hours in the week timetable", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  // Pick a day inside the week panel's current window (it starts at today).
  const tab = page
    .locator(".tab")
    .filter({ has: page.locator("strong", { hasText: /^14$/ }) })
    .first();
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveClass(/\bactive\b/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  const row = page.locator(".row", { hasText: "test_dp" }).first();
  const labels = await page.locator("thead th.col-time-h").allInnerTexts();
  const idx = labels.findIndex((t) => t.includes("15:30"));
  await expect(row.locator("td.cell")).toHaveCount(labels.length, {
    timeout: 20_000,
  });
  await row.locator("td.cell").nth(idx).click();
  await expect(page.locator("#customerName")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("td.cell.cell-pending")).toHaveCount(2);
  const halves = page.locator(".week-timetable-half-pending");
  await expect(halves).toHaveCount(2, { timeout: 10_000 });
  const boxes = await halves.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      const p = e.parentElement!.getBoundingClientRect();
      return { h: Math.round(r.height), parentH: Math.round(p.height) };
    }),
  );
  for (const bx of boxes)
    expect(Math.abs(bx.h * 2 - bx.parentH)).toBeLessThanOrEqual(2);
  // No whole-hour outline anywhere any more.
  await expect(page.locator(".week-timetable-cell-pending")).toHaveCount(0);
});

test("another agent can edit an unpaid slot (becomes half paid) and the creator is preserved", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { error } = await sb.from("Schedule").insert({
    instructor_id: DP,
    date: DATE,
    start_time: "10:00:00",
    end_time: "11:00:00",
    status: "hold",
    isTentative: true,
    tentative_details: {
      name: "ZZ-ORIG",
      phone: "9123450061",
      sales_agent: "Someone Else Entirely",
      payment_status: "unpaid",
      address: "orig addr",
      course: "demo",
      batch_id: "zz-batch-1",
    },
    learner_id: null,
    course_id: null,
    lesson_id: null,
  });
  expect(error).toBeNull();
  await open(page);
  await page.reload();
  await page.waitForSelector(".sales-dashboard-root", { timeout: 20_000 });
  await open(page);
  await gotoDate(page);
  const row = page.locator(".row", { hasText: "test_dp" }).first();
  const labels = await page.locator("thead th.col-time-h").allInnerTexts();
  const idx = labels.findIndex((t) => t.includes("10:00"));
  await expect(row.locator("td.cell")).toHaveCount(labels.length, {
    timeout: 20_000,
  });
  const cell = row.locator("td.cell").nth(idx);
  await expect(cell).toHaveClass(/cell-tentative/, { timeout: 20_000 });
  await cell.click(); // single click -> side panel
  await page.getByRole("button", { name: "Edit Booking" }).click();
  await expect(page.getByText("Edit Tentative Booking")).toBeVisible({
    timeout: 10_000,
  });
  // Creator stays the original agent, not the logged-in editor.
  await expect(page.locator("#salesAgent")).toHaveValue("Someone Else Entirely");
  await page.locator("#customerName").fill("ZZ-NEW-PAYER");
  await page.locator("#paymentStatus").selectOption("half_paid");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect
    .poll(
      async () => {
        const { data } = await sb
          .from("Schedule")
          .select("tentative_details")
          .eq("instructor_id", DP)
          .eq("date", DATE);
        const td = (data ?? [])[0]?.tentative_details as
          | Record<string, string>
          | undefined;
        return td
          ? `${td.name}|${td.payment_status}|${td.sales_agent}|${(data ?? []).length}`
          : "none";
      },
      { timeout: 15_000 },
    )
    .toBe("ZZ-NEW-PAYER|half_paid|Someone Else Entirely|1");
});
