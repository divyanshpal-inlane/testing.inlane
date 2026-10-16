import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SB = "https://csnzgfzxnscumvjefpon.supabase.co";
const REST = SB + "/rest/v1/";
const sb = createClient(
  SB,
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzbnpnZnp4bnNjdW12amVmcG9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjMyODEyMDksImV4cCI6MjAzODg1NzIwOX0.Go70qkJn_MsIjU9QgRy1HbIUGmY-M7wmNg6MU77VaDk",
);
// Playwright runs spec FILES in parallel against one shared database, and
// realtime delivers every Schedule write to every open dashboard. test_dp is
// used heavily by the other specs, so it must never be on THIS spec's roster or
// their writes would be counted as ours. The two fixtures below are not written
// to by any other spec; test_dp is deliberately the "not on this dashboard"
// instructor (its events from other specs are exactly the irrelevant events
// that must cost nothing).
const NOT_IN_ROSTER = "34239456-159b-42a0-8184-a0e11954cfd0"; // test_dp
const MINE = "b2d0a21a-5c7a-4416-8f3d-15cffa13d800"; // test_ins_hidayat_dont_delete
const OTHER_LOADED = "377c563d-24f6-4d49-9849-6d4e243416eb"; // test-instr-latehrs_dont_delete
const NAME_MINE = "test_ins_hidayat_dont_delete";
const NAME_OTHER = "test-instr-latehrs_dont_delete";
const DATE = "2027-05-25";
const MARK = "ZZ-RESILIENCE";

const clear = () =>
  sb
    .from("Schedule")
    .delete()
    .in("instructor_id", [MINE, OTHER_LOADED, NOT_IN_ROSTER])
    .eq("date", DATE);
test.beforeEach(clear);
test.afterEach(clear);

type Req = { table: string; url: string };
function recorder(page: Page) {
  const reqs: Req[] = [];
  let lastAt = Date.now();
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(REST)) return;
    lastAt = Date.now();
    reqs.push({
      table: u.slice(REST.length).split("?")[0],
      url: decodeURIComponent(u),
    });
  });
  return {
    reqs,
    lastAt: () => lastAt,
    // Other specs share these test instructors and the live database, so wait
    // for traffic to go quiet before opening a measuring window; otherwise a
    // late event from someone else's cleanup is counted against this test.
    settle: async (quietMs = 2500, maxMs = 25_000) => {
      const start = Date.now();
      while (Date.now() - lastAt < quietMs && Date.now() - start < maxMs) {
        await page.waitForTimeout(250);
      }
    },
    clear: () => (reqs.length = 0),
    count: (table?: string) =>
      reqs.filter((r) => !table || r.table === table).length,
  };
}

async function addByName(page: Page, name: string) {
  const search = page.getByPlaceholder("Search or compare instructors…");
  await search.fill(name);
  const row = page.locator(".suggest-row", { hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row)
    .toHaveClass(/added/, { timeout: 1_500 })
    .catch(() => undefined);
  if (!((await row.getAttribute("class")) ?? "").includes("added")) {
    await row.locator(".suggest-main").click();
    await expect(row).toHaveClass(/added/, { timeout: 15_000 });
  }
  await search.fill("");
}

async function openWithRoster(page: Page) {
  await page.goto("/admin/sales-dashboard");
  await page.waitForSelector(".sales-dashboard-root", { timeout: 30_000 });
  await addByName(page, NAME_MINE);
  await addByName(page, NAME_OTHER);
  // let the first loads + realtime subscription settle
  await page.waitForTimeout(3000);
}

const holdRow = (
  instructor_id: string,
  start = "10:00:00",
  end = "11:00:00",
) => ({
  instructor_id,
  date: DATE,
  start_time: start,
  end_time: end,
  status: "hold",
  isTentative: true,
  tentative_details: {
    name: MARK,
    phone: "9123450081",
    sales_agent: "x",
    payment_status: "unpaid",
  },
  learner_id: null,
  course_id: null,
  lesson_id: null,
});

const setVisibility = (page: Page, state: "hidden" | "visible") =>
  page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => s,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

test.describe("Sales Dashboard - backend load & resilience", () => {
  test("realtime: only relevant events cost requests, and a delete refreshes only its instructor", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const rec = recorder(page);
    await openWithRoster(page);

    // An event for an instructor that is NOT on this dashboard: free.
    await rec.settle();
    rec.clear();
    const other = await sb
      .from("Schedule")
      .insert(holdRow(NOT_IN_ROSTER))
      .select("id")
      .single();
    expect(other.error).toBeNull();
    await page.waitForTimeout(4000);
    expect(
      rec.reqs.map((r) => r.table + " " + r.url.slice(0, 120)).join(" || "),
      "insert for a non-roster instructor",
    ).toBe("");

    // Deleting a row this dashboard never loaded: also free (used to refresh
    // EVERY roster instructor, because a DELETE carries no instructor_id).
    await rec.settle();
    rec.clear();
    await sb.from("Schedule").delete().eq("id", other.data!.id);
    await page.waitForTimeout(4000);
    expect(rec.count(), "delete of a row we don't show").toBe(0);

    // Insert for a loaded instructor: refreshes just that one.
    await rec.settle();
    rec.clear();
    const mine = await sb
      .from("Schedule")
      .insert(holdRow(MINE))
      .select("id")
      .single();
    expect(mine.error).toBeNull();
    await expect
      .poll(() => rec.count("Schedule"), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(2500);
    const sched = rec.reqs.filter((r) => r.table === "Schedule");
    expect(sched.length).toBe(1);
    expect(sched[0].url).toContain(MINE);
    expect(sched[0].url).not.toContain(OTHER_LOADED);

    // Wait until the dashboard has the new row in its blocks, then delete it:
    // the refresh must target only the instructor who owned the row, not the whole roster.
    await page.waitForTimeout(1000);
    await rec.settle();
    rec.clear();
    await sb.from("Schedule").delete().eq("id", mine.data!.id);
    await expect
      .poll(() => rec.count("Schedule"), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(2500);
    const afterDelete = rec.reqs.filter((r) => r.table === "Schedule");
    expect(afterDelete.length).toBe(1);
    expect(afterDelete[0].url).toContain(MINE);
    expect(
      afterDelete[0].url,
      "delete must not refresh the other instructor",
    ).not.toContain(OTHER_LOADED);
  });

  test("a hidden tab spends no requests, then catches up once when shown", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const rec = recorder(page);
    await openWithRoster(page);

    await rec.settle();
    await setVisibility(page, "hidden");
    rec.clear();
    for (const start of ["10:00:00", "12:00:00", "14:00:00"]) {
      const r = await sb
        .from("Schedule")
        .insert(
          holdRow(
            MINE,
            start,
            `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00:00`,
          ),
        );
      expect(r.error).toBeNull();
    }
    await page.waitForTimeout(5000);
    expect(rec.count(), "requests made while the tab was hidden").toBe(0);

    await setVisibility(page, "visible");
    await expect
      .poll(() => rec.count("Schedule"), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(3000);
    // three events -> one coalesced refresh
    expect(rec.count("Schedule")).toBe(1);
  });

  test("a transient Supabase failure is retried instead of showing an error", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto("/admin/sales-dashboard");
    await page.waitForSelector(".sales-dashboard-root", { timeout: 30_000 });

    // Fail the first two Schedule loads the way Supabase's proxy does.
    let failures = 0;
    await page.route(REST + "Schedule?*", async (route) => {
      if (failures < 2) {
        failures++;
        await route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "upstream connect error or disconnect/reset before headers. retried and the latest reset reason: connection timeout",
        });
        return;
      }
      await route.continue();
    });

    await addByName(page, NAME_OTHER);
    // loads successfully after the retries: a real row, and no error text
    await expect(
      page.locator(".row", { hasText: NAME_OTHER }).first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Couldn't load schedule/i)).toHaveCount(0);
    expect(failures).toBe(2);
  });

  test("a failed config fetch falls back to the cached copy instead of a dead page", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    // First visit with a healthy backend populates the cache.
    await page.goto("/admin/sales-dashboard");
    await page.waitForSelector(".sales-dashboard-root", { timeout: 30_000 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            localStorage.getItem("lane-sales-cache:v1:booking_flow") !== null,
        ),
      )
      .toBe(true);

    // Now the config endpoint is down (all retries too).
    await page.route(REST + "app_settings?*", (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "upstream connect error or disconnect/reset before headers. retried and the latest reset reason: connection timeout",
      }),
    );
    await page.reload();
    // It waits out one quick retry, then renders from the cached config.
    await expect(
      page.getByPlaceholder("Search or compare instructors…"),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Couldn't load availability/i)).toHaveCount(0);
  });

  test("a genuine (non-transient) failure is still reported, not hidden or retried forever", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto("/admin/sales-dashboard");
    await page.waitForSelector(".sales-dashboard-root", { timeout: 30_000 });
    let hits = 0;
    await page.route(REST + "Schedule?*", async (route) => {
      hits++;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42703",
          message: 'column "nope" does not exist',
        }),
      });
    });
    await addByName(page, NAME_OTHER).catch(() => undefined);
    await expect(
      page.getByText(/Couldn't load schedule|does not exist/i).first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    expect(hits, "a 400 must not be retried").toBe(1);
  });
});
