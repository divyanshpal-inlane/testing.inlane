import { expect, type Page, test } from "@playwright/test";

async function openCreateLearnerDialog(page: Page) {
  await page.goto("/admin/learner-management");
  await page.getByRole("button", { name: "Create New Learner" }).click();
  await expect(
    page.getByRole("heading", { name: "Create New Learner" }),
  ).toBeVisible();
}

async function selectCaseType(page: Page, label: string) {
  await page.getByLabel("Case Type").click();
  await page.getByRole("option", { name: label }).click();
}

test.describe("Create New Learner case types", () => {
  test.beforeEach(async ({ page }) => {
    await openCreateLearnerDialog(page);
  });

  test("Classes Only keeps the production course flow enabled", async ({
    page,
  }) => {
    await expect(page.getByLabel("Vehicle")).toBeVisible();
    await expect(page.getByLabel("Course Type")).toBeVisible();
    await expect(page.getByLabel("Amount (₹)")).toBeVisible();
    await expect(page.getByLabel("Payment Type")).toBeVisible();
    await expect(page.getByLabel("Has a 4-wheeler license")).toBeVisible();
    await expect(
      page.getByLabel("Has a 2-wheeler license, not 4-wheeler"),
    ).toBeVisible();
    await expect(
      page.getByLabel("License address change required"),
    ).toBeVisible();
    await expect(page.getByLabel("RTO Fee (₹)")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create Learner", exact: true }),
    ).toBeEnabled();
  });

  test("RTO Only hides course fields and disables payment actions", async ({
    page,
  }) => {
    await selectCaseType(page, "RTO Only");

    await expect(page.getByLabel("Vehicle")).not.toBeVisible();
    await expect(page.getByLabel("Course Type")).not.toBeVisible();
    await expect(page.getByLabel("Amount (₹)")).not.toBeVisible();
    await expect(page.getByLabel("Has a 4-wheeler license")).not.toBeVisible();
    await expect(page.getByLabel("2-Wheeler Licence")).toBeVisible();
    await expect(page.getByLabel("4-Wheeler Licence")).toBeVisible();
    await expect(page.getByLabel("RTO Fee (₹)")).toBeVisible();
    await expect(page.getByLabel("Payment Type")).toBeDisabled();
    await expect(
      page.getByText(
        "RTO payment processing is not supported yet. This saves the learner and enrollment details, but no payment link will be created or sent.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create Learner", exact: true }),
    ).toBeEnabled();
  });

  test("combined case preserves learner/course fields and clears hidden RTO fields", async ({
    page,
  }) => {
    await page.getByLabel("Name").fill("Prototype Learner");
    await page.getByLabel("Email").fill("prototype@example.com");
    await page.getByLabel("Phone").fill("9876543210");
    await page.getByLabel("Vehicle").click();
    await page.getByRole("option", { name: "4-Wheeler" }).click();

    await selectCaseType(page, "Lessons with RTO Services");

    await expect(page.getByLabel("Name")).toHaveValue("Prototype Learner");
    await expect(page.getByLabel("Email")).toHaveValue("prototype@example.com");
    await expect(page.getByLabel("Phone")).toHaveValue("9876543210");
    await expect(page.getByLabel("Vehicle")).toContainText("4-Wheeler");
    await expect(page.getByLabel("Course Type")).toBeVisible();
    await expect(page.getByLabel("2-Wheeler Licence")).toBeVisible();
    await expect(page.getByLabel("RTO Fee (₹)")).toBeVisible();
    await expect(page.getByLabel("Payment Type")).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Create Learner", exact: true }),
    ).toBeEnabled();

    await page.getByLabel("2-Wheeler Licence").click();
    await page.getByRole("option", { name: "DL", exact: true }).click();
    await page.locator("#prototypeAddressChange").check();
    await page.getByLabel("RTO Fee (₹)").fill("2500");

    await selectCaseType(page, "Classes Only");
    await expect(page.getByLabel("RTO Fee (₹)")).not.toBeVisible();
    await expect(page.getByLabel("Vehicle")).toContainText("4-Wheeler");

    await selectCaseType(page, "Lessons with RTO Services");
    await expect(page.getByLabel("2-Wheeler Licence")).toContainText(
      "Not Required",
    );
    await expect(page.getByLabel("Address Change")).not.toBeVisible();
    await expect(page.getByLabel("RTO Fee (₹)")).toHaveValue("");
  });
});
