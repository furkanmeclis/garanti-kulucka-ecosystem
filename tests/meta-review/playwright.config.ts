import { defineConfig, devices } from "@playwright/test";

/**
 * Meta App Review screencasts (apps/web-beta). Specs use the `*.review.ts` suffix so neither
 * `playwright test` (root) nor the beta config picks them up. Runs against the e2e build served by
 * `vite preview`; the backend is mocked per scenario with page.route (see recording.ts).
 */
const port = 4320;
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
const size = { width: 1440, height: 900 };

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.review.ts",
  outputDir: "../../test-results/meta-review",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["Desktop Chrome"],
    viewport: size,
    video: { mode: "on", size },
    screenshot: "off",
    trace: "off",
    locale: "en-GB",
    timezoneId: "Europe/Istanbul",
    serviceWorkers: "block",
    launchOptions: { slowMo: 150, ...(executablePath ? { executablePath } : {}) },
  },
  webServer: {
    command: `npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "../../apps/web-beta",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
