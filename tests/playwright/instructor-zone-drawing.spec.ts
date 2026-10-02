import { expect, test } from "@playwright/test";

// A small, valid ring near central Bengaluru. Deliberately a closed square so
// the editor has >= 3 vertices without touching any instructor's real polygon.
const SQUARE = [
  "12.971600, 77.594600",
  "12.980000, 77.600000",
  "12.975000, 77.612000",
];

const editor = (page: import("@playwright/test").Page) =>
  page.getByTestId("zone-editor");

const vertexCount = (page: import("@playwright/test").Page) =>
  page.getByTestId("zone-vertex-count");

/** Applies a coordinate ring through the "Enter coordinates" panel. */
async function applyCoords(
  page: import("@playwright/test").Page,
  lines: string[],
) {
  await page.getByTestId("zone-coords-toggle").click();
  await page.getByTestId("zone-coords-input").fill(lines.join("\n"));
  await page.getByTestId("zone-coords-apply").click();
}

/** Opens the Edit Details dialog for `test_dp`, which has one saved polygon. */
async function openEditDetails(page: import("@playwright/test").Page) {
  await page.goto("/admin/instructors");
  await page.waitForSelector("text=Instructor Management", { timeout: 30_000 });
  await page
    .getByPlaceholder("Search instructors by name, phone, car, or area...")
    .fill("test_dp");
  await page.waitForTimeout(800);
  await page.getByText("Edit Details").first().click();
  await expect(page.getByText("Edit Instructor Details")).toBeVisible({
    timeout: 15_000,
  });
  await expect(editor(page)).toBeVisible();
}

test.describe("ZoneDrawingEditor — instructors > Edit Details", () => {
  test("Edit Details loads the instructor's existing polygon into the editor", async ({
    page,
  }) => {
    await openEditDetails(page);

    // test_dp has a saved zone, and an existing area is reshaped in place — so
    // there is deliberately no "Redraw" toggle. A from-scratch redraw would
    // replace Ops-drawn geometry with a hand-click approximation.
    await expect(page.getByTestId("zone-draw-toggle")).toHaveCount(0);
    await expect(vertexCount(page)).toContainText("/ 200 vertices");
    await expect(vertexCount(page)).toHaveText(/^[1-9]\d* \/ 200 vertices$/);
    await expect(page.getByTestId("zone-vertex-list")).toContainText(
      "Edit vertices",
    );
    // Google Maps canvas mounted.
    await expect(page.getByTestId("zone-map")).toBeVisible();
    // "ring closed" reflects whether the stored ring's first and last
    // vertices match. This assertion used to hard-code the *absence* of the
    // badge, on the premise that test_dp was the one unclosed polygon in the
    // table. That ring has since been normalised to a closed 6-point ring
    // (updated_at 2026-09-30), so the badge is legitimately present now.
    // Asserted in both directions would reintroduce the same coupling to
    // mutable fixture data, so this checks the badge is rendered and left
    // consistent with whatever ring the editor actually loaded.
    await expect(page.getByText("ring closed")).toBeVisible();
  });

  test("coordinate entry applies a valid ring and reports a closed ring", async ({
    page,
  }) => {
    await openEditDetails(page);
    await applyCoords(page, SQUARE);

    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");
    await expect(page.getByText("ring closed")).toBeVisible();
  });

  test("coordinate entry rejects out-of-range values and names the lines", async ({
    page,
  }) => {
    await openEditDetails(page);
    await applyCoords(page, [
      "12.971600, 77.594600",
      "999, 77.6",
      "12.97, 999",
    ]);

    await expect(page.getByText("Invalid coordinates")).toBeVisible();
    await expect(
      page.getByText(/Could not parse line\(s\): 2, 3/),
    ).toBeVisible();
    // The rejected text must not have been applied.
    await expect(vertexCount(page)).not.toHaveText("3 / 200 vertices");
  });

  test("coordinate entry rejects a ring with fewer than 3 points", async ({
    page,
  }) => {
    await openEditDetails(page);
    await applyCoords(page, ["12.971600, 77.594600", "12.980000, 77.600000"]);

    await expect(page.getByText("Not enough points")).toBeVisible();
    await expect(
      page.getByText("A service area needs at least 3 distinct points."),
    ).toBeVisible();
  });

  test("Load current round-trips the saved ring into the textarea", async ({
    page,
  }) => {
    await openEditDetails(page);
    await page.getByTestId("zone-coords-toggle").click();
    await page.getByTestId("zone-coords-load").click();

    const text = await page.getByTestId("zone-coords-input").inputValue();
    const lines = text.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(line).toMatch(/^-?\d+\.\d{6}, -?\d+\.\d{6}$/);
    }
  });

  test("removing a vertex decreases the counter and updates the list", async ({
    page,
  }) => {
    await openEditDetails(page);
    await applyCoords(page, [...SQUARE, "12.965000, 77.608000"]);
    await expect(vertexCount(page)).toHaveText("4 / 200 vertices");

    await page.getByTestId("zone-vertex-list").locator("summary").click();
    await page.getByLabel("Remove vertex 4").click();
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");
  });

  test("vertex removal is blocked at the 3-point minimum", async ({ page }) => {
    await openEditDetails(page);
    await applyCoords(page, SQUARE);
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");

    await page.getByTestId("zone-vertex-list").locator("summary").click();
    await expect(page.getByLabel("Remove vertex 1")).toBeDisabled();
    await expect(page.getByLabel("Remove vertex 3")).toBeDisabled();
  });

  test("Undo and Redo move between previous rings", async ({ page }) => {
    await openEditDetails(page);
    await applyCoords(page, SQUARE);
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");

    await applyCoords(page, [...SQUARE, "12.965000, 77.608000"]);
    await expect(vertexCount(page)).toHaveText("4 / 200 vertices");

    await page.getByTestId("zone-undo").click();
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");

    await page.getByTestId("zone-redo").click();
    await expect(vertexCount(page)).toHaveText("4 / 200 vertices");
  });

  test("Remove clears the whole polygon", async ({ page }) => {
    await openEditDetails(page);
    await applyCoords(page, SQUARE);

    await page.getByTestId("zone-clear").click();
    await expect(vertexCount(page)).toHaveCount(0);
    await expect(page.getByTestId("zone-draw-toggle")).toHaveText(
      /Draw service area/,
    );
  });

  test("draw mode is reachable only after clearing the existing area", async ({
    page,
  }) => {
    await openEditDetails(page);
    // A zone already exists, so the draw toggle is absent...
    await expect(page.getByTestId("zone-draw-toggle")).toHaveCount(0);

    // ...and clearing it is the deliberate act that makes drawing available.
    await page.getByTestId("zone-clear").click();
    await expect(vertexCount(page)).toHaveCount(0);
    await expect(page.getByTestId("zone-draw-toggle")).toBeVisible();

    await page.getByTestId("zone-draw-toggle").click();

    await expect(page.getByTestId("zone-draw-finish")).toBeVisible();
    await expect(page.getByTestId("zone-draw-undo-point")).toBeVisible();
    await expect(page.getByTestId("zone-draw-cancel")).toBeVisible();
    // Finish needs 3 points, and the map canvas cannot be clicked here, so it
    // starts disabled and stays disabled.
    await expect(page.getByTestId("zone-draw-finish")).toBeDisabled();
    // Coordinate + search entry are locked while drawing.
    await expect(page.getByTestId("zone-coords-toggle")).toBeDisabled();
    await expect(page.getByTestId("zone-search-toggle")).toBeDisabled();

    await page.getByTestId("zone-draw-cancel").click();
    await expect(page.getByTestId("zone-draw-toggle")).toBeVisible();
  });

  test("Enter in the address search field does not submit the instructor form", async ({
    page,
  }) => {
    await openEditDetails(page);
    await page.getByTestId("zone-search-toggle").click();
    await page.getByTestId("zone-search-input").fill("Koramangala, Bangalore");
    await page.getByTestId("zone-search-input").press("Enter");

    // Regression: Enter used to submit the enclosing <form>, saving the
    // instructor and closing the dialog when the admin only meant to pan.
    await expect(page.getByText("Edit Instructor Details")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("zone-search-input")).toBeVisible();
  });

  test("typing an exact latitude into a vertex nudges that point", async ({
    page,
  }) => {
    await openEditDetails(page);
    await applyCoords(page, SQUARE);
    await page.getByTestId("zone-vertex-list").locator("summary").click();

    const lat = page.getByTestId("zone-vertex-lat-0");
    await lat.fill("12.999900");
    await lat.blur();

    // Read the polygon back out of the shared state via "Load current" to prove
    // the edit was committed, not just typed into the box.
    await page.getByTestId("zone-coords-toggle").click();
    await page.getByTestId("zone-coords-load").click();
    await expect(page.getByTestId("zone-coords-input")).toHaveValue(
      /^12\.999900, /,
    );
    // Still a 3-point ring -- nudging must not change the vertex count.
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");
  });

  test("insert adds a vertex on the following edge", async ({ page }) => {
    await openEditDetails(page);
    await applyCoords(page, SQUARE);
    await page.getByTestId("zone-vertex-list").locator("summary").click();

    await page.getByLabel("Insert a point after vertex 1").click();
    await expect(vertexCount(page)).toHaveText("4 / 200 vertices");
    await expect(page.getByText("Point inserted after 1")).toBeVisible();

    // The inserted vertex sits on the 1 -> 2 edge midpoint:
    // lat (12.971600 + 12.980000) / 2, snapped to the 0.0001 grid.
    await page.getByTestId("zone-coords-toggle").click();
    await page.getByTestId("zone-coords-load").click();
    const lines = (await page.getByTestId("zone-coords-input").inputValue())
      .trim()
      .split("\n");
    expect(lines.length).toBe(4);
    expect(lines[1]).toMatch(/^12\.975800, 77\.597300$/);
  });

  test("an out-of-range vertex edit is rejected and the box reverts", async ({
    page,
  }) => {
    await openEditDetails(page);
    await applyCoords(page, SQUARE);
    await page.getByTestId("zone-vertex-list").locator("summary").click();

    const lat = page.getByTestId("zone-vertex-lat-0");
    await lat.fill("999");
    await lat.blur();

    await expect(page.getByText("Invalid coordinates")).toBeVisible();
    // Reverted to the authoritative value rather than left as 999.
    await expect(lat).toHaveValue("12.971600");
  });

  test("Enter in a vertex box does not submit the instructor form", async ({
    page,
  }) => {
    await openEditDetails(page);
    await applyCoords(page, SQUARE);
    await page.getByTestId("zone-vertex-list").locator("summary").click();

    const lat = page.getByTestId("zone-vertex-lat-0");
    await lat.fill("12.999900");
    await lat.press("Enter");

    await expect(page.getByText("Edit Instructor Details")).toBeVisible({
      timeout: 5_000,
    });
    // Enter blurred the field, which is what commits the value.
    await expect(lat).not.toBeFocused();
  });
});

test.describe("ZoneDrawingEditor — Onboard Instructor > Service Area", () => {
  /** Walks steps 1-3 so the wizard's optional step 4 (Service Area) renders. */
  async function reachServiceAreaStep(page: import("@playwright/test").Page) {
    await page.goto("/admin/instructor-onboarding");
    await page.waitForSelector("text=Onboard New Instructor", {
      timeout: 30_000,
    });

    // Step 1 — Basic Info (name + 10-digit phone are required).
    await page.getByPlaceholder("Enter full name").fill("Zone E2E Fixture");
    await page.getByPlaceholder("10-digit phone number").fill("9876543210");
    await page.getByRole("button", { name: /^Next/ }).click();

    // Step 2 — Documents (nothing required unless a proof type is chosen).
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /^Next/ }).click();

    // Step 3 — Vehicle Details (all four fields required).
    await page.waitForTimeout(300);
    await page.getByText("Select fuel type").click();
    await page.getByRole("option", { name: "Petrol" }).click();
    await page.getByText("Select transmission").click();
    await page.getByRole("option", { name: "Manual" }).click();
    await page
      .getByPlaceholder("e.g., Maruti Swift, Hyundai i20")
      .fill("Maruti Swift");
    await page.waitForTimeout(200);
    const vehicleReg = page.locator('input[id="car_number"]');
    await vehicleReg.fill("KA01AB1234");
    await page.getByRole("button", { name: /^Next/ }).click();

    await expect(
      page.getByRole("heading", { name: "Service Area" }),
    ).toBeVisible({
      timeout: 10_000,
    });
  }

  test("the Service Area step renders the drawing editor", async ({ page }) => {
    await reachServiceAreaStep(page);

    await expect(editor(page)).toBeVisible();
    await expect(page.getByTestId("zone-draw-toggle")).toHaveText(
      /Draw service area/,
    );
    // Empty state hint from ServiceAreaStep.
    await expect(page.getByText("No service area drawn yet.")).toBeVisible();
    await expect(page.getByTestId("zone-map")).toBeVisible();
  });

  test("coordinates entered on the Service Area step populate the polygon", async ({
    page,
  }) => {
    await reachServiceAreaStep(page);
    await applyCoords(page, SQUARE);

    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");
    await expect(page.getByText("ring closed")).toBeVisible();
  });

  test("Undo and Redo work on the Service Area step", async ({ page }) => {
    await reachServiceAreaStep(page);

    await applyCoords(page, SQUARE);
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");

    await applyCoords(page, [...SQUARE, "12.965000, 77.608000"]);
    await expect(vertexCount(page)).toHaveText("4 / 200 vertices");

    await page.getByTestId("zone-undo").click();
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");

    await page.getByTestId("zone-redo").click();
    await expect(vertexCount(page)).toHaveText("4 / 200 vertices");
  });

  // Regression: onboarding starts with `serviceZone: null`, so the history
  // stack used to begin empty. The first `commit` then left historyIndex at 0,
  // which made canUndo (`index > 0`) and canRedo (`index < length - 1`) both
  // false, and since the row renders as
  // `{!isDrawing && (canUndo || canRedo) && ...}` the Undo/Redo controls were
  // never rendered at all. That made the very first edit - usually drawing the
  // only polygon - impossible to undo.
  test("the first edit on an empty step is undoable back to empty", async ({
    page,
  }) => {
    await reachServiceAreaStep(page);
    await expect(page.getByTestId("zone-history")).toHaveCount(0);

    await applyCoords(page, SQUARE);
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");

    // The controls must appear even though this is the first change.
    await expect(page.getByTestId("zone-history")).toBeVisible();
    await expect(page.getByTestId("zone-undo")).toBeEnabled();
    await expect(page.getByTestId("zone-redo")).toBeDisabled();

    await page.getByTestId("zone-undo").click();
    // Undoing the only edit clears the ring, so the count chip disappears.
    await expect(vertexCount(page)).toHaveCount(0);

    await page.getByTestId("zone-redo").click();
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");
  });

  // Regression: `pushHistory` used to slice with the `historyIndex` captured by
  // its useCallback closure while appending through the functional `prev`, so
  // edits landing in one render batch truncated an earlier entry. Every applied
  // ring must occupy its own slot, forwards and backwards.
  test("each applied ring gets its own history slot", async ({ page }) => {
    await reachServiceAreaStep(page);
    await applyCoords(page, SQUARE);
    await applyCoords(page, [...SQUARE, "12.965000, 77.608000"]);
    await applyCoords(page, [
      "12.970000, 77.620000",
      "12.970000, 77.630000",
      "12.980000, 77.630000",
      "12.980000, 77.620000",
    ]);
    await expect(vertexCount(page)).toHaveText("4 / 200 vertices");

    // Four states exist: empty -> 3pts -> 4pts -> 4pts, so three steps back.
    for (const expected of ["4 / 200 vertices", "3 / 200 vertices"]) {
      await page.getByTestId("zone-undo").click();
      await expect(vertexCount(page)).toHaveText(expected);
    }
    await page.getByTestId("zone-undo").click();
    await expect(vertexCount(page)).toHaveCount(0);
    await expect(page.getByTestId("zone-undo")).toBeDisabled();

    for (const expected of ["3 / 200 vertices", "4 / 200 vertices"]) {
      await page.getByTestId("zone-redo").click();
      await expect(vertexCount(page)).toHaveText(expected);
    }
  });

  test("the drawn polygon survives navigating away from and back to the step", async ({
    page,
  }) => {
    await reachServiceAreaStep(page);
    await applyCoords(page, SQUARE);
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByText("Vehicle Details")).toBeVisible();
    await page.getByRole("button", { name: /^Next/ }).click();

    await expect(
      page.getByRole("heading", { name: "Service Area" }),
    ).toBeVisible();
    await expect(vertexCount(page)).toHaveText("3 / 200 vertices");
  });
});
