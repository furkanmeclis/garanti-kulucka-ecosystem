import { expect, test } from "@playwright/test";
import { chooseOption, type ExtraRoute } from "../playwright-beta/helpers";
import { startScenario } from "./recording";

const now = "2026-10-10T09:00:00.000Z";

function insightsRoutes(): ExtraRoute {
  let refreshed = false;
  return ({ path, url }) => {
    if (path === "/api/instagram/insights/account") {
      const days = Number(url.searchParams.get("days"));
      const scale = days === 14 ? 2 : 1;
      return {
        status: 200,
        body: {
          success: true, cached: refreshed, account_public_id: "iac_garantikulucka",
          data: [
            { name: "impressions", period: "day", values: [{ value: 1320 * scale, end_time: "2026-10-08T07:00:00+0000" }, { value: 1480 * scale, end_time: "2026-10-09T07:00:00+0000" }] },
            { name: "reach", period: "day", values: [{ value: 640 * scale, end_time: "2026-10-08T07:00:00+0000" }, { value: 710 * scale, end_time: "2026-10-09T07:00:00+0000" }] },
            { name: "profile_views", period: "day", values: [{ value: 58, end_time: "2026-10-09T07:00:00+0000" }] },
          ],
          followers: { followers_count: 10300, media_count: 412 }, period: { days, since: 0, until: 0 },
          dry_run: !refreshed, synced_at: refreshed ? now : null, live_gate: "providers.instagram.live_mode", live_call_permitted: false,
        },
      };
    }
    if (path === "/api/instagram/insights/account/refresh") {
      refreshed = true;
      return { status: 202, body: { account_public_id: "iac_garantikulucka", request_id: "req_1", job_id: "job_1", queued: true, live_gate: "providers.instagram.live_mode", live_call_permitted: false } };
    }
    return undefined;
  };
}

test("instagram_business_manage_insights", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "instagram_business_manage_insights",
    title: "Instagram account insights in the marketing dashboard",
    extra: insightsRoutes(),
  });
  await s.caption("Opening Instagram → Analytics from the navigation");
  await page.goto("/instagram/analitik");
  await expect(page.getByTestId("page-instagram-analytics")).toBeVisible();
  await s.caption("Followers, reach and impressions are read with instagram_business_manage_insights");
  await expect(page.getByTestId("instagram-card-followers")).toHaveText("10,300");
  await s.pause(2000);
  await s.caption("Switching the range to the last 14 days");
  await chooseOption(page.getByTestId("instagram-days"), "14");
  await s.pause(2000);
  await s.caption("Requesting a fresh sync from the Instagram API");
  await page.getByTestId("instagram-refresh").click();
  await expect(page.getByTestId("instagram-feedback")).toHaveText("An Instagram statistics refresh was queued.");
  await s.pause(2000);
  await s.end();
});
