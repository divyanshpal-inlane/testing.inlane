import { defineConfig, devices } from "@playwright/test";

// Frontend Playwright suite for the Sales Dashboard / Instructor Management
// tentative-booking system -- see tests.md for the checklist this
// implements, and tests/playwright/README.md for how auth works.
export default defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Production-style build + `vite preview`, NOT `pnpm run dev`.
  // React.StrictMode (enabled in main.tsx) deliberately double-invokes
  // effects in dev mode only, which produced a real-looking but
  // non-reproducible-in-production failure the first time this suite ran
  // against the dev server (a component's own useRef guard, set by one
  // effect and read by another, isn't reset between StrictMode's phantom
  // mount/cleanup/remount cycle the same way it would be by two genuinely
  // separate mounts -- confirmed by testing the exact same flow against a
  // production build, where it passed). Testing against what's actually
  // shipped avoids that entire class of false positive.
  // reuseExistingServer reuses an already-running preview server if one
  // happens to be up; otherwise builds and serves fresh.
  webServer: {
    command: "pnpm run build && pnpm run serve",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/playwright/.auth/admin.json",
      },
      dependencies: ["setup"],
    },
  ],
});
