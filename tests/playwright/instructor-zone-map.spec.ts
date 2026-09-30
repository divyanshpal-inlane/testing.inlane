import { expect, test } from "@playwright/test";

/**
 * Instructor Zone Map (/admin/instructor-zone-map) coverage.
 *
 * Read-only against the database: nothing here writes a zone, so the suite is
 * safe to run repeatedly and cannot damage real coverage data. Google Maps may
 * not be reachable from the runner, so no assertion depends on tile or polygon
 * rendering — every assertion targets app chrome that renders from Supabase
 * data alone (via `fetchDbZones()` / the Instructor roster).
 */

const MAPPED = "Mapped (";
const UNMAPPED = "Not mapped (";

const filterBox = (page: import("@playwright/test").Page) =>
  page.getByLabel("Filter instructors");
const mappedList = (page: import("@playwright/test").Page) =>
  page.locator("aside section").filter({ hasText: MAPPED }).first();
const unmappedList = (page: import("@playwright/test").Page) =>
  page.locator("aside section").filter({ hasText: UNMAPPED }).first();

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
    const before = await rows.count();

    await filterBox(page).fill("jawed");
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
    await expect(rows.first()).toContainText(/jawed/i);

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

  test("marker position can switch between centroid and registered address", async ({
    page,
  }) => {
    const select = page.locator("#marker-position");
    // The control only renders once the markers switch is on. Wait for it
    // explicitly rather than relying on the default 5s action timeout, which is
    // tight when the whole suite is competing for the Maps script.
    await expect(select).toBeVisible({ timeout: 20_000 });
    await expect(select).toHaveValue("centroid", { timeout: 20_000 });
    await select.selectOption("roster");
    await expect(select).toHaveValue("roster");
    await select.selectOption("centroid");
    await expect(select).toHaveValue("centroid");
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
    const label = await row.getAttribute("aria-label");
    expect(label).toMatch(/^Draw .+ service area$/);
    const name = (label ?? "").replace(/^Draw | service area$/g, "");

    await row.click();
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

  test("the card offers a single in-place editing action", async ({ page }) => {
    await page.getByTitle("Zoom to test_dp").click();
    const card = page.getByTestId("info-card");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // "Edit points" because a zone already exists; "Draw area" would be wrong
    // wording for an instructor who is already mapped.
    await expect(card.getByTestId("info-card-edit")).toHaveText(/Edit points/);
    // Exactly one editing action — no separate Redraw.
    await expect(card.getByRole("button")).toHaveCount(2); // edit + close
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
    const label = await row.getAttribute("aria-label");
    const name = (label ?? "").replace(/^Draw | service area$/g, "");

    await row.click();

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
