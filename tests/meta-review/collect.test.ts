import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collect, EXPECTED_PERMISSIONS, findManifests, findPlaywrightFfmpeg } from "../../tools/meta-review-collect.mjs";

function fakeResults() {
  const root = mkdtempSync(join(tmpdir(), "meta-review-"));
  const dir = join(root, "instagram-insights-review-instagram-business-manage-insights-chromium");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta-review.json"), JSON.stringify({ permission: "instagram_business_manage_insights", title: "t" }));
  writeFileSync(join(dir, "video.webm"), "webm");
  return root;
}

describe("meta-review-collect", () => {
  it("finds manifests under the results root", () => {
    const root = fakeResults();
    expect(findManifests(root)).toEqual([{ dir: expect.stringContaining("instagram-insights"), permission: "instagram_business_manage_insights", title: "t" }]);
  });

  it("copies videos by permission and reports missing ones", async () => {
    const root = fakeResults();
    const outDir = join(root, "out");
    const rows = await collect({ root, outDir, ffmpeg: null });
    expect(existsSync(join(outDir, "instagram_business_manage_insights.webm"))).toBe(true);
    expect(rows.find((r) => r.permission === "instagram_business_manage_insights")?.webm).toContain("instagram_business_manage_insights.webm");
    expect(rows.filter((r) => r.webm === null).map((r) => r.permission)).toEqual(EXPECTED_PERMISSIONS.filter((p) => p !== "instagram_business_manage_insights"));
  });

  it("prefers PLAYWRIGHT_FFMPEG, else the Playwright cache, else null", () => {
    const root = mkdtempSync(join(tmpdir(), "pw-"));
    mkdirSync(join(root, "Library/Caches/ms-playwright/ffmpeg-1011"), { recursive: true });
    writeFileSync(join(root, "Library/Caches/ms-playwright/ffmpeg-1011/ffmpeg-mac"), "");
    expect(findPlaywrightFfmpeg(root, { PLAYWRIGHT_FFMPEG: "/custom/ffmpeg" })).toBe("/custom/ffmpeg");
    expect(findPlaywrightFfmpeg(root, {})).toContain("ffmpeg-1011/ffmpeg-mac");
    expect(findPlaywrightFfmpeg(mkdtempSync(join(tmpdir(), "empty-")), {})).toBeNull();
  });
});
