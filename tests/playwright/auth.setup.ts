import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { test as setup, expect } from "@playwright/test";

// Logs in once via the admin bypass route and saves the session so every
// other spec reuses it (playwright.config.ts's chromium project loads this
// storageState) instead of logging in again per test file.
//
// Credentials live in tests/playwright-credentials.local.json, gitignored
// (real account credentials, never commit) -- see .gitignore.
const authFile = "tests/playwright/.auth/admin.json";
const credsPath = path.resolve(
  process.cwd(),
  "tests/playwright-credentials.local.json",
);

setup("authenticate", async ({ page }) => {
  if (!existsSync(credsPath)) {
    throw new Error(
      `Missing ${credsPath}. Create it with {"phone": "...", "password": "...", "loginPath": "/admin-byser-secu7"} before running the Playwright suite.`,
    );
  }
  const creds = JSON.parse(readFileSync(credsPath, "utf8"));

  await page.goto(creds.loginPath);
  await page.getByPlaceholder("Phone number").fill(creds.phone);
  await page.getByPlaceholder("Password").fill(creds.password);
  await page.getByRole("button", { name: "Login" }).click();

  // The bypass route lands on /admin (a dashboard of admin tool links), not
  // straight into any one tool -- confirms auth succeeded generically
  // rather than depending on Sales-Dashboard-specific markup here.
  await page.waitForURL(/\/admin\/?$/, { timeout: 15_000 });
  await expect(page.getByText(/Logged in as/i)).toBeVisible();

  await page.context().storageState({ path: authFile });
});
