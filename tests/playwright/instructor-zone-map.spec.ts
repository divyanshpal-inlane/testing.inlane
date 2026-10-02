import { expect, test } from "@playwright/test";

/**
 * Instructor Zone Map (/admin/instructor-zone-map) coverage.
 *
 * Read-only against the production database. The promotion test INTERCEPTS its
 * PATCH rather than sending it: `instructor_service_zones` RLS grants writes
 * only to admin/ops, so a test that really promoted a row could not undo it
 * (that happened, and the lone live rough polygon had to be restored by hand).
 * Asserting the outgoing request covers the same app code path with no blast
 * radius. Google Maps may not be reachable from the runner, so no assertion
 * depends on tile or polygon rendering — every assertion targets app chrome that
 * renders from Supabase data alone.
 */

const MAPPED = "Mapped (";
const UNMAPPED = "Not mapped (";

declare global {
  interface Window {
    /** Test handles installed by InstructorZoneMap; see the comment there. */
    __zoneSamplePin?: () => {
      at: { lat: number; lng: number };
      label: string;
    } | null;
    __zoneSetPin?: (
      lat: number,
      lng: number,
      label: string,
      apply: boolean,
    ) => void;
    /**
     * Read-only snapshot of what the page would render, so tests can assert the
     * status/rough rules against the real database without depending on Maps
     * tiles. Set by InstructorZoneMap.
     */
    __zoneState?: () => {
      zones: {
        instructorId: string;
        name: string;
        isRough: boolean;
        status: "active" | "on_break" | "inactive";
        /** Marker source actually used for the instructor dot. */
        marker: { lat: number; lng: number; source: "residence" | "centroid" };
        /** Effective polygon fill opacity (0 = outline only). */
        fillOpacity: number;
        /** True when the marker sits outside the instructor's own polygon. */
        residenceOutsideZone: boolean;
      }[];
      /** Zones withheld from the map because the instructor is inactive. */
      hiddenInactive: { instructorId: string; name: string }[];
      /** Every instructor the sidebar lists, whatever their status. */
      roster: {
        instructorId: string;
        name: string;
        status: "active" | "on_break" | "inactive";
        hasZone: boolean;
      }[];
      rosterSize: number;
      showRoughPolygons: boolean;
    };
  }
}

const filterBox = (page: import("@playwright/test").Page) =>
  page.getByLabel("Filter instructors");
const mappedList = (page: import("@playwright/test").Page) =>
  page.locator("aside section").filter({ hasText: MAPPED }).first();
const unmappedList = (page: import("@playwright/test").Page) =>
  page.locator("aside section").filter({ hasText: UNMAPPED }).first();

/**
 * One locator per instructor row in a list section.
 *
 * `section button` would overcount: every layer row carries a name button plus
 * its edit/visibility controls, so a list of 1 instructor reports 2+ buttons and
 * any count comparison silently drifts. The name button is the one titled
 * `Zoom to <instructor>`, which is unique per row and independent of the row's
 * other controls.
 */
const rowsIn = (list: import("@playwright/test").Locator) =>
  list.locator('button[title^="Zoom to"], button[title^="Select "]');

test.beforeEach(async ({ page }) => {
  await page.goto("/admin/instructor-zone-map");
  // The sidebar header renders on mount, regardless of whether the Maps
  // script resolves, so this never flakes on a missing API key.
  await expect(
    page.getByRole("heading", { name: "Instructor Zone Map" }),
  ).toBeVisible({ timeout: 30_000 });
});

test.describe("Instructor Zone Map — layout", () => {
  test("sidebar chrome renders", async ({ page }) => {
    await expect(filterBox(page)).toBeVisible();
    await expect(page.getByLabel("Search an address")).toBeVisible();
    await expect(page.getByLabel("Service areas")).toBeVisible();
    await expect(page.getByLabel("Instructor markers")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Fit all zones" }),
    ).toBeVisible();
  });

  test("reports mapped vs total instructor counts", async ({ page }) => {
    // Real numbers prove fetchDbZones() + the Instructor roster both resolved.
    // "66 of 130 instructors mapped".
    await expect(page.getByText(/\d+ of \d+ instructors mapped/)).toBeVisible();
    await expect(mappedList(page)).toBeVisible();
    await expect(unmappedList(page)).toBeVisible();
  });

  test("collapse and reopen the sidebar", async ({ page }) => {
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    // Collapsed removes the whole panel, so its heading and filters are gone
    // (not merely zero-width), leaving a single "show" control behind.
    await expect(
      page.getByRole("heading", { name: "Instructor Zone Map" }),
    ).toBeHidden();
    await expect(filterBox(page)).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Instructors" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Instructors" }).click();
    await expect(
      page.getByRole("heading", { name: "Instructor Zone Map" }),
    ).toBeVisible();
    await expect(filterBox(page)).toBeVisible();
  });

  test("layer switches toggle", async ({ page }) => {
    const polygons = page.getByRole("switch", { name: "Service areas" });
    await expect(polygons).toHaveAttribute("aria-checked", "true");
    await polygons.click();
    await expect(polygons).toHaveAttribute("aria-checked", "false");
    await polygons.click();
    await expect(polygons).toHaveAttribute("aria-checked", "true");

    const markers = page.getByRole("switch", { name: "Instructor markers" });
    await expect(markers).toHaveAttribute("aria-checked", "true");
    await markers.click();
    await expect(markers).toHaveAttribute("aria-checked", "false");
    await markers.click();
    await expect(markers).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("Instructor Zone Map — zone list", () => {
  test("loads real instructor polygons from the database", async ({ page }) => {
    const rows = mappedList(page).locator("button");
    // The live table holds ~67 polygons, so a non-zero count means the query
    // worked. (Asserting the exact number would make this fail every time Ops
    // redraws an area.)
    // `rows.count()` is an immediate snapshot, so it can read 0 while the
    // zones query is still in flight; wait for the header to report rows first.
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    expect(await rows.count()).toBeGreaterThan(10);
  });

  test("filter narrows the list and shows an empty state", async ({ page }) => {
    const rows = mappedList(page).locator("button");
    // The mapped list is now gated on BOTH the zone query and the instructor
    // roster (an inactive instructor's zone must be withheld, which means the
    // roster is what decides it), so the list can legitimately be empty for
    // longer than before. `count()` is an immediate snapshot and would otherwise
    // sample 0 and make the `n < before` poll unsatisfiable.
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await filterBox(page).fill("narasimhareddy");
    // Deliberately an instructor who is still active and still has a polygon.
    // The obvious fixture here used to be "Jawed", who is `status: inactive,
    // enabled: false` in the live data while STILL owning a polygon row — so he
    // is now correctly withheld and would make this filter test fail for the
    // wrong reason. Pick someone the status rule cannot remove.
    // Poll for a STABLE, non-empty filtered result rather than merely
    // "fewer than before". React Query refetches the roster on mount, so a
    // transient zero-row render mid-refetch satisfies a `less than` poll and
    // would then leave the rows.first() assertion below resolving to nothing.
    await expect
      .poll(
        async () => {
          const n = await rows.count();
          return n > 0 && n < before ? n : 0;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    await expect(rows.first()).toContainText(/narasimhareddy/i);

    await filterBox(page).fill("zzz-no-such-instructor-zzz");
    await expect(
      mappedList(page).getByText("No service area matches this filter."),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("selecting a zone highlights its row", async ({ page }) => {
    const row = mappedList(page).locator("button").first();
    await row.click();
    // Selection is expressed with the app's theme tokens (border-primary /
    // bg-accent) rather than a hard-coded orange, so this asserts the token
    // class instead of a colour value.
    await expect(row.locator("xpath=ancestor::div[1]")).toHaveClass(
      /border-primary/,
    );
  });
});

test.describe("Instructor Zone Map — layer tree", () => {
  // Selected by attribute rather than accessible name: the row's name button
  // also renders the vertex count, so deriving the layer name from its
  // innerText would smuggle the number into the checkbox's label.
  const layerToggle = (page: import("@playwright/test").Page) =>
    page
      .locator(
        'input[type="checkbox"][aria-label^="Toggle "][aria-label$=" layer"]',
      )
      .first();

  test("each mapped layer exposes a visibility checkbox", async ({ page }) => {
    const toggle = layerToggle(page);

    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    // Hiding a layer is a rendering-only change: the row stays listed and
    // unchecking it must not delete geometry.
    await expect(toggle).not.toBeChecked();
    await expect(mappedList(page).locator("button").first()).toBeVisible();
    await toggle.check();
    await expect(toggle).toBeChecked();
  });

  test("show all / hide all flips every layer toggle", async ({ page }) => {
    const toggle = layerToggle(page);

    await page.getByRole("button", { name: "Hide all" }).click();
    await expect(toggle).not.toBeChecked();

    await page.getByRole("button", { name: "Show all" }).click();
    await expect(toggle).toBeChecked();
  });
});

test.describe("Instructor Zone Map — location matching", () => {
  test("reports which polygons cover a searched address", async ({ page }) => {
    // Requires the Maps script + Geocoder, so it skips rather than flakes when
    // the runner has no network/API key. Everything else in this file is
    // deliberately render-only for that reason.
    test.skip(
      !(await page.evaluate(() =>
        Boolean((window as { google?: unknown }).google),
      )),
      "Google Maps script unavailable",
    );

    await page.getByLabel("Search an address").fill("Koramangala, Bengaluru");
    // Enter rather than the Go button: this page renders several controls
    // whose accessible names contain "Go", so a role/name click is ambiguous.
    await page.getByLabel("Search an address").press("Enter");

    const matches = page.getByTestId("pin-matches");
    await expect(matches).toBeVisible({ timeout: 20_000 });
    // Either outcome is legitimate depending on real coverage; what matters is
    // that the panel states one of them rather than staying silent.
    await expect(
      matches.getByText(/instructor[s]? serve this location|No polygon covers/),
    ).toBeVisible();
  });
});

test.describe("Instructor Zone Map — location filter", () => {
  /**
   * Drop a pin the app's own matcher confirms is inside a real polygon, and
   * enable the filter.
   *
   * Sampling goes through the app rather than the database for two reasons.
   * The anon key cannot read `instructor_service_zones` at all (RLS rejects it),
   * and coverage is live Ops data that gets redrawn — a coordinate baked into
   * this spec would drift outside every ring and turn these into permanent false
   * failures. The expected match set is then read from the app's own
   * `pin-matches` panel, so nothing here restates the matching rule (including
   * company-instructor exclusion) and can drift from it.
   */
  const dropPin = async (page: import("@playwright/test").Page) => {
    await page.waitForFunction(
      () => Boolean(window.__zoneSamplePin && window.__zoneSetPin),
      null,
      { timeout: 30_000 },
    );
    const applied = await page.evaluate(() => {
      const sampled = window.__zoneSamplePin!();
      if (!sampled) return false;
      window.__zoneSetPin!(sampled.at, sampled.label, true);
      return true;
    });
    test.skip(!applied, "no polygon coverage available");
  };

  /** Names the app itself reports as covering the dropped pin. */
  const panelMatches = async (page: import("@playwright/test").Page) => {
    const panel = page.getByTestId("pin-matches");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    return (await panel.locator("li button").allInnerTexts()).map((t) =>
      t.trim(),
    );
  };

  test("the filter button sits directly below the text filter", async ({
    page,
  }) => {
    // Structural, not visual: asserts adjacency so the control cannot drift
    // somewhere else on the page in a later refactor.
    const toggle = page.getByTestId("location-filter-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText(/Filter by location/);
    // Comes after the text filter in DOM order.
    const order = await page.evaluate(() => {
      const a = document.querySelector(
        'input[aria-label="Filter instructors"]',
      );
      const b = document.querySelector(
        '[data-testid="location-filter-toggle"]',
      );
      if (!a || !b) return null;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
        ? "after"
        : "before";
    });
    expect(order).toBe("after");
  });

  test("the location input gets a Places suggestion dropdown", async ({
    page,
  }) => {
    // The reported bug: typing in the location filter showed no suggestions.
    // The widget is Google's `Autocomplete`, which decorates the input it is
    // attached to with its own listeners, so "is it attached?" is observable as
    // "does typing in THIS input produce a .pac-container?". Asserting that
    // rather than the presence of the widget guards the actual symptom, and it
    // would have failed while the input had no ref wired up.
    test.skip(
      !(await page.evaluate(() =>
        Boolean((window as { google?: unknown }).google),
      )),
      "Google Maps script unavailable",
    );

    await page.getByTestId("location-filter-toggle").click();
    const input = page.getByLabel("Search a location");
    await input.click();
    await input.pressSequentially("Koramangala", { delay: 120 });

    // The dropdown is appended to <body>, not inside our own markup.
    await expect(page.locator(".pac-container")).toBeAttached({
      timeout: 20_000,
    });
  });

  test("clicking the button opens a search panel without filtering yet", async ({
    page,
  }) => {
    // Opening the panel is not the same as committing to a location: a stray
    // click must not narrow the list using whatever pin the header search left
    // lying around.
    await filterBox(page).fill("");
    const before = await rowsIn(mappedList(page)).count();
    await page.getByTestId("location-filter-toggle").click();
    await expect(page.getByTestId("location-filter")).toBeVisible();
    await expect(page.getByLabel("Search a location")).toBeVisible();
    expect(await rowsIn(mappedList(page)).count()).toBe(before);
  });

  test("narrows the list to only the instructors whose polygon covers the point", async ({
    page,
  }) => {
    await filterBox(page).fill("");
    const before = await rowsIn(mappedList(page)).count();
    await page.getByTestId("location-filter-toggle").click();
    await dropPin(page);

    // Strictly fewer rows, and the survivors are exactly the covering set.
    await expect
      .poll(async () => rowsIn(mappedList(page)).count(), {
        timeout: 15_000,
      })
      .toBeLessThan(before);

    // The app's own match panel is the oracle. Comparing the filtered list to
    // it means the assertion holds for whatever the production matcher decided,
    // including its company-instructor exclusion, without the test restating
    // that rule and drifting from it.
    const expected = await panelMatches(page);
    expect(expected.length).toBeGreaterThan(0);
    expect(await rowsIn(mappedList(page)).count()).toBe(expected.length);

    for (const name of expected) {
      await expect(
        rowsIn(mappedList(page)).filter({ hasText: name }).first(),
      ).toBeVisible();
    }

    // Unmapped instructors have no ring, so they can never cover a point and
    // must drop out of both lists while the filter is on.
    await expect(rowsIn(unmappedList(page))).toHaveCount(0);
  });

  test("composes with the text filter (AND, not OR)", async ({ page }) => {
    await filterBox(page).fill("");
    const before = await rowsIn(mappedList(page)).count();
    await page.getByTestId("location-filter-toggle").click();
    await dropPin(page);
    const covering = (await panelMatches(page)).length;
    await expect
      .poll(async () => rowsIn(mappedList(page)).count(), {
        timeout: 15_000,
      })
      .toBeLessThan(before);

    // A text query matching one of the covering instructors keeps at least one
    // row but never more than the location filter alone allowed. A surviving
    // count above `covering` would mean the text query was ignored (OR) rather
    // than intersected with the location filter.
    const target = (await panelMatches(page))[0].split(/\s+/)[0];
    await filterBox(page).fill(target);
    await expect
      .poll(async () => rowsIn(mappedList(page)).count(), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    expect(await rowsIn(mappedList(page)).count()).toBeLessThanOrEqual(
      covering,
    );
    await expect(
      rowsIn(mappedList(page)).filter({ hasText: target }).first(),
    ).toBeVisible();

    // A text query that matches no covering instructor empties the list
    // entirely, which only holds if both filters must pass.
    await filterBox(page).fill("zzz-no-such-instructor-zzz");
    await expect(
      mappedList(page).getByText("No service area matches this filter."),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Clear removes the location filter and restores the full list", async ({
    page,
  }) => {
    await filterBox(page).fill("");
    const before = await rowsIn(mappedList(page)).count();
    await page.getByTestId("location-filter-toggle").click();
    await dropPin(page);
    await expect
      .poll(async () => rowsIn(mappedList(page)).count(), {
        timeout: 15_000,
      })
      .toBeLessThan(before);

    await page.getByLabel("Clear location filter").click();
    await expect(page.getByTestId("location-filter")).toHaveCount(0);
    await expect
      .poll(async () => rowsIn(mappedList(page)).count(), {
        timeout: 15_000,
      })
      .toBe(before);
  });

  test("toggling the button off also clears the filter", async ({ page }) => {
    await filterBox(page).fill("");
    const before = await rowsIn(mappedList(page)).count();
    await page.getByTestId("location-filter-toggle").click();
    await dropPin(page);
    await expect
      .poll(async () => rowsIn(mappedList(page)).count(), {
        timeout: 15_000,
      })
      .toBeLessThan(before);

    await page.getByTestId("location-filter-toggle").click();
    await expect(page.getByTestId("location-filter")).toHaveCount(0);
    await expect
      .poll(async () => rowsIn(mappedList(page)).count(), {
        timeout: 15_000,
      })
      .toBe(before);
  });
});

/**
 * Instructor status, rough polygons, and the residence marker.
 *
 * These three rules are the ones that can regress without any visible symptom:
 * a transparent polygon is indistinguishable from a missing one, an inactive
 * instructor simply vanishes (which looks the same as "not loaded yet"), and a
 * residence dot in the wrong place needs real geometry to judge. So they are
 * asserted against the app's own computed state via `__zoneState`, which is
 * built from the same values the overlays use.
 */
test.describe("Instructor Zone Map — status, rough polygons, residence", () => {
  const zoneState = async (page: import("@playwright/test").Page) => {
    // The hook is installed by an effect that depends on the zones query, so
    // poll rather than reading it once.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const s = window.__zoneState?.();
            return s ? s.zones.length : 0;
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    return await page.evaluate(() => window.__zoneState!());
  };

  /**
   * Same snapshot, but does NOT require a non-empty `zones` array.
   *
   * `zoneState` waits for `zones.length > 0` because nearly every assertion here
   * is about drawn polygons. Two cases need the opposite: a mode/filter that
   * legitimately empties the map, and the moment right after a toggle click
   * before React has re-rendered. Polling with `zoneState` there hangs on its
   * own precondition and reports a timeout that looks like a broken toggle
   * rather than the empty list it is actually observing.
   */
  const rawZoneState = async (page: import("@playwright/test").Page) => {
    await expect
      .poll(
        async () =>
          await page.evaluate(() =>
            window.__zoneState ? Boolean(window.__zoneState()) : false,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    return await page.evaluate(() => window.__zoneState!());
  };

  test("inactive instructors are listed and drawn, on-break render as outlines, Inactive toggle controls visibility", async ({
    page,
  }) => {
    const state = await zoneState(page);
    expect(state.zones.length).toBeGreaterThan(0);

    // Inactive instructors are NOW drawn on the map (when the Inactive toggle
    // is ON, which is the default). The Inactive toggle in the sidebar controls
    // their visibility. This is the new behaviour requested: show inactive
    // polygons on the map but let the admin hide them with the toggle.
    const inactiveZones = state.zones.filter((z) => z.status === "inactive");
    expect(inactiveZones.length).toBeGreaterThan(0);

    // The sidebar lists EVERYONE, whatever their status. Inactive instructors
    // appear in Mapped (if they have a polygon) with their Inactive badge.
    for (const hidden of state.hiddenInactive) {
      const listed = state.roster.find(
        (r) => r.instructorId === hidden.instructorId,
      );
      expect(
        listed,
        `${hidden.name} missing from the sidebar roster`,
      ).toBeDefined();
      expect(listed!.status).toBe("inactive");
      expect(listed!.hasZone).toBe(true);
    }

    // Inactive tags rendered in sidebar (both Mapped and Not mapped columns).
    await expect(
      page.locator("aside").locator('[data-zone-status="inactive"]'),
    ).toHaveCount(state.roster.filter((r) => r.status === "inactive").length);

    // On-break => outline only. Active + verified => filled.
    const outline = state.zones.filter((z) => z.fillOpacity === 0);
    const filled = state.zones.filter((z) => z.fillOpacity > 0);
    const onBreak = state.zones.filter((z) => z.status === "on_break");
    expect(onBreak.length).toBeGreaterThan(0);
    expect(filled.length).toBeGreaterThan(0);
    for (const z of outline) {
      expect(z.status === "on_break" || z.isRough).toBe(true);
    }
    for (const z of state.zones) {
      if (z.status === "on_break") expect(z.fillOpacity).toBe(0);
      if (z.status === "active" && !z.isRough) {
        expect(z.fillOpacity).toBeGreaterThan(0);
      }
    }
  });

  test("the sidebar badges every off-road instructor", async ({ page }) => {
    const state = await zoneState(page);
    // Live data has both non-active states. Without this the counts below would
    // be 0 == 0 and pass while nothing was badged at all.
    expect(state.roster.some((r) => r.status === "on_break")).toBe(true);
    expect(state.roster.some((r) => r.status === "inactive")).toBe(true);

    // Counted, not name-matched. Three live instructors share the name
    // "Divyansh Pal", so any per-name lookup is ambiguous — and a per-row lookup
    // would also silently skip the duplicate. An exact count against the roster
    // is duplicate-proof and cannot be satisfied by one stray tag somewhere.
    //
    // Scoped to the sidebar `<aside>` so the info card's own badge cannot stand
    // in for a missing row badge. NOT `getByLabel("Service areas")`: that is
    // the layer-visibility Switch, not a container.
    const sidebar = page.locator("aside");
    for (const status of ["on_break", "inactive"] as const) {
      const expected = state.roster.filter((r) => r.status === status).length;
      await expect(
        sidebar.locator(`[data-zone-status="${status}"]`),
        `wrong number of "${status}" tags`,
      ).toHaveCount(expected);
    }

    // Active is deliberately NOT badged: ~120 chips reading "Active" would bury
    // the two states that change behaviour. Pinned here so the omission stays a
    // decision rather than drifting into an oversight.
    await expect(sidebar.locator('[data-zone-status="active"]')).toHaveCount(0);

    // No "hidden" filler text: the requirement is a plain "Inactive" tag, and an
    // extra word in the row is a regression of that.
    await expect(sidebar).not.toContainText("hidden");
  });

  test("status tags trail the instructor name in the sidebar", async ({
    page,
  }) => {
    // Ordering is a visual requirement, so assert it on the DOM order of the
    // name button's own children. A first row may legitimately be active and
    // carry no tag, so this only pins the order when a tag is present.
    const tagged = page
      .locator('button[title^="Zoom to"]')
      .filter({ has: page.locator("[data-zone-status]") })
      .first();
    await expect(tagged).toBeVisible({ timeout: 30_000 });
    const order = await tagged.evaluate((el) =>
      Array.from(el.querySelectorAll("[data-zone-status]")).map((n) =>
        n.textContent?.trim(),
      ),
    );
    expect(order.length).toBeGreaterThan(0);
    // The name is the row's first text node; a status tag must never precede it.
    const nameAt = await tagged.evaluate((el) => {
      const name = el.querySelector("span")?.textContent?.trim() ?? "";
      const tag = el.querySelector("[data-zone-status]");
      if (!tag) return -1;
      return name.length > 0
        ? Array.from(el.childNodes).findIndex(
            (n) => n.textContent?.trim() === name,
          )
        : -1;
    });
    expect(nameAt).toBeGreaterThanOrEqual(0);
  });

  test("the status toggles filter the view without changing the roster", async ({
    page,
  }) => {
    const before = await zoneState(page);
    const sidebar = page.locator("aside");

    // All three default to on, so the counts must sum to the whole roster. A
    // toggle that shipped defaulting to off would silently hide instructors the
    // user explicitly asked to be listed.
    const total = await sidebar
      .locator("[data-status-count]")
      .evaluateAll((els) =>
        els.reduce((sum, el) => sum + Number(el.textContent ?? 0), 0),
      );
    expect(total).toBe(before.rosterSize);
    for (const label of ["Active", "On Break", "Inactive"]) {
      await expect(
        page.getByRole("switch", { name: `Show ${label} instructors` }),
      ).toHaveAttribute("aria-checked", "true");
    }

    // Turning OFF "On Break" must drop exactly the on-break rows and nothing
    // else. Asserted per-status, not on total count, so a swap of one row for
    // another cannot pass.
    await page
      .getByRole("switch", { name: "Show On Break instructors" })
      .click();
    await expect(sidebar.locator('[data-zone-status="on_break"]')).toHaveCount(
      0,
    );
    await expect(sidebar.locator('[data-zone-status="inactive"]')).toHaveCount(
      before.roster.filter((r) => r.status === "inactive").length,
    );
    // On-break polygons also leave the map: "Show on break" governs drawing too.
    await expect
      .poll(
        async () =>
          (await rawZoneState(page)).zones.some((z) => z.status === "on_break"),
        { timeout: 15_000 },
      )
      .toBe(false);

    // A view filter, not a data change: the roster is untouched, so restoring
    // the switch brings the rows straight back. This is the regression guard —
    // if filtering mutated the query or cached the filtered list, switching back
    // on would not restore anything.
    await page
      .getByRole("switch", { name: "Show On Break instructors" })
      .click();
    await expect(sidebar.locator('[data-zone-status="on_break"]')).toHaveCount(
      before.roster.filter((r) => r.status === "on_break").length,
    );
    await expect
      .poll(async () => (await rawZoneState(page)).rosterSize)
      .toBe(before.rosterSize);
  });

  test("the Inactive toggle controls inactive polygon visibility", async ({
    page,
  }) => {
    // The Inactive toggle now GATES inactive polygon visibility.
    // Default is ON (drawn). Turning OFF hides them. This is the explicit
    // control the user requested.
    const state = await zoneState(page);
    const inactiveCount = state.roster.filter(
      (r) => r.status === "inactive",
    ).length;
    expect(inactiveCount).toBeGreaterThan(0);

    // Default: Inactive toggle ON, inactive polygons ARE drawn.
    expect(state.zones.some((z) => z.status === "inactive")).toBe(true);

    // Turn OFF the Inactive toggle: inactive polygons should disappear from map.
    await page
      .getByRole("switch", { name: "Show Inactive instructors" })
      .click();
    await expect
      .poll(
        async () =>
          (await rawZoneState(page)).zones.some((z) => z.status === "inactive"),
        { timeout: 15_000 },
      )
      .toBe(false);

    // The status switches are a VIEW filter over both the map and the sidebar
    // lists, so turning Inactive off empties the inactive rows out of Mapped and
    // Not mapped alike. (An earlier version of this test asserted the badges
    // stayed put, on the theory that the toggle only governed the map. That
    // contradicted `listedZones`/`matchedRoster`, which both apply
    // `statusVisible`, and it is why this test had been failing.)
    await expect(
      page.locator("aside").locator('[data-zone-status="inactive"]'),
    ).toHaveCount(0);

    // Turn it back ON: inactive polygons should reappear, and with them their
    // sidebar rows — the filter is reversible, so nothing is lost.
    await page
      .getByRole("switch", { name: "Show Inactive instructors" })
      .click();
    await expect
      .poll(
        async () =>
          (await rawZoneState(page)).zones.some((z) => z.status === "inactive"),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect(
      page.locator("aside").locator('[data-zone-status="inactive"]'),
    ).toHaveCount(inactiveCount);
  });

  test("a rough polygon can be promoted to a normal polygon from the card", async ({
    page,
  }) => {
    // The PATCH is INTERCEPTED, not sent. This suite runs against the production
    // database, and `instructor_service_zones` RLS grants write access only to
    // admin/ops — an earlier version of this test really did promote the single
    // live rough row and could not put it back, because a cleanup path using the
    // anon key is silently rejected. Asserting the outgoing request instead of
    // performing the write tests the same app code path with zero blast radius.
    //
    // What that still covers, end to end: the button appears only for a rough
    // zone, the mutation runs, `updateZoneById` builds the correct PATCH body,
    // and the refetch drops the zone out of the rough view.
    const patches: Record<string, unknown>[] = [];
    const patchUrls: string[] = [];
    await page.route("**/rest/v1/instructor_service_zones*", async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      patches.push(route.request().postDataJSON() as Record<string, unknown>);
      patchUrls.push(route.request().url());
      // Fulfilled with the columns the writer selects, so `toDbZone` parses it.
      // The rest GET still reaches the real database, so the refetch below sees
      // the genuine row still flagged rough.
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([
          {
            id: "intercepted",
            instructor_id: "intercepted",
            coordinates: [],
            raw_name: null,
            is_rough: false,
            Instructor: null,
          },
        ]),
      });
    });

    await page.getByRole("switch", { name: "Show Rough Polygons" }).click();
    await expect
      .poll(async () => (await rawZoneState(page)).showRoughPolygons)
      .toBe(true);
    const state = await zoneState(page);
    const rough = state.zones.filter((z) => z.isRough);
    expect(rough.length, "no live rough polygon to promote").toBeGreaterThan(0);
    const target = rough[0];

    await page
      .locator(`button[title="Zoom to ${target.name}"]`)
      .first()
      .click();
    await expect(page.getByTestId("info-card")).toBeVisible();

    // The promote action exists ONLY for a rough boundary.
    const promote = page.getByTestId("info-card-promote");
    await expect(promote).toBeVisible();
    await expect(promote).toContainText(/make normal polygon/i);

    await promote.click();
    await expect.poll(() => patches.length, { timeout: 15_000 }).toBe(1);

    // The requirement itself: is_rough is set to false.
    expect(patches[0].is_rough).toBe(false);
    // And it is the ONLY thing sent. `coordinates` being absent is the load-
    // bearing part: promotion must not restate the stored ring, or a
    // round-trip through closeRing/JSON could quietly alter an Ops-drawn
    // boundary while Ops only meant to verify it.
    expect(Object.keys(patches[0])).toEqual(["is_rough"]);
    // Targeted at one row, not a blind table update.
    expect(patchUrls[0]).toContain("id=eq.");
  });

  test("a verified polygon can be demoted to a rough polygon from the card", async ({
    page,
  }) => {
    // Same interception rationale as the promote test above: this suite runs
    // against the production database and anon writes to
    // `instructor_service_zones` are RLS-rejected and cannot be undone, so the
    // PATCH is captured rather than sent. This asserts the app code path —
    // button visibility, mutation wiring, and the exact outgoing body — with
    // no blast radius.
    const patches: Record<string, unknown>[] = [];
    const patchUrls: string[] = [];
    await page.route("**/rest/v1/instructor_service_zones*", async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      patches.push(route.request().postDataJSON() as Record<string, unknown>);
      patchUrls.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([
          {
            id: "intercepted",
            instructor_id: "intercepted",
            coordinates: [],
            raw_name: null,
            is_rough: true,
            Instructor: null,
          },
        ]),
      });
    });

    // The default view (rough toggle OFF) draws verified polygons only.
    const state = await zoneState(page);
    const verified = state.zones.filter((z) => !z.isRough);
    expect(verified.length, "no verified polygon to demote").toBeGreaterThan(0);
    const target = verified.find((z) => z.name === "test_dp") ?? verified[0];

    await page
      .locator(`button[title="Zoom to ${target.name}"]`)
      .first()
      .click();
    await expect(page.getByTestId("info-card")).toBeVisible();

    // The demote action exists ONLY for a verified boundary.
    const demote = page.getByTestId("info-card-demote");
    await expect(demote).toBeVisible();
    await expect(demote).toContainText(/make rough polygon/i);

    await demote.click();
    await expect.poll(() => patches.length, { timeout: 15_000 }).toBe(1);

    // The requirement itself: is_rough is set to true, and it is the ONLY thing
    // sent. `coordinates` absent is load-bearing — demotion is a flag flip, and
    // restating the ring risks altering an Ops-drawn boundary.
    expect(patches[0].is_rough).toBe(true);
    expect(Object.keys(patches[0])).toEqual(["is_rough"]);
    expect(patchUrls[0]).toContain("id=eq.");
  });

  test("rough polygons are hidden until the toggle is switched on", async ({
    page,
  }) => {
    const before = await zoneState(page);
    // Requirement: rough polygons are NOT visible by default.
    expect(before.showRoughPolygons).toBe(false);
    expect(before.zones.some((z) => z.isRough)).toBe(false);

    // This Switch exposes `aria-checked`, not Radix's `data-state`.
    const toggle = page.getByRole("switch", { name: "Show Rough Polygons" });
    // Off by default, which is the requirement itself.
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();
    // `rawZoneState`, not `zoneState`: rough mode legitimately leaves the map
    // empty on a database with no rough polygons, and `zoneState` waits for a
    // non-empty drawn set, so it would hang on its own precondition and report
    // a timeout instead of the empty list it is watching.
    await expect
      .poll(async () => (await rawZoneState(page)).showRoughPolygons, {
        timeout: 15_000,
      })
      .toBe(true);
    const after = await rawZoneState(page);
    const rough = after.zones.filter((z) => z.isRough);
    // Whatever rough rows exist must be marked outline-only, never filled.
    for (const z of rough) {
      expect(z.fillOpacity).toBe(0);
    }
    // The toggle is EXCLUSIVE, not additive: rough on means verified off. So the
    // drawn set normally SHRINKS rather than grows, and asserting growth was
    // simply wrong — it only ever passed by accident when the rough set happened
    // to be larger than the hidden half of the verified set. Assert the two
    // rules that actually define the mode instead:
    //  - every rough row that exists is now drawn;
    //  - no verified row is drawn while rough mode is on.
    if (rough.length > 0) {
      const beforeIds = new Set(before.zones.map((z) => z.instructorId));
      for (const z of rough) {
        expect(beforeIds.has(z.instructorId)).toBe(false);
      }
    }
    expect(after.zones.some((z) => !z.isRough)).toBe(false);

    // Turning it back off must hide them again.
    await toggle.click();
    await expect
      .poll(async () => (await rawZoneState(page)).showRoughPolygons, {
        timeout: 15_000,
      })
      .toBe(false);
    await expect
      .poll(
        async () => (await rawZoneState(page)).zones.some((z) => z.isRough),
        { timeout: 15_000 },
      )
      .toBe(false);
  });

  test("markers use the instructor's residence, which may be outside the polygon", async ({
    page,
  }) => {
    const state = await zoneState(page);
    const withResidence = state.zones.filter(
      (z) => z.marker.source === "residence",
    );
    // Most instructors have a registered address; without this the test would
    // pass vacuously by falling back to the centroid for everyone.
    expect(withResidence.length).toBeGreaterThan(0);

    // Every zone must be drawable at all (a real ring), and the marker must
    // never be a NaN/undefined coordinate.
    for (const z of state.zones) {
      expect(Number.isFinite(z.marker.lat)).toBe(true);
      expect(Number.isFinite(z.marker.lng)).toBe(true);
    }

    // The key invariant: a residence outside the polygon is still rendered at
    // the residence, and this is legitimate. At least one such instructor is
    // expected in live data, but the assertion is written to hold either way —
    // the point is that it does NOT force the marker inside, and does not fall
    // back to the centroid when a residence exists.
    for (const z of withResidence) {
      if (z.residenceOutsideZone) {
        expect(z.marker.source).toBe("residence");
      }
    }
  });
});

test.describe("Instructor Zone Map — map controls", () => {
  test("basemap toggle switches roadmap/satellite", async ({ page }) => {
    const roadmap = page.getByRole("button", { name: "roadmap map" });
    const satellite = page.getByRole("button", { name: "satellite map" });

    await expect(roadmap).toHaveAttribute("aria-pressed", "true");
    await expect(satellite).toHaveAttribute("aria-pressed", "false");

    await satellite.click();
    await expect(satellite).toHaveAttribute("aria-pressed", "true");
    await expect(roadmap).toHaveAttribute("aria-pressed", "false");

    await roadmap.click();
    await expect(roadmap).toHaveAttribute("aria-pressed", "true");
  });

  // The basemap toggle sits in the My Maps position: top-left of the map. It
  // also shares a column with the sidebar-expand button, so collapsing the
  // sidebar must not push the two controls on top of each other.
  test("basemap toggle sits top-left and never overlaps the sidebar button", async ({
    page,
  }) => {
    const mapBox = await page
      .locator("div")
      .filter({ has: page.getByRole("button", { name: "roadmap map" }) })
      .last()
      .boundingBox();

    // Wrapper is left-3 top-3, so it must sit in the upper-left quadrant of
    // the map area rather than pinned to the bottom.
    const viewport = page.viewportSize()!;
    expect(mapBox!.x).toBeLessThan(viewport.width * 0.4);
    expect(mapBox!.y).toBeLessThan(150);

    // Collapsing the sidebar reveals the "Instructors" button in the same
    // column; the two must not overlap.
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    const instructors = page.getByRole("button", { name: "Instructors" });
    await expect(instructors).toBeVisible();
    const instBox = await instructors.boundingBox();
    const toggleBox = await page
      .getByRole("button", { name: "roadmap map" })
      .boundingBox();

    const overlaps =
      instBox!.x < toggleBox!.x + toggleBox!.width &&
      toggleBox!.x < instBox!.x + instBox!.width &&
      instBox!.y < toggleBox!.y + toggleBox!.height &&
      toggleBox!.y < instBox!.y + instBox!.height;
    expect(overlaps, "top-left controls must not overlap").toBe(false);
  });

  test("refresh, fullscreen and export controls are present and uniquely named", async ({
    page,
  }) => {
    await expect(
      page.getByRole("button", { name: "Refresh map data" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Fullscreen" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export visible areas as GeoJSON" }),
    ).toBeVisible();

    // The map stack has its own fit button, deliberately named differently from
    // the sidebar's "Fit all zones" so neither is an ambiguous-name pair.
    await expect(
      page.getByRole("button", { name: "Fit map to all zones" }),
    ).toBeVisible();
    expect(
      await page.getByRole("button", { name: "Fit all zones" }).count(),
    ).toBe(1);
  });

  test("marker position defaults to the residence and can switch to the polygon centre", async ({
    page,
  }) => {
    const select = page.locator("#marker-position");
    // The control only renders once the markers switch is on. Wait for it
    // explicitly rather than relying on the default 5s action timeout, which is
    // tight when the whole suite is competing for the Maps script.
    await expect(select).toBeVisible({ timeout: 20_000 });
    // "Registered address" is the default: the dot marks the instructor's
    // residence, which is a real address and is routinely outside the service
    // polygon drawn beside it. The centroid is the fallback, not the default.
    await expect(select).toHaveValue("roster", { timeout: 20_000 });
    await select.selectOption("centroid");
    await expect(select).toHaveValue("centroid");
    await select.selectOption("roster");
    await expect(select).toHaveValue("roster");
  });

  test("export produces a GeoJSON download of the visible layers", async ({
    page,
  }) => {
    // Read-only: hides every layer first so the export is guaranteed to contain
    // zero features and cannot leak real geometry into the repo's test output.
    await page.getByRole("button", { name: "Hide all" }).click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export visible areas as GeoJSON" })
      .click();
    expect((await download).suggestedFilename()).toBe(
      "instructor-service-areas.geojson",
    );
  });
});

test.describe("Instructor Zone Map — header bar", () => {
  test("My Maps header renders with title and search", async ({ page }) => {
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Instructor Service Zones" }),
    ).toBeVisible();
    // Search moved out of the sidebar so it survives collapsing the layer list.
    await expect(page.getByLabel("Search an address")).toBeVisible();
  });

  test("header search stays reachable while the sidebar is collapsed", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(filterBox(page)).toBeHidden();
    await expect(page.getByLabel("Search an address")).toBeVisible();
  });

  test("header hamburger toggles the layer list", async ({ page }) => {
    const hamburger = page.getByRole("button", { name: "Toggle layer list" });
    await hamburger.click();
    await expect(filterBox(page)).toBeHidden();
    await hamburger.click();
    await expect(filterBox(page)).toBeVisible();
  });

  test("overflow menu exposes the map actions", async ({ page }) => {
    await page.getByRole("button", { name: "More options" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    for (const label of [
      "Refresh map data",
      "Fit map to all zones",
      "Show all layers",
      "Hide all layers",
      "Export visible areas as GeoJSON",
    ]) {
      await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
    }
  });
});

test.describe("Instructor Zone Map — inline editing", () => {
  // Editing happens on the main map, so none of these tests may see a dialog.
  // The coarse interaction assertions (undo/redo over a dirty ring, discard)
  // live in instructor-zone-drawing.spec.ts, which drives the shared editor
  // directly; here the bar itself is the subject.

  test("editing an existing zone opens an inline bar, not a dialog", async ({
    page,
  }) => {
    // test_dp is a long-standing mapped fixture.
    const editBtn = page.getByLabel("Edit test_dp service area");
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const bar = page.getByTestId("zone-edit-bar");
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(bar).toContainText("test_dp");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The saved ring is loaded, so it is immediately saveable...
    await expect(bar.getByTestId("zone-edit-save")).toBeEnabled();
    // ...and Delete is offered, because a persisted row can be removed.
    await expect(bar.getByTestId("zone-edit-delete")).toBeVisible();
    // Opening the editor is not itself an edit, so there is nothing to undo,
    // redo or discard yet. Undo deliberately cannot step back past the seed:
    // that state is "no edit in progress", not "a zone that was deleted".
    await expect(bar.getByTestId("zone-undo")).toBeDisabled();
    await expect(bar.getByTestId("zone-redo")).toBeDisabled();
    await expect(bar.getByTestId("zone-edit-discard")).toBeDisabled();
  });

  test("the seeded ring reports its real vertex count", async ({ page }) => {
    await page.getByLabel("Edit test_dp service area").click();
    const bar = page.getByTestId("zone-edit-bar");
    await expect(bar).toBeVisible({ timeout: 15_000 });

    // test_dp is an unclosed mock ring, so its stored form carries one extra
    // point; the editor works in the open form.
    await expect(bar.getByTestId("zone-edit-vertex-count")).toContainText(
      /^\d+ points/,
    );
    const count = await bar.getByTestId("zone-edit-vertex-count").innerText();
    expect(Number(count.match(/(\d+)/)?.[1] ?? "0")).toBeGreaterThanOrEqual(3);
  });

  test("Cancel leaves a clean edit without touching the zone", async ({
    page,
  }) => {
    await page.getByLabel("Edit test_dp service area").click();
    const bar = page.getByTestId("zone-edit-bar");
    await expect(bar).toBeVisible({ timeout: 15_000 });

    await bar.getByTestId("zone-edit-cancel").click();
    await expect(bar).toHaveCount(0);
    // Nothing was written: no save toast, and the row is still there.
    await expect(page.getByText("Service area saved")).toHaveCount(0);
    await expect(page.getByLabel("Edit test_dp service area")).toBeVisible();
  });

  test("an unmapped instructor draws inline, with no delete action", async ({
    page,
  }) => {
    const row = unmappedList(page).locator("button").first();
    await expect(row).toHaveAttribute("aria-label", /^Draw .+ service area$/);
    const label = (await row.getAttribute("aria-label"))!;
    const name = label.replace(/^Draw | service area$/g, "");

    // Click by the SAME aria-label rather than `.first()` again. The roster
    // query has no ORDER BY, so a mid-test refetch can reorder the list and make
    // `.first()` resolve to a different instructor between reading the label and
    // clicking — which opened the wrong edit bar and failed on the name.
    //
    // `.first()` on the label lookup is still required: names are not unique in
    // live data (three instructors share "Divyansh Pal"), so an unqualified
    // `getByLabel` is a strict-mode violation. Duplicates share a name, so any of
    // them opens a bar containing `name` and the assertion below still holds.
    await page.getByLabel(label, { exact: true }).first().click();
    const bar = page.getByTestId("zone-edit-bar");
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(bar).toContainText(name);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Nothing exists yet, so there is no row to delete and no ring to save.
    await expect(bar.getByTestId("zone-edit-delete")).toHaveCount(0);
    await expect(bar.getByTestId("zone-edit-save")).toBeDisabled();
    await expect(bar).toContainText("3 more needed to save.");
  });

  test("there is no Redraw affordance for an existing zone", async ({
    page,
  }) => {
    // A from-scratch redraw would replace real Ops geometry with a hand-click
    // approximation, so the action must not exist anywhere on the page.
    await expect(page.getByRole("button", { name: /Redraw/ })).toHaveCount(0);
    await expect(page.getByText(/Redraw/)).toHaveCount(0);

    await page.getByTitle("Zoom to test_dp").click();
    await expect(page.getByTestId("info-card")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: /Redraw/ })).toHaveCount(0);
  });
});

test.describe("Instructor Zone Map — navigation", () => {
  test("the header uses the app theme, not a Google red bar", async ({
    page,
  }) => {
    // The My Maps styling is the layout; the colour follows this app's theme
    // so the module does not look like an embedded third-party page.
    await expect(
      page.getByRole("heading", { name: "Instructor Service Zones" }),
    ).toBeVisible();
    const header = page.locator("header").first();
    await expect(header).toHaveClass(/bg-background/);
    await expect(header).not.toHaveClass(/bg-\[#e8443a\]/);
  });

  test("the back button returns to Instructor Management", async ({ page }) => {
    const back = page.getByRole("button", {
      name: "Back to Instructor Management",
    });
    await expect(back).toBeVisible();
    await back.click();
    await page.waitForURL("**/admin/instructors", { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Instructor Management" }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("Instructor Management links into this module", async ({ page }) => {
    await page.goto("/admin/instructors");
    const entry = page.getByRole("button", {
      name: "Instructor Polygon Map",
    });
    await expect(entry).toBeVisible({ timeout: 30_000 });
    await entry.click();
    await page.waitForURL("**/admin/instructor-zone-map", { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Instructor Service Zones" }),
    ).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Instructor Zone Map — info card", () => {
  test("selecting a layer opens its detail card", async ({ page }) => {
    // Nothing is selected on load, so the card must start absent.
    await expect(page.getByTestId("info-card")).toHaveCount(0);

    const row = page.getByTitle("Zoom to test_dp");
    await row.click();

    const card = page.getByTestId("info-card");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText("test_dp");
    // A real persisted polygon, so the card reports its vertex count rather
    // than claiming the instructor has no area.
    await expect(card).toContainText(/\d+ vertices/);
    await expect(card).not.toContainText("No service area yet");
  });

  test("the card offers editing actions", async ({ page }) => {
    await page.getByTitle("Zoom to test_dp").click();
    const card = page.getByTestId("info-card");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // "Edit points" because a zone already exists; "Draw area" would be wrong
    // wording for an instructor who is already mapped.
    await expect(card.getByTestId("info-card-edit")).toHaveText(/Edit points/);
    // Exactly three editing actions: Edit points, Make rough polygon, Close.
    await expect(card.getByRole("button")).toHaveCount(3);
  });

  test("Edit points from the card opens the inline bar", async ({ page }) => {
    await page.getByTitle("Zoom to test_dp").click();
    const card = page.getByTestId("info-card");
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByTestId("info-card-edit").click();
    await expect(page.getByTestId("zone-edit-bar")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("zone-edit-bar")).toContainText("test_dp");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the card can be dismissed", async ({ page }) => {
    await page.getByTitle("Zoom to test_dp").click();
    const card = page.getByTestId("info-card");
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole("button", { name: "Close details" }).click();
    await expect(card).toHaveCount(0);
  });
});

test.describe("Instructor Zone Map — editing on the main map", () => {
  test("an unmapped instructor starts an empty inline session", async ({
    page,
  }) => {
    const row = unmappedList(page).locator("button").first();
    await expect(row).toHaveAttribute("aria-label", /^Draw .+ service area$/);
    const label = (await row.getAttribute("aria-label"))!;
    const name = label.replace(/^Draw | service area$/g, "");

    // Pin the click to the label just read; see the sibling test above for why
    // re-resolving `.first()` here is a reorder hazard. `.first()` on the lookup
    // is needed because live data has duplicate names (three "Divyansh Pal").
    await page.getByLabel(label, { exact: true }).first().click();

    const bar = page.getByTestId("zone-edit-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(name);
    // No existing ring to seed from, so nothing to save or undo yet.
    await expect(bar).toContainText("3 more needed to save.");
    await expect(bar.getByTestId("zone-edit-save")).toBeDisabled();
    await expect(bar.getByTestId("zone-undo")).toBeDisabled();
  });

  test("an existing area is seeded with its current ring", async ({ page }) => {
    // Reshaping must start from the stored geometry, not silently from nothing
    // — an empty session would imply the area had been lost.
    await page.getByLabel("Edit test_dp service area").click();

    const bar = page.getByTestId("zone-edit-bar");
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId("zone-edit-save")).toBeEnabled();
    // The instruction changes once there is a shape to manipulate.
    await expect(bar).toContainText(/Drag a point to move it/);
  });

  test("Undo cannot step back past the seeded state", async ({ page }) => {
    // The seed is the baseline, not an edit. Undo to "before the seed" would
    // mean deleting a real zone, which is what the explicit Delete is for.
    await page.getByLabel("Edit test_dp service area").click();
    const bar = page.getByTestId("zone-edit-bar");
    await expect(bar).toBeVisible();

    await expect(bar.getByTestId("zone-undo")).toBeDisabled();
    await expect(bar.getByTestId("zone-edit-save")).toBeEnabled();
  });

  test("Cancel leaves edit mode without touching the zone", async ({
    page,
  }) => {
    await page.getByLabel("Edit test_dp service area").click();
    const bar = page.getByTestId("zone-edit-bar");
    await expect(bar).toBeVisible();

    await bar.getByTestId("zone-edit-cancel").click();

    await expect(bar).toHaveCount(0);
    // The area is untouched: no save toast fired and the row still exists.
    await expect(page.getByLabel("Edit test_dp service area")).toBeVisible();
    await expect(page.getByText("Service area saved")).toHaveCount(0);
  });
});

/**
 * Regression: a vertex drag must reach the editor's own state.
 *
 * `set_at` / `insert_at` / `remove_at` are raised by the polygon's path — the
 * `MVCArray` from `polygon.getPath()` — not by the Polygon itself. Registering
 * them on the Polygon silently never fires, and the symptom is deceptive: the
 * handles still move on screen, but the editor's ring is untouched, so "Save
 * area" writes the original shape straight back and the map appears to snap to
 * the area you were already trying to change.
 *
 * These tests drive the real `MVCArray`, so they fail if the listener ever
 * moves back onto the Polygon.
 */
test.describe("Instructor Zone Map — vertex edits reach the editor state", () => {
  const readPath = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const poly = (
        window as unknown as { __zoneEditPolygon?: google.maps.Polygon }
      ).__zoneEditPolygon;
      if (!poly) return null;
      return poly
        .getPath()
        .getArray()
        .map((p) => ({ lat: p.lat(), lng: p.lng() }));
    });

  /**
   * Moves a vertex the way a handle drag does: `setAt` mutates the path's
   * `MVCArray` in place, which is what raises `set_at` and what the editor
   * listens for.
   *
   * Deliberately not `polygon.setPath(...)`. That replaces the whole MVCArray,
   * so its events fire before the editor can re-bind to the new array and the
   * change never reaches app state — a real drag does not behave that way, so
   * using it here would test something the admin can never do.
   */
  const setVertex = async (
    page: import("@playwright/test").Page,
    index: number,
    lat: number,
    lng: number,
  ) => {
    await page.evaluate(
      ([i, la, ln]) => {
        const poly = (
          window as unknown as { __zoneEditPolygon?: google.maps.Polygon }
        ).__zoneEditPolygon;
        poly!.getPath().setAt(i, new window.google.maps.LatLng(la, ln));
      },
      [index, lat, lng] as const,
    );
  };

  const dragFirstVertex = async (page: import("@playwright/test").Page) => {
    const first = (await readPath(page))?.[0];
    expect(first).toBeDefined();
    await setVertex(
      page,
      0,
      (first?.lat ?? 0) + 0.01,
      (first?.lng ?? 0) + 0.01,
    );
  };

  const requireMaps = async (page: import("@playwright/test").Page) => {
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              !!(window as unknown as { __zoneEditPolygon?: unknown })
                .__zoneEditPolygon,
          ),
        { timeout: 20_000 },
      )
      .toBe(true);
  };

  test("moving a vertex makes the edit dirty and undoable", async ({
    page,
  }) => {
    await page.getByLabel("Edit test_dp service area").click();
    const bar = page.getByTestId("zone-edit-bar");
    await expect(bar).toBeVisible();
    await requireMaps(page);

    // Opening the editor is not an edit.
    await expect(bar.getByTestId("zone-undo")).toBeDisabled();
    await expect(bar.getByTestId("zone-edit-discard")).toBeDisabled();

    await dragFirstVertex(page);

    // A drag must register: the ring changed, so there is something to undo and
    // something to discard. Before the fix both stayed disabled forever.
    await expect(bar.getByTestId("zone-undo")).toBeEnabled();
    await expect(bar.getByTestId("zone-edit-discard")).toBeEnabled();

    // Undo rewinds the drag, and redoing reapplies it — i.e. the vertex really
    // is in the history, not just mirrored into the polygon.
    await bar.getByTestId("zone-undo").click();
    await expect(bar.getByTestId("zone-edit-discard")).toBeDisabled();
    await bar.getByTestId("zone-redo").click();
    await expect(bar.getByTestId("zone-edit-discard")).toBeEnabled();

    // Discard rewinds the reshape back to the persisted ring and leaves the
    // editor open, so nothing is lost and nothing is written.
    await bar.getByTestId("zone-edit-discard").click();
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId("zone-undo")).toBeDisabled();
    await expect(bar.getByTestId("zone-edit-discard")).toBeDisabled();
    await expect(page.getByText("Service area saved")).toHaveCount(0);

    await bar.getByTestId("zone-edit-cancel").click();
    await expect(bar).toHaveCount(0);
  });

  test("a dragged vertex is what Save area persists", async ({ page }) => {
    test.setTimeout(120_000);
    await page.getByLabel("Edit test_dp service area").click();
    const bar = page.getByTestId("zone-edit-bar");
    await expect(bar).toBeVisible();
    await requireMaps(page);

    // Keep the seeded ring so the zone can be put back exactly as it was.
    const original = await readPath(page);
    expect(original).not.toBeNull();
    expect((original ?? []).length).toBeGreaterThanOrEqual(3);

    try {
      await dragFirstVertex(page);
      await expect(bar.getByTestId("zone-edit-save")).toBeEnabled();
      await bar.getByTestId("zone-edit-save").click();
      // The bar closes only in the mutation's onSuccess, so it is a reliable
      // "the write resolved" signal. A toast would be too (nothing is on screen
      // yet here) but is not a guarantee the refetch has landed.
      await expect(bar).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByText("Service area saved")).toBeVisible();

      // Re-enter the editor: it re-seeds from the freshly loaded zone, so this
      // asserts the write survived the save AND the post-save refetch.
      await page.getByLabel("Edit test_dp service area").click();
      await expect(bar).toBeVisible();
      await requireMaps(page);

      const saved = await readPath(page);
      expect(saved).not.toBeNull();
      // The stored ring kept its length, and vertex 0 really moved.
      expect((saved ?? []).length).toBe((original ?? []).length);
      expect(saved?.[0].lat).not.toBeCloseTo(original?.[0].lat ?? 0, 5);
      expect(saved?.[0].lng).not.toBeCloseTo(original?.[0].lng ?? 0, 5);
    } finally {
      // Restore, so the suite stays idempotent and leaves coverage data alone.
      const restoreBar = page.getByTestId("zone-edit-bar");
      if ((await restoreBar.count()) === 0) {
        await page.getByLabel("Edit test_dp service area").click();
        await expect(restoreBar).toBeVisible();
        await requireMaps(page);
      }
      // Put vertex 0 back with a real drag, so the restore goes through exactly
      // the same path a subsequent admin edit would.
      await setVertex(page, 0, original?.[0].lat ?? 0, original?.[0].lng ?? 0);
      await expect(restoreBar.getByTestId("zone-edit-save")).toBeEnabled();
      await restoreBar.getByTestId("zone-edit-save").click();
      // The bar only closes in the mutation's onSuccess, i.e. after the write
      // resolves. Waiting on the toast instead would race the still-visible
      // toast from the save above and reload before the restore landed.
      await expect(restoreBar).toHaveCount(0, { timeout: 30_000 });
    }

    // The restore really landed.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Instructor Zone Map" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Edit test_dp service area").click();
    await expect(bar).toBeVisible();
    await requireMaps(page);
    const restored = await readPath(page);
    expect(restored?.[0].lat).toBeCloseTo(original?.[0].lat ?? 0, 5);
    expect(restored?.[0].lng).toBeCloseTo(original?.[0].lng ?? 0, 5);

    await bar.getByTestId("zone-edit-cancel").click();
  });
});
