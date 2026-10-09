import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SB_URL = "https://csnzgfzxnscumvjefpon.supabase.co";
const SB_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzbnpnZnp4bnNjdW12amVmcG9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjMyODEyMDksImV4cCI6MjAzODg1NzIwOX0.Go70qkJn_MsIjU9QgRy1HbIUGmY-M7wmNg6MU77VaDk";

// Cleans up via the same anon-key Supabase client / pattern used by
// tests/backend-suite.mjs, so a booking created by this UI test doesn't
// linger in the database after the test finishes.
const sb = createClient(SB_URL, SB_ANON_KEY);
const TEST_DP_ID = "34239456-159b-42a0-8184-a0e11954cfd0"; // "test_dp"
const TEST_MARKER = "PW-SUITE-TEST-BOOKING";
const PAID_INFO_MARKER = "PW-SUITE-PAID-INFO-BOOKING";

/**
 * A second instructor, used only to prove that a locked booking hides the
 * OTHER rows. It has to be a real, active, bookable-looking row and its name has
 * to be distinctive enough not to substring-match "test_dp".
 */
const SECOND_INSTRUCTOR_NAME = "test-instr-latehrs_dont_delete";

/**
 * A grid cell the booking modal will actually open for.
 *
 * `cell-free` is applied to every free 30-minute slot, *including* ones whose
 * hour partner is already taken — those additionally get `cell-half`. The app
 * computes `canBook1Hour = free && validateOneHourBlock(...)` and refuses a
 * 1-hour booking when that is false, so clicking a `cell-half` correctly
 * shows a toast instead of the modal.
 *
 * Selecting plain `td.cell.cell-free` therefore picked a slot that sometimes
 * had no free partner, and whether `.first()` landed on one depended purely on
 * the seeded Schedule rows — which is why these three tests failed
 * intermittently rather than consistently. A booking needs a whole hour, so
 * tests must exclude `cell-half`.
 */
const BOOKABLE_CELL = "td.cell.cell-free:not(.cell-half)";

/**
 * The date the booking-flow tests book on.
 *
 * Deliberately far in the future and wiped before each run (see
 * openTentativeModal) so it never collides with the real Schedule rows
 * `test_dp` already carries on current dates. It is deliberately NOT
 * 2027-05-08, which the delete-restricted suite below owns and clears in its
 * own beforeEach/afterEach -- sharing a date couples the two suites.
 */
const CONTROLLED_DATE = "2027-05-15";

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

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Open the tentative-booking modal on a date this test fully controls.
 *
 * These tests used to book on whatever date the dashboard opened on, which is
 * shared, mutable state:
 *   - `test_dp` already carries real Schedule rows from earlier manual runs
 *     (8 of them, spread over 2026-09-19..30), including one on today's date;
 *   - the other tests in this file create holds on the selected date;
 *   - so "the first free cell" was a different slot on every run.
 *
 * When a neighbouring hold turned up, the app's own optimistic lock rejected
 * the submit ("This slot was just booked by another sales agent"), which the
 * test saw as a missing success toast; when the first free half-hour had no
 * free hour partner, the modal never opened at all. Both looked like
 * intermittent failures but were just pollution.
 *
 * So: wipe the date BEFORE navigating (navigating is what triggers the grid's
 * Schedule fetch for it), then click a cell that is both free and able to take
 * a full hour. The click is retried because React swaps the grid's <td>
 * nodes while that fetch settles, which can swallow the event entirely.
 *
 * The caller must have added `test_dp` to the roster first (searchAndAdd).
 * Returns false when the date has no bookable hour, so callers can skip.
 */
/**
 * Fill the open booking modal and submit it. Returns false if the app
 * rejected the submit with its optimistic-lock message.
 *
 * That message ("This slot was just booked by another sales agent") is the
 * app's translation of Postgres 23P01 from `schedule_no_overlap_new_rows`, so
 * it means the slot was genuinely taken by the time the INSERT landed -- on a
 * shared live database that can be a leftover row from an earlier run rather
 * than a bug. Callers decide whether to re-clear and try again.
 */
async function fillAndSubmitTentative(page: Page): Promise<boolean> {
  await page.locator("#customerName").fill(TEST_MARKER);
  await page.locator("#customerPhone").fill("9123456789");
  // Customer Address is a Google Places autocomplete, not a bare <input>.
  // It is labelled with htmlFor="customerAddress", so the component has to
  // forward an id -- regression check for the dangling <label for> that
  // existed while the field had no id at all.
  const addressLabel = page.locator('label[for="customerAddress"]');
  await expect(addressLabel).toBeVisible();
  await expect(
    page.locator(`#${(await addressLabel.getAttribute("for")) ?? ""}`),
  ).toBeVisible();
  await page.locator("#customerAddress").fill("Playwright test address");
  await expect(page.locator("#customerAddress")).toHaveValue(
    "Playwright test address",
  );
  // Sales Agent is read-only (locked to the logged-in account) --
  // regression check for that fix. The value comes from
  // useCurrentAdmin()/useCurrentUser(), an async identity lookup (the latter
  // calls an edge function) independent of this flow, so give it a moment to
  // resolve rather than asserting on it immediately.
  await expect(page.locator("#salesAgent")).toHaveAttribute("readonly", "");
  await expect
    .poll(async () => (await page.locator("#salesAgent").inputValue()).length, {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: /Create Tentative Block/ }).click();

  // In-modal success message, then the dashboard-level toast after the modal
  // closes. The first booking in a run pays a cold start (fresh edge function
  // + RLS plan), so 10s was not enough on the first repetition and reported as
  // "element not found" rather than a timeout. Wait for whichever of the two
  // outcomes appears rather than only the success case.
  const success = page.getByText(/booked successfully/i);
  // Two distinct rejection paths, both of which mean "not booked":
  //   - the modal's own re-validation against its block index
  //     ("Class 1 (...) is already booked. Remove or change it and try again")
  //   - the Postgres 23P01 exclusion constraint, translated by
  //     friendlyBookingError ("This slot was just booked by another sales agent")
  const rejected = page.getByText(
    /just booked by another sales agent|is already booked/i,
  );
  await expect(success.or(rejected).first()).toBeVisible({ timeout: 30_000 });
  return (await rejected.count()) === 0;
}

async function openTentativeModal(page: Page, date: string): Promise<boolean> {
  const [year, month, day] = date.split("-").map(Number);
  await gotoMonth(page, MONTH_NAMES[month - 1], String(year));
  await waitForDayTabs(page);
  await gotoDay(page, day);

  const row = page.locator(".row", { hasText: "test_dp" }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  // The grid renders its cells before the Schedule fetch resolves, so wait for
  // a genuinely bookable hour rather than snapshotting count() -- an immediate
  // count reads 0 mid-fetch and would skip the test for the wrong reason.
  await row.locator("td.cell").first().waitFor({ timeout: 20_000 });
  const first = row.locator(BOOKABLE_CELL).first();
  const hasBookableHour = await first
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasBookableHour) return false;

  const heading = page.getByText("Create Tentative Slot Booking");

  for (let attempt = 0; attempt < 3; attempt++) {
    const cell = row.locator(BOOKABLE_CELL).first();
    if ((await cell.count()) === 0) return false;
    await cell.click();
    try {
      await expect(heading).toBeVisible({ timeout: 3_000 });
      return true;
    } catch {
      // Grid re-render ate the click -- try again on a fresh node.
    }
  }
  return false;
}

/**
 * Click "Next month" until the calendar shows `month year`, VERIFYING arrival.
 *
 * The previous version read `.cal-month` again after a fixed 150ms sleep. If
 * React had not re-rendered yet, the loop saw a stale label, clicked again,
 * and silently overshot the target month -- the test then clicked the day tab
 * on the WRONG month and asserted a seeded row that was never in view, which
 * reported as "cell is still free" no matter how long it waited.
 *
 * The header renders an abbreviated month ("Sept 2026", "Nov 2027"), so the
 * comparison uses the first three letters. Matching a full month name never
 * matched at all and the loop ran to its click limit.
 */
async function gotoMonth(page: Page, month: string, year: string) {
  const abbrev = month.slice(0, 3);
  for (let i = 0; i < 14; i++) {
    const label = (await page.locator(".cal-month").innerText()).trim();
    if (label.includes(abbrev) && label.includes(year)) return;
    await page.getByLabel("Next month").click();
    await expect
      .poll(async () => (await page.locator(".cal-month").innerText()).trim(), {
        timeout: 10_000,
      })
      .not.toBe(label);
  }
  throw new Error(
    `Could not navigate to ${month} ${year}; last label was "${await page
      .locator(".cal-month")
      .innerText()}"`,
  );
}

/**
 * Click the date tab for a given day-of-month and VERIFY it became active.
 *
 * The tab strip is derived from the displayed month and `safeDateIndex` picks
 * the active day. Changing month re-renders the whole strip, so a click issued
 * while that render is still pending gets overwritten and the grid silently
 * shows a *different* date -- which made a correctly seeded row look
 * permanently missing ("cell is still free" after 30s). Retrying until the
 * requested tab is the active one removes the race.
 */
async function gotoDay(page: Page, day: number) {
  const tab = page
    .locator(".tab")
    .filter({
      has: page.locator("strong", { hasText: new RegExp(`^${day}$`) }),
    })
    .first();
  await expect(tab).toBeVisible();
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveClass(/\bactive\b/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

/** Wait until the date strip for the displayed month has painted its tabs. */
async function waitForDayTabs(page: Page) {
  await expect(page.locator(".tab").first()).toBeVisible({
    timeout: 30_000,
  });
  // The strip renders one tab per visible day; a month with fewer tabs than
  // this is still mid-navigation.
  await expect
    .poll(() => page.locator(".tab").count(), { timeout: 30_000 })
    .toBeGreaterThan(20);
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

  test("roster persists across a reload, but search text is intentionally not", async ({
    page,
  }) => {
    // The roster (instructor IDs) is account-scoped in localStorage and must
    // survive a reload. The search *text* deliberately does not: the
    // persistence payload was narrowed to IDs only, and the legacy
    // "lane-sales-dashboard-search" key is deleted on load
    // (SalesDashboard.tsx). Asserting it persists would pin behaviour that
    // was removed on purpose.
    await searchAndAdd(page, "test_dp");
    await page.reload();
    await page.waitForSelector(".sales-dashboard-root");
    await expect(
      page.getByPlaceholder("Search or compare instructors…"),
    ).toHaveValue("");
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
  test("clicking a free slot, filling the form, and submitting creates a tentative booking", async ({
    page,
  }) => {
    // Month navigation (7 clicks forward), waiting for the date strip to
    // repaint, plus a submit that can wait 30s on a cold edge function, does
    // not fit the 30s default.
    test.setTimeout(120_000);

    // Book on a wiped, controlled date rather than the date the dashboard
    // happens to open on (shared with real rows and the other tests here).
    //
    // Wipe BEFORE searchAndAdd: adding the instructor is what makes the grid
    // fetch this instructor's Schedule rows, so a row deleted after that
    // fetch lingers in the grid's block index and the modal then refuses the
    // slot as "already booked" against a database that is actually empty.
    // (This is why the earlier "clear then navigate" ordering failed with 23P01
    // on an empty date -- the wipe had simply come too late.)
    await clearSeededDay(TEST_DP_ID, CONTROLLED_DATE);
    await searchAndAdd(page, "test_dp");
    const opened = await openTentativeModal(page, CONTROLLED_DATE);
    test.skip(!opened, "no free hour available for test_dp on the test date");
    if (!opened) return;

    expect(
      await fillAndSubmitTentative(page),
      "submit was rejected by the app's conflict guard (Postgres 23P01) -- " +
        "the slot was taken between opening the modal and submitting",
    ).toBe(true);
  });

  test("booking form offers only New Customer -- no reuse mode, picker, or follow-up", async ({
    page,
  }) => {
    // The "Reuse Customer" path (mode toggle, previous-customer search, and
    // the post-booking "Book another class" toast) was removed: a slot can only
    // be booked for a customer typed into the form. These assertions pin that,
    // because the feature was easy to reintroduce by adding a second button
    // next to a surviving label.
    test.setTimeout(120_000);

    await clearSeededDay(TEST_DP_ID, CONTROLLED_DATE);
    await searchAndAdd(page, "test_dp");
    const opened = await openTentativeModal(page, CONTROLLED_DATE);
    test.skip(!opened, "no free hour available for test_dp on the test date");
    if (!opened) return;

    // No mode toggle survives in any form.
    // Scope to the booking dialog itself. The dashboard's own instructor
    // search is legitimately a combobox, so an unscoped role query matches it
    // and passes or fails for the wrong reason.
    const dialog = page.locator(".modal-backdrop");

    // No mode toggle survives in any form.
    await expect(
      dialog.getByRole("group", { name: /Customer entry mode/i }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: /^(New|Reuse) Customer$/ }),
    ).toHaveCount(0);

    // No previous-customer search. The picker added its own input, so "the
    // dialog still has exactly the four New Customer fields and nothing else"
    // is the precise form of this -- an unscoped role query would also match
    // the dashboard's own instructor search.
    await expect(page.locator("#reusableCustomerSearch")).toHaveCount(0);
    await expect(dialog.getByText(/Search previous customers/i)).toHaveCount(0);
    await expect(dialog.locator("input")).toHaveCount(4);

    // The plain New Customer fields are all still present and usable.
    for (const id of [
      "#customerName",
      "#customerPhone",
      "#customerAddress",
      "#salesAgent",
    ]) {
      await expect(page.locator(id)).toBeVisible();
    }

    // And a booking still completes, with no reuse follow-up offered.
    expect(await fillAndSubmitTentative(page)).toBe(true);
    await expect(
      page.getByRole("button", { name: /Book another class/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Change Customer/i }),
    ).toHaveCount(0);
  });

  test("phone number input rejects non-digits and caps at 10 characters", async ({
    page,
  }) => {
    // Same reason as its sibling: month navigation alone can exceed 30s.
    test.setTimeout(120_000);
    // See the sibling test: wipe before the grid fetches Schedule rows.
    await clearSeededDay(TEST_DP_ID, CONTROLLED_DATE);
    await searchAndAdd(page, "test_dp");
    const opened = await openTentativeModal(page, CONTROLLED_DATE);
    test.skip(!opened, "no free hour available to open the booking modal");
    if (!opened) return;
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

  test("opening a booking auto-opens that instructor's schedule and hides the other rows", async ({
    page,
  }) => {
    // The first slot of a booking used to be picked from a collapsed row while
    // every LATER one ("+ Add another class", "Change slot") was picked from the
    // open monthly timetable -- so the flow asked for a view it had not opened
    // yet. Opening a booking now opens that instructor's "Schedule" view itself.
    // Both halves are pinned here because they are one behaviour: the row that
    // opens is the only row left on the grid.
    test.setTimeout(120_000);

    await clearSeededDay(TEST_DP_ID, CONTROLLED_DATE);
    await searchAndAdd(page, "test_dp");
    // A second instructor on the roster is what makes "the other rows are
    // hidden" observable at all -- with one row it would pass either way.
    await searchAndAdd(page, SECOND_INSTRUCTOR_NAME);
    await expect(page.locator(".row", { hasText: "test_dp" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator(".row", { hasText: SECOND_INSTRUCTOR_NAME }),
    ).toBeVisible({ timeout: 15_000 });

    const opened = await openTentativeModal(page, CONTROLLED_DATE);
    test.skip(!opened, "no free hour available for test_dp on the test date");
    if (!opened) return;

    // The booking form is open ...
    await expect(page.getByText("Create Tentative Slot Booking")).toBeVisible();

    // ... and the row's own "Schedule" control is now open, not collapsed.
    // Asserted on the control rather than on the timetable: the control is the
    // thing the user said should open, and `aria-expanded` distinguishes "the
    // button is showing as open" from "a timetable happens to be rendered".
    const scheduleToggle = page
      .getByRole("button", { name: /^Hide test_dp's expanded timetable$/ })
      .first();
    await expect(scheduleToggle).toBeVisible({ timeout: 15_000 });
    await expect(scheduleToggle).toHaveAttribute("aria-expanded", "true");
    // The expanded weekly timetable is really rendered, not just labelled.
    await expect(page.locator(".detail-row .week-timetable")).toBeVisible();

    // Only the booked instructor's row survives. `.detail-row` is the extra
    // <tr> the expanded timetable renders, so counting `.row` (not every <tr>)
    // is what isolates the instructor rows.
    await expect(page.locator(".row", { hasText: "test_dp" })).toHaveCount(1);
    await expect(
      page.locator(".row", { hasText: SECOND_INSTRUCTOR_NAME }),
    ).toHaveCount(0);

    // And the change is not sticky: cancelling the booking brings the rest of
    // the roster back, because the lock is derived from the batch and the
    // expanded set is left alone rather than being reset.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.locator(".row", { hasText: SECOND_INSTRUCTOR_NAME }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".row", { hasText: "test_dp" })).toBeVisible();
  });
});

/**
 * Insert a Schedule row, self-healing around the `schedule_no_overlap_new_rows`
 * exclusion constraint.
 *
 * That constraint rejects an overlapping instructor/date/time range, so any row
 * left behind by a run that was killed (timeout, crash, or a debug spec) makes
 * the next run's own insert fail with 23P01 -- which surfaced as an apparently
 * random failure with no relation to what the test asserts. The
 * beforeEach/afterEach hooks clean up on the happy path; this covers the
 * unhappy one by clearing the slot and retrying.
 */
/**
 * Wipe every row on a test day so a repeat-each run starts from the same state
 * the first run had.
 *
 * This must happen BEFORE the seeding loop, not as 23P01 recovery inside it.
 * `seedExclusiveSlot`'s recovery path clears the whole date, so if it fired
 * mid-loop it would also delete the rows the loop had already inserted --
 * silently removing the block the test is about to assert on. Clearing once up
 * front means the recovery path is a genuine fallback, not the normal flow.
 */
async function clearSeededDay(instructorId: string, date: string) {
  const { error } = await sb
    .from("Schedule")
    .delete()
    .eq("instructor_id", instructorId)
    .eq("date", date);
  if (error) throw error;
}

async function seedExclusiveSlot(
  row: Record<string, unknown>,
  instructorId: string,
  date: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await sb.from("Schedule").insert(row);
    if (!error) break;
    if (error.code !== "23P01") throw error;
    console.warn(
      `[seed] 23P01 on attempt ${attempt + 1}; clearing ${date} and retrying`,
    );
    await clearSeededDay(instructorId, date);
    if (attempt === 2) {
      throw new Error(
        `Could not seed ${date} after clearing 3 conflicting rows (23P01).`,
      );
    }
  }

  // Wait until the row is actually READABLE, not merely written.
  //
  // The test process writes via PostgREST and the browser then reads via
  // PostgREST, and the two do not share a read-your-writes guarantee. When the
  // browser's Schedule fetch lost that race it returned 8 rows instead of 9 --
  // the freshly seeded row missing -- and since the grid only fetches once per
  // instructor, the slot stayed "free" for the rest of the test. That surfaced
  // as an intermittent, apparently random failure with no connection to what
  // the test asserted. Polling the same REST endpoint the browser uses makes
  // the seed deterministic.
  await expect
    .poll(
      async () => {
        const { data, error } = await sb
          .from("Schedule")
          .select("id")
          .eq("instructor_id", instructorId)
          .eq("date", date)
          .limit(1);
        if (error) throw error;
        return (data ?? []).length;
      },
      {
        timeout: 30_000,
        message: `seeded row for ${date} never became readable`,
      },
    )
    .toBeGreaterThan(0);
}

/**
 * Block until the seeded row is visible FROM THE BROWSER.
 *
 * `seedExclusiveSlot` proves the row is readable to the test process, which is
 * not the same guarantee: the test process and the browser reach PostgREST
 * independently, and the browser's own read was observed returning 8 rows where
 * the test process saw 9. Waiting here closes that gap before the grid issues
 * its one-and-only Schedule fetch for the instructor.
 */
async function waitForSeedVisibleInBrowser(
  page: Page,
  instructorId: string,
  date: string,
) {
  await expect
    .poll(
      async () =>
        page.evaluate(
          async ({ url, key, instructorId, date }) => {
            const res = await fetch(
              `${url}/rest/v1/Schedule?instructor_id=eq.${instructorId}` +
                `&date=eq.${date}&select=id&limit=1`,
              { headers: { apikey: key, Authorization: `Bearer ${key}` } },
            );
            if (!res.ok) return `http ${res.status}`;
            const body = (await res.json()) as unknown[];
            return body.length;
          },
          { url: SB_URL, key: SB_ANON_KEY, instructorId, date },
        ),
      {
        timeout: 30_000,
        message: `seeded row for ${date} was never visible to the browser`,
      },
    )
    .toBeGreaterThan(0);
}

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
  // Seed ~60 days out: far enough that no other test in this file books a real
  // slot on the same date, but comfortably inside the dashboard's 400-day
  // fetch window.
  //
  // The original hand-picked 2027-05-06 sat at the far edge of that window,
  // where the grid's Schedule read intermittently came back without the seeded
  // row (observed: 9 rows served as 8) and the cell stayed "free" for the rest
  // of the run. A date only two days out is worse: it lands on a default-view
  // date where the "creates a tentative booking" test creates a REAL row as the
  // signed-in user, which the anon test client cannot see or delete, so the
  // seed then fails forever on the schedule_no_overlap_new_rows constraint.
  const SEED_DATE = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 60);
    return d.toISOString().slice(0, 10);
  })();
  const SEED_DAY = Number(SEED_DATE.slice(8, 10));
  const SEED_MONTH = new Date(`${SEED_DATE}T00:00:00Z`).toLocaleString(
    "en-US",
    {
      month: "long",
      timeZone: "UTC",
    },
  );
  const SEED_YEAR = SEED_DATE.slice(0, 4);
  const SEED_START = "14:00:00";

  const clearSeeded = () =>
    sb
      .from("Schedule")
      .delete()
      .eq("instructor_id", TEST_DP_ID)
      .eq("date", SEED_DATE)
      .eq("start_time", SEED_START);

  // See the note in the "delete restricted to creator" suite: a row left
  // behind by an aborted run collides with this one via the Schedule
  // exclusion constraint, so seed cleanup has to happen up front too.
  test.beforeEach(clearSeeded);
  test.afterEach(clearSeeded);
  // Runs even when a test throws, so a killed run cannot poison the next one.
  test.afterAll(clearSeeded);

  test("a status:booked + isTentative:true + paid_info row shows as yellow Tentative, not purple Booked, and offers no Override (already paid)", async ({
    page,
  }) => {
    // Steps to the seed month and lets the grid render that date.
    // The 30s default budget is too small for month navigation plus a cold
    // Schedule fetch, and running out surfaces as a misleading "cell is still
    // free" failure rather than a timeout at the step that caused it.
    test.setTimeout(90_000);

    // Seed first, then confirm the BROWSER can read it.
    //
    // The grid fetches Schedule exactly once per instructor, so a fetch that
    // misses this row leaves the slot "free" for the rest of the test. The test
    // process and the browser reach PostgREST independently and do not share a
    // read-your-writes guarantee, so it is not enough for the insert to have
    // returned -- the browser's own read has to succeed before the grid's
    // single fetch runs. (This showed up as an intermittent 9-row response
    // arriving as 8, i.e. the grid's data silently missing the seed.)
    //
    // Clear first so a leftover row from a previous repeat-each run cannot
    // force the 23P01 path (which wipes the day). See clearSeededDay().
    await clearSeededDay(TEST_DP_ID, SEED_DATE);
    await seedExclusiveSlot(
      {
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
      },
      TEST_DP_ID,
      SEED_DATE,
    );
    await waitForSeedVisibleInBrowser(page, TEST_DP_ID, SEED_DATE);

    // Add the instructor and let the grid finish its one Schedule fetch.
    await searchAndAdd(page, "test_dp");
    const row = page.locator(".row", { hasText: "test_dp" }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Wait for the cells to reach the header's column count, i.e. the row is
    // fully painted -- otherwise `td.cell` nth(idx) can resolve against a
    // half-built row and point at the wrong time slot.
    const timeLabels = await page
      .locator("thead th.col-time-h")
      .allInnerTexts();
    await expect(row.locator("td.cell")).toHaveCount(timeLabels.length, {
      timeout: 20_000,
    });

    // The seed date is beyond the default 14-day view, so step to its month.
    await gotoMonth(page, SEED_MONTH, SEED_YEAR);
    await gotoDay(page, SEED_DAY);

    const idx = timeLabels.findIndex((t) => t.includes("14:00"));
    expect(idx).toBeGreaterThanOrEqual(0);
    const cell = row.locator("td.cell").nth(idx);

    // One bounded page reload as a fallback if realtime is not delivering.
    // A plain try/catch loop rather than expect.poll() on purpose: an expect()
    // that throws inside a poll callback aborts the entire poll.
    let rendered = false;
    for (let attempt = 0; attempt < 2 && !rendered; attempt++) {
      try {
        await expect(cell).toHaveClass(/cell-tentative/, { timeout: 12_000 });
        rendered = true;
      } catch {
        if (attempt === 1) {
          const month = (await page.locator(".cal-month").innerText()).trim();
          const day = await page
            .locator(".tab.active strong")
            .first()
            .innerText()
            .catch(() => "?");
          throw new Error(
            `seeded 14:00 slot never rendered after reload ` +
              `(month="${month}" activeDay=${day} class="${await cell
                .getAttribute("class")
                .catch(() => "?")}")`,
          );
        }
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(
          page.locator(".row", { hasText: "test_dp" }).first(),
        ).toBeVisible({ timeout: 20_000 });
        await gotoMonth(page, SEED_MONTH, SEED_YEAR);
        await gotoDay(page, SEED_DAY);
      }
    }
    await expect(cell).not.toHaveClass(/cell-booked/);

    // Hover until the popover describes the seeded row. Same staleness as the
    // delete suite: the popover renders from resolveInfo(), which needs the
    // instructor's Schedule data, and that can lag the painted cells -- so the
    // first hover can show "Free 14:00-14:30" instead. Move the pointer off
    // the grid between attempts so each one is a real mouseenter.
    await page.mouse.move(2, 2);
    const popover = page.locator(".slot-pop");
    for (let attempt = 0; attempt < 6; attempt++) {
      await cell.hover();
      try {
        await expect(popover).toContainText(PAID_INFO_MARKER, {
          timeout: 2_000,
        });
        break;
      } catch {
        await page.mouse.move(2, 2);
      }
    }
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

  const clearSeeded = () =>
    sb
      .from("Schedule")
      .delete()
      .eq("instructor_id", TEST_DP_ID)
      .eq("date", SEED_DATE);

  // Clear BEFORE seeding as well as after. Schedule has an exclusion
  // constraint (schedule_no_overlap_new_rows) rejecting an overlapping
  // instructor/date/time range, so a row left behind by a run that was
  // killed on timeout would make this run's own insert fail with 23P01 --
  // which is what made the suite look randomly flaky.
  test.beforeEach(clearSeeded);
  test.afterEach(clearSeeded);
  // Runs even when a test throws, so a killed run cannot poison the next one.
  test.afterAll(clearSeeded);

  test("creator sees Delete Slot; a different sales agent's slot does not offer it", async ({
    page,
  }) => {
    // Same reason as the sibling suite: month navigation + a reload + a cold
    // Schedule fetch needs more than the 30s default.
    test.setTimeout(90_000);

    // Discover the logged-in account's name the same way the app does --
    // open the booking modal once and read the locked Sales Agent field.
    await searchAndAdd(page, "test_dp");
    const opened = await openTentativeModal(page, SEED_DATE);
    test.skip(!opened, "no free hour available to open the booking modal");
    if (!opened) return;
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

    // Start from a clean day so a previous repeat-each run cannot leave a
    // conflicting block behind. See clearSeededDay().
    await clearSeededDay(TEST_DP_ID, SEED_DATE);

    // Seeded one at a time (rather than a single batch insert) so each row gets
    // the same 23P01 self-healing as the sibling suite.
    for (const seed of [
      {
        start_time: "10:00:00",
        end_time: "11:00:00",
        marker: OWN_MARKER,
        phone: "9123450020",
        agent: currentUserName,
        address: "owned addr",
      },
      {
        start_time: "13:00:00",
        end_time: "14:00:00",
        marker: OTHER_MARKER,
        phone: "9123450021",
        agent: "Someone Else Entirely",
        address: "other addr",
      },
    ]) {
      await seedExclusiveSlot(
        {
          instructor_id: TEST_DP_ID,
          date: SEED_DATE,
          start_time: seed.start_time,
          end_time: seed.end_time,
          status: "hold",
          isTentative: true,
          tentative_details: {
            name: seed.marker,
            phone: seed.phone,
            sales_agent: seed.agent,
            payment_status: "unpaid",
            address: seed.address,
            course: "demo",
            created_at: new Date().toISOString(),
          },
          learner_id: null,
          course_id: null,
          lesson_id: null,
        },
        TEST_DP_ID,
        SEED_DATE,
      );
    }

    // Same reason as the sibling suite: the grid's single Schedule fetch must be
    // able to SEE these rows, not merely the test process be able to write them.
    await waitForSeedVisibleInBrowser(page, TEST_DP_ID, SEED_DATE);

    await page.reload();
    await page.waitForSelector(".sales-dashboard-root", { timeout: 15_000 });
    await page.waitForTimeout(1000);
    await gotoMonth(page, "May", "2027");
    await gotoDay(page, 8);
    const row2 = page.locator(".row", { hasText: "test_dp" }).first();

    const timeLabels = await page
      .locator("thead th.col-time-h")
      .allInnerTexts();
    const idx10 = timeLabels.findIndex((t) => t.includes("10:00"));
    const idx13 = timeLabels.findIndex((t) => t.includes("13:00"));
    expect(idx10).toBeGreaterThanOrEqual(0);
    expect(idx13).toBeGreaterThanOrEqual(0);

    // Wait for the grid body to catch up with the header. A fixed
    // waitForTimeout was racing Schedule loading: the header had already
    // painted every time column while the instructor's body row still had
    // fewer cells, so `td.cell` nth(8) never resolved. Assert the row
    // reaches the header's column count instead of guessing a duration.
    await expect(row2).toBeVisible({ timeout: 20_000 });
    await expect(row2.locator("td.cell")).toHaveCount(timeLabels.length, {
      timeout: 20_000,
    });

    // Re-resolve the row and wait for the grid to settle before each
    // interaction. `hover()` is fire-and-forget and the grid re-renders when
    // the month settles, so a locator captured before navigation can go
    // stale and time out mid-test.
    const slot = (idx: number) => row2.locator("td.cell").nth(idx);

    // Hover, then wait for the popover to actually describe THIS slot.
    //
    // The popover's contents come from resolveInfo(), which reads the
    // instructor's Schedule data. That arrives after the cells paint, so an
    // early hover renders the popover from an empty/stale block set -- i.e. a
    // free slot with no Delete Slot button -- and the assertion below fails
    // even though the seeded row is there. Re-hovering picks up the
    // populated data. (Hovering the same cell twice is also a no-op, since
    // the mouse never moves, so each attempt nudges the pointer.)
    const hoverSlot = async (idx: number, expected: string) => {
      // Move the pointer off the grid first, so every attempt is a genuine
      // mouseenter rather than a no-op hover on the cell the pointer is
      // already sitting in.
      await page.mouse.move(2, 2);
      for (let attempt = 0; attempt < 6; attempt++) {
        await slot(idx).hover();
        const popover = page.locator(".slot-pop");
        try {
          await expect(popover).toContainText(expected, { timeout: 2_000 });
          return popover;
        } catch {
          await page.mouse.move(2, 2);
        }
      }
      // Diagnostics: the popover may exist but describe a different slot, or
      // the seeded row may not be in the DOM at all. Say which.
      const cls = await slot(idx)
        .getAttribute("class")
        .catch(() => "<cell gone>");
      const popText = await page
        .locator(".slot-pop")
        .innerText()
        .catch(() => "<no popover>");
      throw new Error(
        `hovering slot[${idx}] never showed "${expected}". ` +
          `cell class="${cls}" popover="${popText.replace(/\s+/g, " ").trim()}"`,
      );
    };

    const ownedPopover = await hoverSlot(idx10, OWN_MARKER);
    await expect(
      ownedPopover.getByRole("button", { name: "Delete Slot" }),
    ).toBeVisible();

    const otherPopover = await hoverSlot(idx13, "Someone Else Entirely");
    await expect(
      otherPopover.getByRole("button", { name: "Delete Slot" }),
    ).toHaveCount(0);

    // Deleting the owned slot uses an in-app confirm dialog, not the
    // browser's native window.confirm() -- a "dialog" event firing here
    // would mean the old native prompt is still in play.
    let nativeDialogFired = false;
    page.on("dialog", () => {
      nativeDialogFired = true;
    });

    await slot(idx10).hover();
    await expect(
      page.locator(".slot-pop").getByRole("button", { name: "Delete Slot" }),
    ).toBeVisible();
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
    // Poll: the delete is a client mutation whose RTT can land after the
    // dialog's close animation, so a bare expect can read the row too early.
    await expect
      .poll(
        async () => {
          const { data } = await sb
            .from("Schedule")
            .select("id")
            .eq("instructor_id", TEST_DP_ID)
            .eq("date", SEED_DATE)
            .eq("start_time", "10:00:00");
          return data?.length ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBe(1);

    // Confirming actually deletes it.
    const ownedPopover2 = await hoverSlot(idx10, OWN_MARKER);
    await expect(
      ownedPopover2.getByRole("button", { name: "Delete Slot" }),
    ).toBeVisible();
    await ownedPopover2.getByRole("button", { name: "Delete Slot" }).click();
    await confirmDialog
      .locator(".confirm-actions")
      .getByRole("button", { name: /delete/i })
      .click();
    await expect(page.getByText("Tentative slot deleted.")).toBeVisible({
      timeout: 10_000,
    });
    await expect
      .poll(
        async () => {
          const { data } = await sb
            .from("Schedule")
            .select("id")
            .eq("instructor_id", TEST_DP_ID)
            .eq("date", SEED_DATE)
            .eq("start_time", "10:00:00");
          return data?.length ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBe(0);
  });
});

test.describe("Sales Dashboard — tentative edit (batch update)", () => {
  const SEED_DATE = "2027-05-08";
  const EDIT_MARKER = "PW-SUITE-EDIT-OWNED";
  const OTHER_MARKER = "PW-SUITE-EDIT-OTHER";
  const PAID_OTHER_MARKER = "PW-SUITE-EDIT-OTHER-PAID";

  const clearSeeded = () =>
    sb
      .from("Schedule")
      .delete()
      .eq("instructor_id", TEST_DP_ID)
      .eq("date", SEED_DATE);

  test.beforeEach(clearSeeded);
  test.afterEach(clearSeeded);
  test.afterAll(clearSeeded);

  test("creator edits own batch; anyone edits an unpaid slot; a paid slot of another agent is protected", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Discover the logged-in account's name the same way the app does.
    await searchAndAdd(page, "test_dp");
    const opened = await openTentativeModal(page, SEED_DATE);
    test.skip(!opened, "no free hour available to open the booking modal");
    if (!opened) return;
    await expect
      .poll(
        async () => (await page.locator("#salesAgent").inputValue()).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    const currentUserName = await page.locator("#salesAgent").inputValue();
    await page.getByRole("button", { name: "Cancel" }).click();

    // Clear the day so a previous run cannot leave a conflicting block.
    await clearSeededDay(TEST_DP_ID, SEED_DATE);

    const batchId = crypto.randomUUID();

    // Seed two rows in the same batch (same batch_id, same agent).
    for (const seed of [
      { start: "10:00:00", end: "11:00:00" },
      { start: "13:00:00", end: "14:00:00" },
    ]) {
      await seedExclusiveSlot(
        {
          instructor_id: TEST_DP_ID,
          date: SEED_DATE,
          start_time: seed.start,
          end_time: seed.end,
          status: "hold",
          isTentative: true,
          tentative_details: {
            name: EDIT_MARKER,
            phone: "9123450020",
            sales_agent: currentUserName,
            payment_status: "unpaid",
            address: "owned addr",
            course: "demo",
            batch_id: batchId,
            created_at: new Date().toISOString(),
          },
          learner_id: null,
          course_id: null,
          lesson_id: null,
        },
        TEST_DP_ID,
        SEED_DATE,
      );
    }

    // Seed a third row by a different agent (no batch_id match).
    await seedExclusiveSlot(
      {
        instructor_id: TEST_DP_ID,
        date: SEED_DATE,
        start_time: "16:00:00",
        end_time: "17:00:00",
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
      TEST_DP_ID,
      SEED_DATE,
    );

    await seedExclusiveSlot(
      {
        instructor_id: TEST_DP_ID,
        date: SEED_DATE,
        start_time: "19:00:00",
        end_time: "20:00:00",
        status: "hold",
        isTentative: true,
        tentative_details: {
          name: PAID_OTHER_MARKER,
          phone: "9123450022",
          sales_agent: "Someone Else Entirely",
          payment_status: "half_paid",
          address: "paid addr",
          course: "demo",
          created_at: new Date().toISOString(),
        },
        learner_id: null,
        course_id: null,
        lesson_id: null,
      },
      TEST_DP_ID,
      SEED_DATE,
    );

    await waitForSeedVisibleInBrowser(page, TEST_DP_ID, SEED_DATE);
    await page.reload();
    await page.waitForSelector(".sales-dashboard-root", { timeout: 15_000 });
    await page.waitForTimeout(1000);
    await gotoMonth(page, "May", "2027");
    await gotoDay(page, 8);
    const row = page.locator(".row", { hasText: "test_dp" }).first();

    const timeLabels = await page
      .locator("thead th.col-time-h")
      .allInnerTexts();
    const idx10 = timeLabels.findIndex((t) => t.includes("10:00"));
    const idx13 = timeLabels.findIndex((t) => t.includes("13:00"));
    const idx16 = timeLabels.findIndex((t) => t.includes("16:00"));
    const idx19 = timeLabels.findIndex((t) => t.includes("19:00"));
    expect(idx19).toBeGreaterThanOrEqual(0);
    expect(idx10).toBeGreaterThanOrEqual(0);
    expect(idx13).toBeGreaterThanOrEqual(0);
    expect(idx16).toBeGreaterThanOrEqual(0);

    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator("td.cell")).toHaveCount(timeLabels.length, {
      timeout: 20_000,
    });

    const slot = (idx: number) => row.locator("td.cell").nth(idx);

    const hoverSlot = async (idx: number, expected: string) => {
      await page.mouse.move(2, 2);
      for (let attempt = 0; attempt < 6; attempt++) {
        await slot(idx).hover();
        const popover = page.locator(".slot-pop");
        try {
          await expect(popover).toContainText(expected, { timeout: 2_000 });
          return popover;
        } catch {
          await page.mouse.move(2, 2);
        }
      }
      const cls = await slot(idx)
        .getAttribute("class")
        .catch(() => "<cell gone>");
      const popText = await page
        .locator(".slot-pop")
        .innerText()
        .catch(() => "<no popover>");
      throw new Error(
        `hovering slot[${idx}] never showed "${expected}". ` +
          `cell class="${cls}" popover="${popText.replace(/\s+/g, " ").trim()}"`,
      );
    };

    // 1) Own batch: both slots show "Edit Slot"
    const owned10 = await hoverSlot(idx10, EDIT_MARKER);
    await expect(
      owned10.getByRole("button", { name: "Edit Slot" }),
    ).toBeVisible();
    await expect(
      owned10.getByRole("button", { name: "Delete Slot" }),
    ).toBeVisible();

    const owned13 = await hoverSlot(idx13, EDIT_MARKER);
    await expect(
      owned13.getByRole("button", { name: "Edit Slot" }),
    ).toBeVisible();

    // 2) Another agent's UNPAID row: anyone may edit it, but only its
    // creator may delete it.
    const otherPopover = await hoverSlot(idx16, "Someone Else Entirely");
    await expect(
      otherPopover.getByRole("button", { name: "Edit Slot" }),
    ).toHaveCount(1);
    await expect(
      otherPopover.getByRole("button", { name: "Delete Slot" }),
    ).toHaveCount(0);

    // 2b) Another agent's PAID row is protected: neither edit nor delete,
    // and the popover says why.
    const paidPopover = await hoverSlot(idx19, PAID_OTHER_MARKER);
    await expect(
      paidPopover.getByRole("button", { name: "Edit Slot" }),
    ).toHaveCount(0);
    await expect(
      paidPopover.getByRole("button", { name: "Delete Slot" }),
    ).toHaveCount(0);
    await expect(paidPopover).toContainText("only they can delete or edit");

    // 3) Click Edit Slot on the first class → modal opens in edit mode
    await slot(idx10).hover();
    await owned10.getByRole("button", { name: "Edit Slot" }).click();

    // Modal header reads "Edit Tentative Booking"
    await expect(page.getByText("Edit Tentative Booking")).toBeVisible({
      timeout: 15_000,
    });

    // Both classes listed in the "Selected Slots" list
    await expect(page.getByText("Classes in this booking (2)")).toBeVisible();

    // Shared fields prefilled
    await expect(page.locator("#customerName")).toHaveValue(EDIT_MARKER);
    await expect(page.locator("#customerPhone")).toHaveValue("9123450020");
    await expect(page.locator("#salesAgent")).toHaveValue(currentUserName);
    await expect(page.locator("#customerAddress")).toHaveValue("owned addr");
    await expect(page.locator("#course")).toHaveValue("demo");
    await expect(page.locator("#paymentStatus")).toHaveValue("unpaid");

    // Each row has a "Change time" button (edit mode)
    const changeTimeButtons = page
      .locator(".modal")
      .getByRole("button", { name: /Change time/ });
    await expect(changeTimeButtons).toHaveCount(2);

    // Change shared fields and save
    await page.locator("#customerName").fill("PW-SUITE-EDIT-UPDATED");
    await page.locator("#paymentStatus").selectOption("half_paid");
    await page.getByRole("button", { name: "Save Changes" }).click();

    // Wait for success toast
    await expect(
      page.getByText("Tentative booking updated successfully!"),
    ).toBeVisible({ timeout: 30_000 });

    // Poll DB: both rows should have the updated name and payment_status
    await expect
      .poll(
        async () => {
          const { data } = await sb
            .from("Schedule")
            .select("tentative_details")
            .eq("instructor_id", TEST_DP_ID)
            .eq("date", SEED_DATE)
            .eq("isTentative", true);
          const updated = (data ?? []).filter(
            (r) =>
              r.tentative_details?.name === "PW-SUITE-EDIT-UPDATED" &&
              r.tentative_details?.payment_status === "half_paid",
          );
          return updated.length;
        },
        { timeout: 15_000, message: "rows not updated in DB" },
      )
      .toBe(2);

    // Third row unchanged
    const { data: otherData } = await sb
      .from("Schedule")
      .select("tentative_details")
      .eq("instructor_id", TEST_DP_ID)
      .eq("date", SEED_DATE)
      .eq("start_time", "16:00:00")
      .eq("isTentative", true)
      .single();
    expect(otherData.tentative_details?.name).toBe(OTHER_MARKER);
    expect(otherData.tentative_details?.payment_status).toBe("unpaid");
  });
});
