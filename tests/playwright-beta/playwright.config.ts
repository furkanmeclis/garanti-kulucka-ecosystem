import { defineConfig, devices } from "@playwright/test";

/**
 * Beta panel E2E (apps/web-beta). Specs use the `*.beta.ts` suffix so the existing
 * `playwright test tests/playwright` command never picks them up.
 * Runs against the production build (`build:e2e`) served by `vite preview`, so the real
 * service worker and manifest are exercised; the backend is mocked per test with page.route.
 */
const port = 4319;
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.beta.ts",
  outputDir: "../../test-results/playwright-beta",
  timeout: 60_000,
  fullyParallel: true,
  reporter: [["list"], ["html", { outputFolder: "../../playwright-report/beta", open: "never" }]],
  use: {
    screenshot: "on",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["Desktop Chrome"],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "../../apps/web-beta",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
