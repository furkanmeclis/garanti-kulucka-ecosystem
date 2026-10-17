# Meta App Review Kanıt Videoları: Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run review:videos` tek komutuyla web-beta panelinde 10 İngilizce ekran kaydı (izin başına bir `.webm`, mümkünse `.mp4`) üretmek.

**Architecture:** `tests/meta-review/` altında ayrı bir Playwright projesi; senaryolar `tests/playwright-beta/helpers.ts`'teki `mockBackend`/`login` ile taklit backend'e karşı çalışır, `recording.ts` altyazı şeridi ve manifest yazar, `tools/meta-review-collect.mjs` videoları izin adıyla `tmp/meta-review-videos/` altına toplar. Ürün koduna dokunulmaz.

**Tech Stack:** @playwright/test 1.63 (video kaydı, bundled ffmpeg), TypeScript, Node 22 ESM script, web-beta `vite preview` (dist-e2e).

**Spec:** `docs/superpowers/specs/2026-10-11-meta-review-videos-design.md`

## Global Constraints

- Ürün kodunda (apps/api, apps/worker, apps/web-beta) ve `tests/playwright-beta/helpers.ts`'te değişiklik yok.
- Video: 1440×900, `video.mode: "on"`, `workers: 1`, `retries: 0`, `slowMo: 150`, locale `en-GB`, timezone `Europe/Istanbul`.
- Tüm ekran metinleri ve altyazılar İngilizce; panel dili `localStorage["garanti-beta-lang"] = "en"`.
- Test kullanıcısı: `mockUser("admin", { first_name: "Support", last_name: "Agent", email: "agent@garantikulucka.com" })`.
- Dosya adı deseni `tests/meta-review/*.review.ts`; çıktı `test-results/meta-review/`, toplanan videolar `tmp/meta-review-videos/<permission>.webm` (ve `.mp4`).
- Taklit sabitleri: müşteriler "Emma Clarke" (WhatsApp), "Liam Walker" (Instagram), "Olivia Bennett" (Messenger); ürünler "Incubator Model A", "Spare Motor"; sipariş "GK-1042"; kargo takip "TRK900042".
- Commit mesajları Türkçe, `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` satırıyla biter.
- `npm run verify:structure` ve `npm run test:e2e:beta` etkilenmemeli (beta config `testMatch: "**/*.beta.ts"` olduğu için `.review.ts` dosyalarını görmez; meta-review config `testDir: "."` ile yalnız kendi klasörünü görür).

## Review Focus

1. **Altyazı şeridi SPA navigasyonunda kaybolur.** `caption()` her çağrıda şeridi yoksa yeniden yaratmalı; test: Task 1 adım 3'teki `caption` fonksiyonu `document.getElementById` null ise yeniden ekler ve senaryo `page.goto` sonrası `caption` çağırıp şeridin görünür olduğunu doğrular (Task 2 instagram-insights senaryosu bunu `expect(page.locator("#meta-review-caption")).toHaveText(...)` ile pin'ler).
2. **Gelen mesaj polling'den önce görünmez.** Liste 10 s, konuşma 5 s aralıkla yenilenir; senaryo `expect(...).toBeVisible({ timeout: 15_000 })` ile bekler (Task 4).
3. **Video dosyası test bitmeden yazılmaz.** Collect script yalnız `playwright test` çıkışından sonra çalışır (`&&` zinciri) ve `video.webm` yoksa izni MISSING yazıp `exit 1` döner (Task 8).
4. **ffmpeg yoksa mp4 sessizce atlanır.** Script Playwright'ın `ffmpeg-mac` ikilisini `~/Library/Caches/ms-playwright/ffmpeg-*/` altında arar, bulamazsa `PLAYWRIGHT_FFMPEG` env'ine bakar, o da yoksa "mp4 skipped" yazar (Task 8).
5. **Türkçe sabitler videoya sızar.** `helpers.ts`'teki varsayılan Türkçe konuşmalar/siparişler `state.*` dizileri `startScenario` içinde İngilizce verilerle değiştirilerek bastırılır; Task 3 fixture testi İngilizce listede Türkçe karakter (`ğüşıöçĞÜŞİÖÇ`) olmadığını doğrular.

---

### Task 1: Playwright projesi, kayıt yardımcıları ve ilk video (instagram-insights)

**Files:**
- Create: `tests/meta-review/playwright.config.ts`
- Create: `tests/meta-review/recording.ts`
- Create: `tests/meta-review/instagram-insights.review.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `mockBackend(page, user, { extra, anonymous })`, `login(page, state)`, `mockUser(role, overrides)`, `BackendState`, `ExtraRoute` from `../playwright-beta/helpers`.
- Produces: `startScenario(page, testInfo, options): Promise<Scenario>`; `Scenario = { state: BackendState; caption(text: string, holdMs?: number): Promise<void>; pause(ms?: number): Promise<void>; end(): Promise<void> }`; `ScenarioOptions = { permission: string; title: string; extra?: ExtraRoute; anonymous?: (path: string) => boolean; path?: string }`; manifest dosyası `<testInfo.outputDir>/meta-review.json` = `{ "permission": string, "title": string }`.

- [ ] **Step 1: Playwright config'i yaz**

`tests/meta-review/playwright.config.ts`:

```ts
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
```

- [ ] **Step 2: package.json'a script ekle**

`package.json` → `scripts` içine, `test:e2e:beta` satırının altına:

```json
"review:videos": "npm run build -w @garanti-kulucka/shared && npm run build:e2e -w @garanti-kulucka/web-beta && playwright test -c tests/meta-review/playwright.config.ts && node tools/meta-review-collect.mjs"
```

(Collect script Task 8'de gelir; o zamana kadar komut son adımda "Cannot find module" ile düşer, bu beklenen durumdur. Task 1–7'de yalnız `npx playwright test -c tests/meta-review/playwright.config.ts <dosya>` çalıştırılır.)

- [ ] **Step 3: recording.ts'i yaz**

`tests/meta-review/recording.ts`:

```ts
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
  await caption(`${options.title} — permission: ${options.permission}`, 2500);
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
```

- [ ] **Step 4: İlk senaryoyu yaz (başarısız olmasını bekle)**

`tests/meta-review/instagram-insights.review.ts`:

```ts
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
```

- [ ] **Step 5: Senaryoyu çalıştır, kırmızı gör**

Run: `npm run build -w @garanti-kulucka/shared && npm run build:e2e -w @garanti-kulucka/web-beta && npx playwright test -c tests/meta-review/playwright.config.ts instagram-insights`
Expected: Eğer `recording.ts` henüz yazılmadıysa "Cannot find module ./recording"; yazıldıysa senaryo yeşil olabilir. Kırmızıysa hata mesajını oku: en olası neden `followers` metninin `en-GB` biçimi ("10,300") ile uyuşmaması; bu durumda gerçek metni `toHaveText(/10[.,]300/)` ile eşle.

- [ ] **Step 6: Yeşile getir ve videoyu doğrula**

Run: `npx playwright test -c tests/meta-review/playwright.config.ts instagram-insights && ls -la test-results/meta-review/*/video.webm test-results/meta-review/*/meta-review.json`
Expected: 1 passed; bir `video.webm` (> 100 KB) ve yanında `meta-review.json` içeriği `{"permission":"instagram_business_manage_insights",...}`.

- [ ] **Step 7: Commit**

```bash
git add tests/meta-review/playwright.config.ts tests/meta-review/recording.ts tests/meta-review/instagram-insights.review.ts package.json
git commit -m "test(meta-review): Playwright kayıt projesi, altyazı yardımcıları ve ilk video senaryosu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: İngilizce taklit veri modülü (fixtures.ts)

**Files:**
- Create: `tests/meta-review/fixtures.ts`
- Create: `tests/meta-review/fixtures.test.ts` (vitest ile hızlı birim testi, Playwright'a gerek yok)

**Interfaces:**
- Consumes: `BackendState`, `ExtraRoute` tipleri.
- Produces:
  - `const NOW = "2026-10-10T09:00:00.000Z"`
  - `conversationFixture(id, channel, customer, lastMessage, overrides?)` → helpers'taki `conversation()` ile aynı şekil.
  - `applyEnglishState(state: BackendState): void` — `state.conversations`, `state.orders`, `state.customers`, `state.shipments` dizilerini yerinde İngilizce verilerle değiştirir (3 konuşma: `cnv_wa` whatsapp/Emma Clarke, `cnv_ig` instagram/Liam Walker, `cnv_fb` messenger/Olivia Bennett; 1 sipariş GK-1042; 1 kargo TRK900042).
  - `inboxRoutes(): { route: ExtraRoute; addIncoming(conversationId: string, text: string): void; messages: Record<string, Message[]> }` — mesaj listesi/gönderme, state PATCH (human agent), ai-status, admin/users, message-shortcuts, files, product-options, customer-lookup, orders POST.
  - `commentRoutes(): ExtraRoute` — `/api/comments*` İngilizce yorumlar (2 Instagram, 2 Facebook), reply/hide/delete.
  - `settingsRoutes(): ExtraRoute` — `/admin/integrations/accounts*`, `/admin/settings`, `/api/app-settings/ai-status`: whatsapp (phone_number_id "1128646770325911", waba_id "1931036684950470", display_phone_number "+90 322 911 03 70"), instagram (external_account_id "17841400000000000", status active), messenger (external_account_id "296265270245200").
  - `publishRoutes(): ExtraRoute` — `/api/instagram/publications*` (kuyruk → yayınlandı).
  - `combine(...routes: ExtraRoute[]): ExtraRoute` — ilk `undefined` olmayan cevabı döner.
  - `type Message = { public_id: string; sender_type: "customer" | "user" | "ai"; sender_name: string | null; body: string | null; is_read: boolean; sent_at: string; attachments: Array<{ file_public_id: string; attachment_type: string; original_name: string; mime_type: string; byte_size: number }> }`

- [ ] **Step 1: Başarısız birim testini yaz**

`tests/meta-review/fixtures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyEnglishState, combine, commentRoutes, inboxRoutes, settingsRoutes } from "./fixtures";
import type { BackendState } from "../playwright-beta/helpers";

const turkish = /[ğüşıöçĞÜŞİÖÇ]/;
const request = (method: string, path: string, body?: unknown) => ({ method, path, url: new URL(`http://127.0.0.1:65531${path}`), body });
const state = () => ({ user: { public_id: "u", email: "", first_name: "", last_name: "", role: "admin", permissions: [] }, password: "", requests: [], orders: [], shipments: [], conversations: [], customers: [], fail: new Set<string>(), bodies: [] }) as unknown as BackendState;

describe("meta-review fixtures", () => {
  it("replaces the default Turkish inbox data with English conversations", () => {
    const s = state();
    applyEnglishState(s);
    expect(s.conversations.map((c) => c.public_id)).toEqual(["cnv_wa", "cnv_ig", "cnv_fb"]);
    expect(JSON.stringify([s.conversations, s.orders, s.customers, s.shipments])).not.toMatch(turkish);
  });

  it("serves a thread and appends incoming customer messages", () => {
    const inbox = inboxRoutes();
    const s = state();
    const before = inbox.route(request("GET", "/api/conversations/cnv_wa/messages"), s)!.body as { data: unknown[] };
    inbox.addIncoming("cnv_wa", "Hi, where is my order?");
    const after = inbox.route(request("GET", "/api/conversations/cnv_wa/messages"), s)!.body as { data: Array<{ body: string }> };
    expect(after.data.length).toBe(before.data.length + 1);
    expect(after.data.at(-1)?.body).toBe("Hi, where is my order?");
  });

  it("hides a comment and reports it as hidden", () => {
    const comments = commentRoutes();
    const s = state();
    comments(request("POST", "/api/comments/cmt_ig_1/hide", {}), s);
    const listRequest = { ...request("GET", "/api/comments"), url: new URL("http://127.0.0.1:65531/api/comments?platform=instagram") };
    const list = comments(listRequest, s)!.body as { data: Array<{ public_id: string; status: string }> };
    expect(list.data.find((c) => c.public_id === "cmt_ig_1")?.status).toBe("hidden");
  });

  it("returns the WhatsApp account snapshot with the production ids", () => {
    const body = settingsRoutes()(request("GET", "/admin/integrations/accounts/acc_whatsapp"), state())!.body as { settings: Array<{ key: string; value: unknown }> };
    expect(body.settings.find((x) => x.key === "phone_number_id")?.value).toBe("1128646770325911");
  });

  it("combine returns the first defined answer", () => {
    const a: Parameters<typeof combine>[0] = () => undefined;
    const b: Parameters<typeof combine>[0] = () => ({ status: 200, body: "b" });
    expect(combine(a, b)(request("GET", "/x"), state())?.body).toBe("b");
  });
});
```

- [ ] **Step 2: Testi çalıştır, kırmızı gör**

Run: `npx vitest run tests/meta-review/fixtures.test.ts`
Expected: FAIL, "Failed to resolve import ./fixtures".

- [ ] **Step 3: fixtures.ts'i yaz**

`tests/meta-review/fixtures.ts`:

```ts
import type { BackendState, ExtraRoute } from "../playwright-beta/helpers";

export const NOW = "2026-10-10T09:00:00.000Z";
const earlier = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

export type Message = {
  public_id: string;
  sender_type: "customer" | "user" | "ai";
  sender_name: string | null;
  body: string | null;
  is_read: boolean;
  sent_at: string;
  attachments: Array<{ file_public_id: string; attachment_type: string; original_name: string; mime_type: string; byte_size: number }>;
};

export function conversationFixture(id: string, channel: "whatsapp" | "instagram" | "messenger", customer: { full_name: string; phone: string | null }, lastMessage: string, overrides: Record<string, unknown> = {}) {
  return {
    public_id: id, channel, status: "open", is_in_pool: false, human_agent_enabled: false, unread_count: 1,
    last_message_text: lastMessage, last_message_sender_type: "customer", last_message_at: earlier(1), customer,
    assigned_user_email: "agent@garantikulucka.com", updated_at: earlier(1), ...overrides,
  };
}

export const customers = {
  emma: { full_name: "Emma Clarke", phone: "+44 7700 900123" },
  liam: { full_name: "Liam Walker", phone: null },
  olivia: { full_name: "Olivia Bennett", phone: null },
};

export function applyEnglishState(state: BackendState) {
  state.conversations.splice(0, state.conversations.length,
    conversationFixture("cnv_wa", "whatsapp", customers.emma, "Hi, where is my order GK-1042?"),
    conversationFixture("cnv_ig", "instagram", customers.liam, "Is the Incubator Model A in stock?", { last_message_at: earlier(30), updated_at: earlier(30) }),
    conversationFixture("cnv_fb", "messenger", customers.olivia, "Do you ship to Scotland?"),
  ) ;
  state.orders.splice(0, state.orders.length, {
    public_id: "ord_1042", order_number: "GK-1042", status: "shipped", source: "conversation", cargo_provider: "ptt", total_amount: "3500.00", currency: "TRY",
    customer_full_name: "Emma Clarke", customer_phone: "+44 7700 900123", created_at: earlier(48),
  });
  state.customers.splice(0, state.customers.length,
    { public_id: "cus_emma", full_name: "Emma Clarke", phone: "+44 7700 900123", email: "emma@example.com", notes: null, updated_at: earlier(48) },
    { public_id: "cus_liam", full_name: "Liam Walker", phone: null, email: null, notes: null, updated_at: earlier(48) },
    { public_id: "cus_olivia", full_name: "Olivia Bennett", phone: null, email: null, notes: null, updated_at: earlier(48) },
  );
  state.shipments.splice(0, state.shipments.length, {
    public_id: "shp_1042", provider: "ptt", tracking_number: "TRK900042", status: "in_transit", recipient_name: "Emma Clarke", recipient_phone: "+44 7700 900123",
    recipient_city: "London", recipient_district: "Camden", last_event_text: "Left the transfer centre", order_number: "GK-1042", customer_full_name: "Emma Clarke", updated_at: earlier(6),
  });
}

export function combine(...routes: ExtraRoute[]): ExtraRoute {
  return (request, state) => {
    for (const route of routes) {
      const answer = route(request, state);
      if (answer) return answer;
    }
    return undefined;
  };
}

const products = [
  { public_id: "prd_1", name: "Incubator Model A", unit_price: "3500.00", stock_quantity: 12, external_product_id: null },
  { public_id: "prd_2", name: "Spare Motor", unit_price: "250.00", stock_quantity: 4, external_product_id: null },
];

export function inboxRoutes() {
  const messages: Record<string, Message[]> = {
    cnv_wa: [{ public_id: "msg_wa_1", sender_type: "customer", sender_name: "Emma Clarke", body: "Hi, where is my order GK-1042?", is_read: true, sent_at: earlier(1), attachments: [] }],
    cnv_ig: [{ public_id: "msg_ig_1", sender_type: "customer", sender_name: "Liam Walker", body: "Is the Incubator Model A in stock?", is_read: true, sent_at: earlier(30), attachments: [] }],
    cnv_fb: [{ public_id: "msg_fb_1", sender_type: "customer", sender_name: "Olivia Bennett", body: "Do you ship to Scotland?", is_read: true, sent_at: earlier(1), attachments: [] }],
  };
  let counter = 0;
  const addIncoming = (conversationId: string, text: string) => {
    counter += 1;
    const sender = conversationId === "cnv_wa" ? "Emma Clarke" : conversationId === "cnv_ig" ? "Liam Walker" : "Olivia Bennett";
    (messages[conversationId] ??= []).push({ public_id: `msg_in_${counter}`, sender_type: "customer", sender_name: sender, body: text, is_read: false, sent_at: new Date().toISOString(), attachments: [] });
  };
  const route: ExtraRoute = ({ method, path, body }, state) => {
    const thread = /^\/api\/conversations\/(cnv_\w+)\/messages$/.exec(path);
    if (thread && method === "GET") {
      const rows = messages[thread[1]!] ?? [];
      const row = state.conversations.find((item) => item.public_id === thread[1]);
      if (row) {
        const last = rows.at(-1);
        if (last) { row.last_message_text = last.body ?? ""; row.last_message_sender_type = last.sender_type; row.unread_count = rows.filter((m) => m.sender_type === "customer" && !m.is_read).length; }
      }
      return { status: 200, body: { data: rows, has_more: false } };
    }
    if (thread && method === "POST") {
      counter += 1;
      const input = body as { body: string | null; sender_name: string; attachments: Array<{ file_public_id: string; attachment_type: string }> };
      const message: Message = {
        public_id: `msg_out_${counter}`, sender_type: "user", sender_name: input.sender_name, body: input.body, is_read: true, sent_at: new Date().toISOString(),
        attachments: input.attachments.map((item) => ({ ...item, original_name: item.attachment_type === "image" ? "incubator-model-a.png" : "invoice-GK-1042.pdf", mime_type: item.attachment_type === "image" ? "image/png" : "application/pdf", byte_size: 4 })),
      };
      (messages[thread[1]!] ??= []).push(message);
      return { status: 201, body: message };
    }
    const stateMatch = /^\/api\/conversations\/(cnv_\w+)\/state$/.exec(path);
    if (stateMatch) {
      const row = state.conversations.find((item) => item.public_id === stateMatch[1])!;
      const input = body as { human_agent_enabled?: boolean; is_in_pool?: boolean; unread_count?: number; status?: string };
      if (input.human_agent_enabled !== undefined) row.human_agent_enabled = input.human_agent_enabled;
      if (input.is_in_pool !== undefined) row.is_in_pool = input.is_in_pool;
      if (input.unread_count !== undefined) row.unread_count = input.unread_count;
      if (input.status !== undefined) row.status = input.status;
      return { status: 200, body: { ...row, notes: null } };
    }
    if (path === "/api/conversations/mark-all-read") return { status: 200, body: { updated: 0 } };
    if (/^\/api\/conversations\/cnv_\w+\/(notes|customer-notes)$/.test(path)) return { status: 200, body: { notes: (body as { notes: string }).notes } };
    if (path === "/api/ai/reply-suggestion") return { status: 200, body: { suggestion: "Your order GK-1042 left our warehouse today; tracking number TRK900042.", dry_run: false } };
    if (path === "/api/app-settings/ai-status") return { status: 200, body: { ai_enabled: true } };
    if (path === "/admin/users") {
      return { status: 200, body: { data: [{ public_id: "usr_a", email: "noah@garantikulucka.com", first_name: "Noah", last_name: "Hughes", phone: null, role: "calisan", is_active: true, is_online: true, last_seen_at: NOW, sip_username: null, sip_password_configured: false, created_at: NOW }], roles: [] } };
    }
    if (path === "/api/message-shortcuts" && method === "GET") {
      return { status: 200, body: { data: [{ public_id: "msc_1", code: "shipping", message: "Your parcel is on its way. Tracking number: TRK900042", type: "custom", is_active: true, sort_order: 0, attachments: [], updated_at: NOW }] } };
    }
    if (path === "/api/files/uploads") return { status: 201, body: { file: { public_id: "fil_up", original_name: "incubator-model-a.png", mime_type: "image/png", byte_size: 4 }, upload: { method: "PUT", headers: {}, presigned_url: "http://127.0.0.1:65531/presigned/upload" } } };
    if (path === "/presigned/upload") return { status: 200, body: {} };
    if (path.startsWith("/api/files/") && path.endsWith("/download")) return { status: 200, body: { download: { presigned_url: null } } };
    if (path === "/api/orders/product-options") return { status: 200, body: { data: products } };
    if (path === "/api/orders/customer-lookup") return { status: 200, body: { customer: null, default_address: null } };
    if (path === "/api/orders" && method === "POST") return { status: 201, body: { public_id: "ord_new", order_number: "GK-1043", status: "draft", source: "conversation", total_amount: "3500.00", currency: "TRY" } };
    return undefined;
  };
  return { route, addIncoming, messages };
}

export function commentRoutes(): ExtraRoute {
  let comments = [
    { public_id: "cmt_ig_1", platform: "instagram", external_comment_id: "17890001", media_id: "m1", post_id: null, username: "hannah.farm", text: "How much is the Incubator Model A?", status: "manual", classification: "price_question", classification_reason: "Price question", confidence: 0.86, ai_reply_draft: "Hi Hannah, we have sent you the price in a direct message.", manual_reply: null, reply_type: null, error_message: null, received_at: earlier(2), updated_at: earlier(2) },
    { public_id: "cmt_ig_2", platform: "instagram", external_comment_id: "17890002", media_id: "m1", post_id: null, username: "spam.account.99", text: "Click here for free followers!!!", status: "manual", classification: "spam", classification_reason: "Spam", confidence: 0.97, ai_reply_draft: null, manual_reply: null, reply_type: null, error_message: null, received_at: earlier(3), updated_at: earlier(3) },
    { public_id: "cmt_fb_1", platform: "facebook", external_comment_id: "fb_1001", media_id: null, post_id: "p1", username: "George Mills", text: "Does the spare motor fit the 2024 model?", status: "manual", classification: "product_question", classification_reason: null, confidence: 0.8, ai_reply_draft: "Hi George, yes, the spare motor fits all models from 2022 onwards.", manual_reply: null, reply_type: null, error_message: null, received_at: earlier(4), updated_at: earlier(4) },
    { public_id: "cmt_fb_2", platform: "facebook", external_comment_id: "fb_1002", media_id: null, post_id: "p1", username: "Angry Buyer", text: "This is a scam, do not buy!", status: "manual", classification: "brand_disparagement", classification_reason: null, confidence: 0.9, ai_reply_draft: null, manual_reply: null, reply_type: null, error_message: null, received_at: earlier(5), updated_at: earlier(5) },
  ];
  let config = { enabled: true, platforms: { instagram: true, facebook: true }, reply_type: "public", delete_profanity: true, delete_brand_disparagement: false, risk_manual_examples: ["refund"], auto_reply_topics: ["price"], min_confidence: 0.7 };
  return ({ method, path, url, body }) => {
    if (path === "/api/comments" && method === "GET") {
      const status = url.searchParams.get("status");
      const platform = url.searchParams.get("platform");
      const rows = comments.filter((row) => (!status || row.status === status) && (!platform || row.platform === platform));
      return { status: 200, body: { data: rows, total: rows.length, page: 1, page_size: 30 } };
    }
    if (path === "/api/comments/stats") return { status: 200, body: { counts: { pending: 0, manual: comments.filter((r) => r.status === "manual").length, auto_replied: 12, replied: comments.filter((r) => r.status === "replied").length, deleted: comments.filter((r) => r.status === "deleted").length, hidden: comments.filter((r) => r.status === "hidden").length, error: 0 } } };
    if (path === "/api/comments/control") return { status: 200, body: { status: "ok", summary: { ok: 5, warning: 0, error: 0 }, warnings: [], checks: [] } };
    if (path === "/api/comments/settings" && method === "GET") return { status: 200, body: { config } };
    if (path === "/api/comments/settings" && method === "PUT") { config = body as typeof config; return { status: 200, body: { config } }; }
    const match = /^\/api\/comments\/(cmt_\w+)\/([a-z-]+)$/.exec(path);
    if (!match) return undefined;
    const row = comments.find((entry) => entry.public_id === match[1])!;
    if (match[2] === "ai-suggestion") return { status: 200, body: { provider: "openai", operation: "comments.reply_suggestion", dry_run: false, live_call_permitted: true, comment_public_id: row.public_id, action: "reply", suggestion: row.ai_reply_draft ?? "Thank you for your comment!" } };
    const next = match[2] === "reply" ? { status: "replied", manual_reply: (body as { message: string }).message, reply_type: (body as { reply_type: string }).reply_type } : match[2] === "hide" ? { status: "hidden" } : match[2] === "delete" ? { status: "deleted" } : { status: "manual" };
    comments = comments.map((entry) => (entry.public_id === row.public_id ? { ...entry, ...next } : entry));
    return { status: 200, body: { provider: row.platform, operation: null, action: match[2], job_id: "job_1", queued: true, replayed: false, live_call_permitted: true, comment: comments.find((entry) => entry.public_id === row.public_id) } };
  };
}

function account(provider: string, overrides: Record<string, unknown> = {}) {
  return { public_id: `acc_${provider}`, provider_key: provider, provider_name: provider, display_name: provider, external_account_id: null, status: "active", metadata: {}, updated_at: NOW, ...overrides };
}
function setting(key: string, value: unknown, isSecret = false) {
  return { public_id: `set_${key}`, key, value: isSecret ? null : value, is_secret: isSecret, updated_at: NOW };
}
function token(type: string) {
  return { public_id: `tok_${type}`, token_type: type, value: null, expires_at: null, last_refreshed_at: null, updated_at: NOW };
}

export function settingsRoutes(): ExtraRoute {
  const accounts = [
    account("whatsapp", { display_name: "Garanti Kuluçka WhatsApp", external_account_id: "1128646770325911" }),
    account("instagram", { display_name: "@garantikulucka", external_account_id: "17841400000000000" }),
    account("messenger", { display_name: "Garanti Kuluçka Page", external_account_id: "296265270245200" }),
  ];
  const snapshots: Record<string, { settings: unknown[]; tokens: unknown[] }> = {
    acc_whatsapp: { settings: [setting("phone_number_id", "1128646770325911"), setting("waba_id", "1931036684950470"), setting("display_phone_number", "+90 322 911 03 70"), setting("webhook.verify_token", "x", true), setting("live_mode", true)], tokens: [token("access_token")] },
    acc_instagram: { settings: [setting("ig_user_id", "17841400000000000"), setting("login_type", "instagram_login")], tokens: [token("access_token")] },
    acc_messenger: { settings: [setting("page_id", "296265270245200")], tokens: [token("page_access_token")] },
  };
  const globalSettings = [
    { key: "ai.system_prompt", scope: "global", value: "You are the Garanti Kuluçka support assistant.", is_secret: false, updated_at: NOW },
    { key: "sip_config", scope: "global", value: { ws_url: "wss://pbx.example.com/ws", domain: "pbx.example.com", stun: "stun:stun.example.com:3478" }, is_secret: false, updated_at: NOW },
    { key: "vapi_ayarlar", scope: "global", value: { enabled: false }, is_secret: false, updated_at: NOW },
  ];
  return ({ method, path, body }) => {
    if (path === "/api/app-settings/ai-status") return { status: 200, body: { ai_enabled: true } };
    if (path === "/admin/settings" && method === "GET") return { status: 200, body: { data: globalSettings } };
    const settingMatch = /^\/admin\/settings\/([^/]+)$/.exec(path);
    if (settingMatch && method === "PUT") { const input = body as { value: unknown; is_secret: boolean }; return { status: 200, body: { key: decodeURIComponent(settingMatch[1]!), scope: "global", value: input.is_secret ? null : input.value, is_secret: input.is_secret, updated_at: NOW } }; }
    if (path === "/admin/integrations/accounts" && method === "GET") return { status: 200, body: { data: accounts } };
    if (path === "/admin/integrations/accounts" && method === "POST") { const input = body as { provider_key: string; external_account_id: string | null; display_name: string }; return { status: 201, body: account(input.provider_key, { external_account_id: input.external_account_id, display_name: input.display_name }) }; }
    const metaAction = /^\/admin\/integrations\/accounts\/([^/]+)\/(webhook-subscription|thread-control|disconnect)$/.exec(path);
    if (metaAction && method === "POST") {
      const found = accounts.find((item) => item.public_id === metaAction[1])!;
      if (metaAction[2] === "disconnect") { found.status = "inactive"; return { status: 200, body: { account: found, removed_tokens: 1, unsubscribe_job_id: `job_${found.public_id}_unsubscribe` } }; }
      const input = body as { action: string };
      return { status: 202, body: { queued: true, job_id: `job_${found.provider_key}_${input.action}`, request_id: "req_1", account_public_id: found.public_id, provider_key: found.provider_key, operation: input.action, live_gate: `providers.${found.provider_key}.live_mode` } };
    }
    const accountMatch = /^\/admin\/integrations\/accounts\/([^/]+)$/.exec(path);
    if (accountMatch && method === "GET") { const found = accounts.find((item) => item.public_id === accountMatch[1]); return found ? { status: 200, body: { account: found, ...snapshots[found.public_id] } } : { status: 404, body: { error: { code: "not_found", message: "not found" } } }; }
    const integrationSetting = /^\/admin\/integrations\/accounts\/([^/]+)\/settings\/([^/]+)$/.exec(path);
    if (integrationSetting && method === "PUT") { const input = body as { value: unknown; is_secret: boolean }; return { status: 200, body: setting(decodeURIComponent(integrationSetting[2]!), input.value, input.is_secret) }; }
    const integrationToken = /^\/admin\/integrations\/accounts\/([^/]+)\/tokens\/([^/]+)$/.exec(path);
    if (integrationToken && method === "PUT") return { status: 200, body: { public_id: "tok_new", token_type: integrationToken[2], value: null } };
    return undefined;
  };
}

export function publishRoutes(): ExtraRoute {
  let polls = 0;
  const publication = (status: string) => ({ public_id: "igp_1", account_public_id: "iac_garantikulucka", media_kind: "image", media_type: "IMAGE", media_url: "https://cdn.example.com/incubator-model-a.jpg", file_public_id: null, caption: "New arrival: Incubator Model A", idempotency_key: "k", request_id: "req_ig", job_id: "job_ig", queued: true, status, media_id: status === "published" ? "17895695668004550" : null, error_message: null, created_at: NOW });
  return ({ method, path }) => {
    if (path === "/api/instagram/publications" && method === "POST") return { status: 202, body: { provider: "instagram", operation: "media.publish", publication: publication("queued"), job_id: "job_ig", queued: true, replayed: false, live_call_permitted: true, live_gate: "providers.instagram.live_mode" } };
    if (path === "/api/instagram/publications/igp_1") { polls += 1; return { status: 200, body: publication(polls > 1 ? "published" : "queued") }; }
    return undefined;
  };
}
```

- [ ] **Step 4: Testi çalıştır, yeşil gör**

Run: `npx vitest run tests/meta-review/fixtures.test.ts`
Expected: 5 passed. (Vitest kök config'i `tests/meta-review` dizinini görmüyorsa `npx vitest run --dir tests/meta-review` ile çalıştır; yine olmazsa `vitest.config.ts`'e `include` eklemek yerine testi `tests/contract` ile aynı deseni kullanacak biçimde `tests/meta-review/fixtures.test.ts` yolunu açıkça ver.)

- [ ] **Step 5: Commit**

```bash
git add tests/meta-review/fixtures.ts tests/meta-review/fixtures.test.ts
git commit -m "test(meta-review): İngilizce taklit backend verisi ve rotaları

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Instagram senaryoları: basic, comments, publish

**Files:**
- Create: `tests/meta-review/instagram-basic.review.ts`
- Create: `tests/meta-review/instagram-comments.review.ts`
- Create: `tests/meta-review/instagram-publish.review.ts`

**Interfaces:**
- Consumes: `startScenario`, `settingsRoutes`, `commentRoutes`, `publishRoutes`, `applyEnglishState`, `combine`.

- [ ] **Step 1: instagram-basic.review.ts**

```ts
import { expect, test } from "@playwright/test";
import { settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("instagram_business_basic", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "instagram_business_basic",
    title: "Connecting the Instagram professional account to the panel",
    extra: settingsRoutes(),
  });
  await s.caption("Opening Settings → Instagram");
  await page.goto("/ayarlar?tab=instagram");
  await expect(page.getByTestId("settings-tab-panel-instagram")).toBeVisible();
  await s.caption("The connected account profile is read with instagram_business_basic: @garantikulucka");
  await expect(page.getByTestId("instagram-status")).toContainText("Instagram connected");
  await s.pause(2500);
  await s.caption("The Instagram user id and login type come from the Instagram API with Instagram Login");
  await expect(page.getByTestId("instagram-page-id")).toHaveValue("17841400000000000");
  await s.pause(2500);
  await s.caption("Saving the account keeps the panel linked to this Instagram profile");
  await page.getByTestId("instagram-save").click();
  await expect(page.getByTestId("instagram-feedback")).toHaveText("Settings saved.");
  await s.pause(2000);
  await s.end();
});
```

- [ ] **Step 2: instagram-comments.review.ts**

```ts
import { expect, test } from "@playwright/test";
import { chooseOption } from "../playwright-beta/helpers";
import { commentRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("instagram_business_manage_comments", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "instagram_business_manage_comments",
    title: "Moderating Instagram comments from the Comments tab",
    extra: commentRoutes(),
  });
  await s.caption("Opening the Comments page and filtering by Instagram");
  await page.goto("/yorumlar");
  await expect(page.getByTestId("page-comments")).toBeVisible();
  await chooseOption(page.getByTestId("filter-platform"), "instagram");
  await expect(page.getByTestId("comment-card")).toHaveCount(2);
  await s.caption("Comments on our posts are read with instagram_business_manage_comments");
  await s.pause(2500);

  await s.caption("Replying to a customer's price question");
  await page.getByTestId("comment-card").first().getByTestId("comment-reply").click();
  const sheet = page.getByTestId("comment-reply-sheet");
  await sheet.getByTestId("comment-ai-suggest").click();
  await expect(sheet.getByTestId("comment-reply-message")).toHaveValue(/Hi Hannah/);
  await s.pause(2000);
  await sheet.getByTestId("comment-reply-send").click();
  await expect(page.getByTestId("comments-feedback")).toHaveText("Reply sent");
  await s.pause(2000);

  await s.caption("Hiding a spam comment so customers no longer see it");
  await page.getByTestId("comment-card").nth(1).getByTestId("comment-hide").click();
  await expect(page.getByTestId("comments-feedback")).toHaveText("Comment hidden");
  await s.pause(2000);

  await s.caption("Deleting the spam comment permanently");
  await page.getByTestId("comment-card").nth(1).getByTestId("comment-delete").click();
  const confirm = page.getByTestId("confirm-dialog-action");
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByTestId("comments-feedback")).toContainText(/deleted/i);
  await s.pause(2000);
  await s.end();
});
```

- [ ] **Step 3: instagram-publish.review.ts**

```ts
import { expect, test } from "@playwright/test";
import { publishRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("instagram_business_content_publish", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "instagram_business_content_publish",
    title: "Publishing a product photo to Instagram from the panel",
    extra: publishRoutes(),
  });
  await s.caption("Opening Instagram → Publish");
  await page.goto("/instagram/yayinla");
  await expect(page.getByTestId("page-instagram-publish")).toBeVisible();
  await s.caption("Entering the product image and caption");
  await page.getByTestId("instagram-image-url").fill("https://cdn.example.com/incubator-model-a.jpg");
  await page.getByTestId("instagram-caption").fill("New arrival: Incubator Model A");
  await s.pause(2000);
  await s.caption("Publishing uses instagram_business_content_publish (container → publish)");
  await page.getByTestId("instagram-publish").click();
  await expect(page.getByTestId("instagram-publish-feedback")).toHaveText("Publish request queued");
  await expect(page.getByTestId("instagram-publish-feedback")).toHaveText("Instagram post published!", { timeout: 20_000 });
  await s.caption("The post is live; the Instagram media id is shown for reference");
  await expect(page.getByTestId("instagram-publish-result")).toContainText("17895695668004550");
  await s.pause(2500);
  await s.end();
});
```

- [ ] **Step 4: Üçünü çalıştır**

Run: `npx playwright test -c tests/meta-review/playwright.config.ts instagram-basic instagram-comments instagram-publish`
Expected: 3 passed. Kırmızı olursa hatayı oku; en olası nedenler: (a) `comment-delete` düğmesi onay dialogu açmıyor ya da feedback metni farklı → gerçek metni `apps/web-beta/src/i18n/locales/en.json` `comments.*` anahtarlarından al ve regex'i güncelle; (b) `instagram-status` metni "@garantikulucka connected" olabilir → `toContainText("connected")`.

- [ ] **Step 5: Commit**

```bash
git add tests/meta-review/instagram-basic.review.ts tests/meta-review/instagram-comments.review.ts tests/meta-review/instagram-publish.review.ts
git commit -m "test(meta-review): Instagram basic, yorum ve yayın senaryoları

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Mesajlaşma senaryoları: WhatsApp, Instagram DM + Human Agent, Messenger

**Files:**
- Create: `tests/meta-review/whatsapp-messaging.review.ts`
- Create: `tests/meta-review/instagram-messages.review.ts`
- Create: `tests/meta-review/messenger.review.ts`

**Interfaces:**
- Consumes: `startScenario`, `inboxRoutes`, `settingsRoutes`, `applyEnglishState`, `combine`.
- Not: `applyEnglishState(s.state)` `startScenario`'dan hemen sonra çağrılır (giriş sonrası ilk `/mesajlar` yüklemesinden önce). Mesajlar sayfasında konuşma satırı `[data-testid="conversation-row"][data-id="<id>"]`, kanal filtresi `channel-filter` + `channel-filter-<kanal>`.

- [ ] **Step 1: whatsapp-messaging.review.ts**

```ts
import { expect, test } from "@playwright/test";
import { applyEnglishState, combine, inboxRoutes, settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

const row = (page: import("@playwright/test").Page, id: string) => page.locator(`[data-testid="conversation-row"][data-id="${id}"]`);

test("whatsapp_business_messaging", async ({ page }, testInfo) => {
  const inbox = inboxRoutes();
  const s = await startScenario(page, testInfo, {
    permission: "whatsapp_business_messaging",
    title: "Answering WhatsApp customers from the shared inbox",
    extra: combine(inbox.route, settingsRoutes()),
    anonymous: (path) => path.startsWith("/presigned/"),
  });
  applyEnglishState(s.state);
  await s.caption("Opening Messages and filtering the inbox by WhatsApp");
  await page.goto("/mesajlar");
  await expect(page.getByTestId("page-messages")).toBeVisible();
  await page.getByTestId("channel-filter").click();
  await page.getByTestId("channel-filter-whatsapp").click();
  await expect(row(page, "cnv_wa")).toBeVisible();
  await s.pause(2000);

  await s.caption("A customer sends a new WhatsApp message; the inbox receives it via the WhatsApp webhook…");
  inbox.addIncoming("cnv_wa", "Can you send me the invoice and the tracking link?");
  await expect(row(page, "cnv_wa")).toContainText("Can you send me the invoice", { timeout: 15_000 });
  await s.pause(1500);

  await s.caption("Opening the conversation; the customer's messages are shown in the thread");
  await row(page, "cnv_wa").click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await expect(page.getByTestId("thread-message").last()).toContainText("invoice");
  await s.pause(2000);

  await s.caption("The agent replies with text (whatsapp_business_messaging → POST /messages)");
  await page.getByTestId("message-input").fill("Hi Emma, your order GK-1042 is on its way. Tracking number: TRK900042");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("thread-message").last()).toContainText("TRK900042");
  await s.pause(2000);

  await s.caption("Sending the product photo as a media message");
  await page.getByTestId("composer-attach-menu").click();
  await page.getByTestId("composer-image-file").setInputFiles({ name: "incubator-model-a.png", mimeType: "image/png", buffer: Buffer.from("png!") });
  await expect(page.getByTestId("media-preview")).toContainText("incubator-model-a.png");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("media-preview")).toHaveCount(0);
  await s.pause(2000);

  await s.caption("Quick replies send the standard shipping notification");
  await page.getByTestId("composer-quick-replies").click();
  await page.getByTestId("shortcut-row-shipping").click();
  await expect(page.getByTestId("message-input")).toHaveValue(/Your parcel is on its way/);
  await page.getByTestId("message-send-button").click();
  await s.pause(2500);
  await s.end();
});
```

- [ ] **Step 2: instagram-messages.review.ts**

```ts
import { expect, test } from "@playwright/test";
import { applyEnglishState, combine, inboxRoutes, settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

const row = (page: import("@playwright/test").Page, id: string) => page.locator(`[data-testid="conversation-row"][data-id="${id}"]`);

test("instagram_business_manage_messages + Human Agent", async ({ page }, testInfo) => {
  const inbox = inboxRoutes();
  const s = await startScenario(page, testInfo, {
    permission: "instagram_business_manage_messages",
    title: "Answering Instagram direct messages, including after 24 hours with the Human Agent tag",
    extra: combine(inbox.route, settingsRoutes()),
  });
  applyEnglishState(s.state);
  await s.caption("Opening Messages and filtering by Instagram");
  await page.goto("/mesajlar");
  await expect(page.getByTestId("page-messages")).toBeVisible();
  await page.getByTestId("channel-filter").click();
  await page.getByTestId("channel-filter-instagram").click();
  await expect(row(page, "cnv_ig")).toBeVisible();
  await s.pause(2000);

  await s.caption("A customer sends a new Instagram DM; it arrives through the Instagram messaging webhook…");
  inbox.addIncoming("cnv_ig", "Hi, is the Incubator Model A still available?");
  await expect(row(page, "cnv_ig")).toContainText("still available", { timeout: 15_000 });
  await row(page, "cnv_ig").click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await s.pause(2000);

  await s.caption("The agent replies within the standard messaging window (instagram_business_manage_messages)");
  await page.getByTestId("message-input").fill("Hi Liam, yes it is in stock and ships within 2 days.");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("thread-message").last()).toContainText("in stock");
  await s.pause(2500);

  await s.caption("This conversation's last customer message is older than 24 hours → the agent turns on Human Agent mode");
  const agent = page.getByTestId("human-agent-toggle");
  await expect(agent).toHaveAttribute("aria-checked", "false");
  await agent.click();
  await expect(agent).toHaveAttribute("aria-checked", "true");
  await s.pause(2500);
  await s.caption("Replies are now sent with the HUMAN_AGENT message tag (7-day window)");
  await page.getByTestId("message-input").fill("Following up on your question from last week: the incubator is back in stock.");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("thread-message").last()).toContainText("back in stock");
  await s.pause(2500);
  await s.end();
});
```

- [ ] **Step 3: messenger.review.ts**

```ts
import { expect, test } from "@playwright/test";
import { applyEnglishState, combine, inboxRoutes, settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

const row = (page: import("@playwright/test").Page, id: string) => page.locator(`[data-testid="conversation-row"][data-id="${id}"]`);

test("pages_messaging + pages_show_list + pages_manage_metadata + Human Agent", async ({ page }, testInfo) => {
  const inbox = inboxRoutes();
  const s = await startScenario(page, testInfo, {
    permission: "pages_messaging",
    title: "Connecting the Facebook Page and answering Messenger conversations",
    extra: combine(inbox.route, settingsRoutes()),
  });
  applyEnglishState(s.state);
  await s.caption("Settings → Messenger: the Page is chosen from the Pages the user manages (pages_show_list)");
  await page.goto("/ayarlar?tab=messenger");
  await expect(page.getByTestId("settings-tab-panel-messenger")).toBeVisible();
  await expect(page.getByTestId("messenger-page-id")).toHaveValue("296265270245200");
  await s.pause(2500);
  await s.caption("The webhook callback for the Page is registered via pages_manage_metadata (subscribed_apps)");
  await expect(page.getByTestId("messenger-callback")).toContainText("/webhooks/messenger");
  const subscribe = page.getByTestId("messenger-webhook-subscribe");
  if (await subscribe.isVisible().catch(() => false)) {
    await subscribe.click();
    await expect(page.getByTestId("messenger-action-feedback")).toContainText("Job queued");
  }
  await s.pause(2500);

  await s.caption("Messages: a customer writes to the Page on Messenger…");
  await page.goto("/mesajlar");
  await page.getByTestId("channel-filter").click();
  await page.getByTestId("channel-filter-messenger").click();
  inbox.addIncoming("cnv_fb", "Hello! Do you deliver to Edinburgh?");
  await expect(row(page, "cnv_fb")).toContainText("Edinburgh", { timeout: 15_000 });
  await row(page, "cnv_fb").click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await s.pause(2000);
  await s.caption("The agent replies through the Messenger Send API (pages_messaging)");
  await page.getByTestId("message-input").fill("Hi Olivia, yes we deliver to Edinburgh within 3 working days.");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("thread-message").last()).toContainText("Edinburgh");
  await s.pause(2500);
  await s.caption("Human Agent mode lets the agent follow up for 7 days after the customer's last message");
  const agent = page.getByTestId("human-agent-toggle");
  await agent.click();
  await expect(agent).toHaveAttribute("aria-checked", "true");
  await s.pause(2500);
  await s.end();
});
```

- [ ] **Step 4: Üçünü çalıştır**

Run: `npx playwright test -c tests/meta-review/playwright.config.ts whatsapp-messaging instagram-messages messenger`
Expected: 3 passed. Olası düzeltmeler: `composer-attach-menu` tıklaması sonrası görünen dosya girişinin test id'si `composer-image-file` değilse `apps/web-beta/src/pages/messages/composer.tsx` içinden gerçek id'yi al; `shortcut-row-shipping` id'si `shortcut-row-<code>` deseninden türetilir (code "shipping"); Messenger sekmesinde webhook düğmesi yoksa `if` bloğu atlanır (bu kabul edilir, altyazı yine de callback URL'sini gösterir).

- [ ] **Step 5: Commit**

```bash
git add tests/meta-review/whatsapp-messaging.review.ts tests/meta-review/instagram-messages.review.ts tests/meta-review/messenger.review.ts
git commit -m "test(meta-review): WhatsApp, Instagram DM ve Messenger mesajlaşma senaryoları

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Yönetim senaryoları: WhatsApp management, Page comments, business_management

**Files:**
- Create: `tests/meta-review/whatsapp-management.review.ts`
- Create: `tests/meta-review/page-comments.review.ts`
- Create: `tests/meta-review/business-management.review.ts`

- [ ] **Step 1: whatsapp-management.review.ts**

```ts
import { expect, test } from "@playwright/test";
import { settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("whatsapp_business_management", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "whatsapp_business_management",
    title: "Managing the WhatsApp Business Account from Settings",
    extra: settingsRoutes(),
  });
  await s.caption("Opening Settings → WhatsApp");
  await page.goto("/ayarlar?tab=whatsapp");
  await expect(page.getByTestId("settings-tab-panel-whatsapp")).toBeVisible();
  await s.caption("The WABA, phone number id and display number are read with whatsapp_business_management");
  await expect(page.getByTestId("whatsapp-phone-number-id")).toHaveValue("1128646770325911");
  await expect(page.getByTestId("whatsapp-waba-id")).toHaveValue("1931036684950470");
  await s.pause(3000);
  await s.caption("The webhook callback URL registered on the WABA for incoming messages and statuses");
  await expect(page.getByTestId("whatsapp-callback")).toContainText("/webhooks/whatsapp");
  await s.pause(2500);
  await s.caption("Updating the business display number and saving the account settings");
  await page.getByTestId("whatsapp-display-phone").fill("+90 322 911 03 70");
  await page.getByTestId("whatsapp-save").click();
  await expect(page.getByTestId("whatsapp-feedback")).toHaveText("Settings saved.");
  await s.pause(2500);
  await s.end();
});
```

- [ ] **Step 2: page-comments.review.ts**

```ts
import { expect, test } from "@playwright/test";
import { chooseOption } from "../playwright-beta/helpers";
import { commentRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("pages_read_engagement + pages_read_user_content + pages_manage_engagement", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "pages_manage_engagement",
    title: "Reading and moderating comments on the Facebook Page",
    extra: commentRoutes(),
  });
  await s.caption("Opening Comments and filtering by Facebook");
  await page.goto("/yorumlar");
  await expect(page.getByTestId("page-comments")).toBeVisible();
  await chooseOption(page.getByTestId("filter-platform"), "facebook");
  await expect(page.getByTestId("comment-card")).toHaveCount(2);
  await s.caption("Page posts and visitor comments are read with pages_read_engagement and pages_read_user_content");
  await s.pause(3000);

  await s.caption("Replying to a product question (pages_manage_engagement)");
  await page.getByTestId("comment-card").first().getByTestId("comment-reply").click();
  const sheet = page.getByTestId("comment-reply-sheet");
  await sheet.getByTestId("comment-ai-suggest").click();
  await expect(sheet.getByTestId("comment-reply-message")).toHaveValue(/Hi George/);
  await s.pause(2000);
  await sheet.getByTestId("comment-reply-send").click();
  await expect(page.getByTestId("comments-feedback")).toHaveText("Reply sent");
  await s.pause(2000);

  await s.caption("Hiding an abusive comment from the Page");
  await page.getByTestId("comment-card").nth(1).getByTestId("comment-hide").click();
  await expect(page.getByTestId("comments-feedback")).toHaveText("Comment hidden");
  await s.pause(2500);
  await s.end();
});
```

- [ ] **Step 3: business-management.review.ts**

```ts
import { expect, test } from "@playwright/test";
import { settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("business_management", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "business_management",
    title: "Listing the business portfolio assets connected to the panel",
    extra: settingsRoutes(),
  });
  await s.caption("Opening Settings → Integrations");
  await page.goto("/ayarlar?tab=integrations");
  await expect(page.getByTestId("settings-integration-cards")).toBeVisible();
  await s.caption("business_management lets the system user read the Page, Instagram account and WABA owned by the business portfolio");
  await expect(page.getByTestId("settings-integration-account-whatsapp")).toContainText(/active/i);
  await expect(page.getByTestId("settings-integration-account-instagram")).toContainText(/active/i);
  await expect(page.getByTestId("settings-integration-account-messenger")).toContainText(/active/i);
  await s.pause(3000);
  await s.caption("Each card shows the asset id taken from the portfolio: WABA phone, Instagram user and Facebook Page");
  await expect(page.getByTestId("settings-integration-cards")).toContainText("1128646770325911");
  await expect(page.getByTestId("settings-integration-cards")).toContainText("296265270245200");
  await s.pause(3000);
  await s.caption("Opening the WhatsApp card leads to the asset's own settings page");
  await page.getByTestId("settings-integration-open-whatsapp").click();
  await expect(page.getByTestId("settings-tab-panel-whatsapp")).toBeVisible();
  await s.pause(2500);
  await s.end();
});
```

- [ ] **Step 4: Üçünü çalıştır**

Run: `npx playwright test -c tests/meta-review/playwright.config.ts whatsapp-management page-comments business-management`
Expected: 3 passed. Olası düzeltme: Integrations kartlarındaki İngilizce durum metni "Account active" ise regex zaten eşleşir; "Hesap kimliği" satırının İngilizcesi "Account id: …" olmalı, değilse `toContainText` id'yi yine bulur.

- [ ] **Step 5: Commit**

```bash
git add tests/meta-review/whatsapp-management.review.ts tests/meta-review/page-comments.review.ts tests/meta-review/business-management.review.ts
git commit -m "test(meta-review): WhatsApp yönetimi, Sayfa yorumları ve business_management senaryoları

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Video toplama script'i (webm → izin adı, isteğe bağlı mp4)

**Files:**
- Create: `tools/meta-review-collect.mjs`
- Create: `tests/meta-review/collect.test.ts` (vitest; script'in saf fonksiyonlarını test eder)

**Interfaces:**
- Produces (script dışa aktarır, `import.meta.url === process.argv[1]` ile doğrudan çalışınca `main()`):
  - `export const EXPECTED_PERMISSIONS = ["whatsapp_business_messaging","whatsapp_business_management","instagram_business_basic","instagram_business_manage_messages","instagram_business_manage_comments","instagram_business_content_publish","instagram_business_manage_insights","pages_messaging","pages_manage_engagement","business_management"]`
  - `export function findManifests(root: string): Array<{ dir: string; permission: string; title: string }>`
  - `export function findPlaywrightFfmpeg(home: string, env: NodeJS.ProcessEnv): string | null`
  - `export async function collect({ root, outDir, ffmpeg }): Promise<Array<{ permission: string; webm: string | null; mp4: string | null }>>`

- [ ] **Step 1: Başarısız testi yaz**

`tests/meta-review/collect.test.ts`:

```ts
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
```

- [ ] **Step 2: Testi çalıştır, kırmızı gör**

Run: `npx vitest run tests/meta-review/collect.test.ts`
Expected: FAIL, "Failed to resolve import ../../tools/meta-review-collect.mjs".

- [ ] **Step 3: Script'i yaz**

`tools/meta-review-collect.mjs`:

```js
#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_PERMISSIONS = [
  "whatsapp_business_messaging",
  "whatsapp_business_management",
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
  "pages_messaging",
  "pages_manage_engagement",
  "business_management",
];

/** Walks `root` for `meta-review.json` manifests written by tests/meta-review/recording.ts. */
export function findManifests(root) {
  const found = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "meta-review.json") {
        const data = JSON.parse(readFileSync(full, "utf8"));
        found.push({ dir, permission: data.permission, title: data.title });
      }
    }
  };
  walk(root);
  return found.sort((a, b) => a.permission.localeCompare(b.permission));
}

/** Playwright ships its own ffmpeg; use it for the optional mp4 so nothing else needs installing. */
export function findPlaywrightFfmpeg(home, env) {
  if (env.PLAYWRIGHT_FFMPEG && existsSync(env.PLAYWRIGHT_FFMPEG)) return env.PLAYWRIGHT_FFMPEG;
  const cache = join(home, "Library", "Caches", "ms-playwright");
  if (!existsSync(cache)) return null;
  for (const entry of readdirSync(cache).filter((name) => name.startsWith("ffmpeg-")).sort().reverse()) {
    for (const binary of ["ffmpeg-mac", "ffmpeg-mac-arm64", "ffmpeg-linux", "ffmpeg-win64.exe"]) {
      const full = join(cache, entry, binary);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

export async function collect({ root, outDir, ffmpeg }) {
  mkdirSync(outDir, { recursive: true });
  const manifests = findManifests(root);
  return EXPECTED_PERMISSIONS.map((permission) => {
    const manifest = manifests.find((item) => item.permission === permission);
    const source = manifest ? join(manifest.dir, "video.webm") : null;
    if (!source || !existsSync(source)) return { permission, webm: null, mp4: null };
    const webm = join(outDir, `${permission}.webm`);
    copyFileSync(source, webm);
    let mp4 = null;
    if (ffmpeg) {
      mp4 = join(outDir, `${permission}.mp4`);
      try {
        execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: "inherit" });
      } catch {
        mp4 = null;
      }
    }
    return { permission, webm, mp4 };
  });
}

async function main() {
  const root = resolve("test-results/meta-review");
  const outDir = resolve("tmp/meta-review-videos");
  const ffmpeg = findPlaywrightFfmpeg(homedir(), process.env);
  if (!ffmpeg) console.log("mp4 skipped: no ffmpeg found (set PLAYWRIGHT_FFMPEG to enable)");
  const rows = await collect({ root, outDir, ffmpeg });
  console.log("\nMeta App Review videos");
  for (const row of rows) console.log(`${row.webm ? "OK     " : "MISSING"}  ${row.permission.padEnd(40)}  ${row.webm ?? "-"}  ${row.mp4 ?? ""}`);
  const missing = rows.filter((row) => !row.webm);
  if (missing.length) {
    console.error(`\n${missing.length} video(s) missing`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
```

- [ ] **Step 4: Testi çalıştır, yeşil gör**

Run: `npx vitest run tests/meta-review/collect.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/meta-review-collect.mjs tests/meta-review/collect.test.ts
git commit -m "tools: Meta review videolarını izin adıyla toplayan script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Uçtan uca koşu, kalite kontrolü ve belgeler

**Files:**
- Modify: `docs/operations/META_APP_PERMISSIONS.md` (yalnız 5. bölüm: komut ve çıktı yolu; dosya `origin/docs/meta-app-permissions` dalında, bu dalda yoksa `git checkout origin/docs/meta-app-permissions -- docs/operations/META_APP_PERMISSIONS.md` ile getir)
- Modify: `docs/testing/TEST_STRATEGY.md` (bir paragraf: meta-review projesi test değil kanıt üretir, CI'da koşmaz)

- [ ] **Step 1: Tam koşu**

Run: `npm run review:videos`
Expected: 10 passed; collect tablosunda 10 satır OK, `tmp/meta-review-videos/` altında 10 `.webm` ve (Playwright ffmpeg bulunduysa) 10 `.mp4`. MISSING varsa ilgili senaryoyu tek başına çalıştırıp hatayı düzelt, yeniden koş.

- [ ] **Step 2: Kare kontrolü**

Run (ffmpeg varsa; yol `node -e "import('./tools/meta-review-collect.mjs').then(m=>console.log(m.findPlaywrightFfmpeg(require('os').homedir(),process.env)))"` ile bulunur):

```bash
FF=$(node -e "import('./tools/meta-review-collect.mjs').then(m=>console.log(m.findPlaywrightFfmpeg(require('os').homedir(),process.env)))")
for f in tmp/meta-review-videos/*.webm; do "$FF" -y -loglevel error -ss 3 -i "$f" -frames:v 1 "${f%.webm}-first.png"; "$FF" -y -loglevel error -sseof -2 -i "$f" -frames:v 1 "${f%.webm}-last.png"; done
```

Expected: her `-first.png` üstte İngilizce başlık şeridini ("… — permission: …"), her `-last.png` "End of demonstration" şeridini gösterir. Playwright `--ui` veya Finder ile de açılıp izlenebilir. Türkçe metin görülürse fixture'daki ilgili alanı düzelt.

- [ ] **Step 3: Belgeleri güncelle**

`docs/operations/META_APP_PERMISSIONS.md` 5. bölümün sonuna:

```markdown
Üretim: `npm run review:videos` → `tmp/meta-review-videos/<izin>.webm` (+ `.mp4`). Senaryolar `tests/meta-review/`, tasarım
`docs/superpowers/specs/2026-10-11-meta-review-videos-design.md`. Videolar taklit backend'e karşı çekilir; Meta gerçek
Instagram/WhatsApp tarafını isterse ikinci tur gerçek ortamda alınır.
```

`docs/testing/TEST_STRATEGY.md` uygun bölüme:

```markdown
### Meta App Review kayıtları (tests/meta-review)
`*.review.ts` senaryoları test değil kanıt üretir: web-beta'yı İngilizce, 1440×900, altyazılı ve videolu koşturur.
CI'da çalışmaz; `npm run review:videos` elle çalıştırılır. Taklit veri `tests/meta-review/fixtures.ts`, helpers paylaşımı
`tests/playwright-beta/helpers.ts` üzerinden.
```

- [ ] **Step 4: Yapı ve mevcut testler bozulmadı mı**

Run: `npm run verify:structure && npx vitest run tests/meta-review && npm run test:e2e:beta`
Expected: verify:structure OK; vitest 8 passed; beta e2e önceki durumuyla aynı (meta-review dosyalarını görmez).

- [ ] **Step 5: Commit ve PR**

```bash
git add docs/operations/META_APP_PERMISSIONS.md docs/testing/TEST_STRATEGY.md
git commit -m "docs: Meta review video üretimi ve test stratejisi notu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/meta-review-videos
gh pr create --title "Meta App Review kanıt videoları (tests/meta-review)" --body "$(cat <<'EOF'
## Özet
- `tests/meta-review/`: web-beta'da İngilizce, altyazılı, 1440×900 ekran kayıtları üreten ayrı Playwright projesi (10 izin/özellik).
- `tools/meta-review-collect.mjs`: videoları izin adıyla `tmp/meta-review-videos/` altına toplar, Playwright ffmpeg varsa mp4 üretir.
- Ürün koduna dokunulmadı; taklit backend `tests/playwright-beta/helpers.ts` üzerinden.

Spec: docs/superpowers/specs/2026-10-11-meta-review-videos-design.md
Plan: docs/superpowers/plans/2026-10-11-meta-review-videos.md

## Test
- `npm run review:videos` → 10 video
- `npx vitest run tests/meta-review` → fixtures + collect birim testleri
- `npm run verify:structure`, `npm run test:e2e:beta` etkilenmedi

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
