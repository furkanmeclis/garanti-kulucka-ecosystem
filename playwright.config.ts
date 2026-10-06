import { defineConfig } from "@playwright/test";

/**
 * Main web/API browser suite (`npm run test:e2e:playwright`). CI uploads the HTML report and
 * per-test screenshots (traces and videos only for failures) as a workflow artifact.
 */
export default defineConfig({
  testDir: "tests/playwright",
  outputDir: "test-results/playwright",
  reporter: [["list"], ["html", { outputFolder: "playwright-report/main", open: "never" }]],
  use: {
    screenshot: "on",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
