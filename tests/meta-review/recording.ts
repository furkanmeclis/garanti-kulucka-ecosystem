import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { login, mockBackend, mockUser, type BackendState, type ExtraRoute } from "../playwright-beta/helpers";

export interface ScenarioOptions {
  /** Meta permission or feature name; becomes the output file name (e.g. "instagram_business_manage_insights"). */
  permission: string;
  /** Shown in the title strip, English. */
  title: string;
  extra?: ExtraRoute;
  anonymous?: (path: string) => boolean;
  /** First page after login; defaults to "/". */
  path?: string;
}

export interface Scenario {
  state: BackendState;
  caption(text: string, holdMs?: number): Promise<void>;
  pause(ms?: number): Promise<void>;
  end(): Promise<void>;
}

export const reviewer = mockUser("admin", { first_name: "Support", last_name: "Agent", email: "agent@garantikulucka.com" });

const CAPTION_ID = "meta-review-caption";

/** Installed before every document: English UI and a fixed caption strip the scenarios update. */
function initScript(captionId: string) {
  return `
    window.localStorage.setItem("garanti-beta-lang", "en");
    window.__metaReviewCaption = function (text) {
      var el = document.getElementById(${JSON.stringify(captionId)});
      if (!el) {
        el = document.createElement("div");
        el.id = ${JSON.stringify(captionId)};
        el.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:2147483647;background:rgba(17,24,39,.92);color:#fff;font:600 16px/1.4 system-ui,sans-serif;padding:10px 20px;text-align:center;pointer-events:none;letter-spacing:.2px";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = text;
    };
  `;
}

export async function startScenario(page: Page, testInfo: TestInfo, options: ScenarioOptions): Promise<Scenario> {
  await page.addInitScript(initScript(CAPTION_ID));
  const state = await mockBackend(page, reviewer, { extra: options.extra, anonymous: options.anonymous });
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(join(testInfo.outputDir, "meta-review.json"), JSON.stringify({ permission: options.permission, title: options.title }, null, 2));

  const caption = async (text: string, holdMs = 1500) => {
    await page.evaluate((value) => (window as unknown as { __metaReviewCaption: (t: string) => void }).__metaReviewCaption(value), text);
    await expect(page.locator(`#${CAPTION_ID}`)).toHaveText(text);
    await page.waitForTimeout(holdMs);
  };
  const pause = (ms = 1500) => page.waitForTimeout(ms);

  await page.goto("/giris");
  await caption(`${options.title} — permission: ${options.permission}`, 4000);
  await caption("Signing in to the Garanti Kuluçka support panel as a support agent");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  if (options.path) await page.goto(options.path);

  return {
    state,
    caption,
    pause,
    end: async () => {
      await caption("End of demonstration", 3000);
    },
  };
}
