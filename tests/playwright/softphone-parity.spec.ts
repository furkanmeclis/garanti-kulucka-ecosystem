import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// Browser softphone (legacy SoftphoneWidget + GelenCagriModal on JsSIP). SIP is faked through
// window.__GARANTI_SIP_ENGINE_FACTORY__: no SIP WebSocket is ever opened.
const backendBaseUrl = "http://127.0.0.1:65526";

test.setTimeout(90_000);

const staff = { public_id: "usr_staff", email: "staff@example.com", first_name: "Ayşe", last_name: "Kaya", role: "calisan", permissions: [], is_online: true, sip_username: "1001" };

const webphone = (enabled: boolean) => ({
  enabled,
  sip_websocket_url: enabled ? "wss://pbx.example.com/ws" : null,
  sip_domain: enabled ? "pbx.example.com" : null,
  sip_username: enabled ? "1001" : null,
  sip_password: enabled ? "sip-secret" : null,
  ice_servers: [{ urls: "stun:stun.l.google.com:19302" }],
  media_proxy_enabled: false,
  transport: "direct_sip_over_webrtc",
});

declare global {
  interface Window {
    __SIP_TEST__: {
      config: Record<string, unknown> | null;
      actions: string[];
      register: (state: string, reason?: string) => void;
      incoming: (remote: string, name: string | null) => void;
      remoteAnswered: () => void;
      remoteHangup: () => void;
    };
  }
}

async function startWebApp() {
  const server = await createServer({
    root: "apps/web",
    configFile: "apps/web/vite.config.ts",
    server: { host: "127.0.0.1", port: 0 },
    define: { "import.meta.env.VITE_BACKEND_BASE_URL": JSON.stringify(backendBaseUrl) },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite dev server did not expose a TCP address");
  return { url: `http://127.0.0.1:${address.port}`, server };
}

/** Fake SIP engine: records every UI action and lets the test drive registration and remote events. */
async function installFakeSip(page: Page) {
  await page.addInitScript(() => {
    window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => ({ connect() {}, disconnect() {}, emit() {}, on() {}, off() {} }) as never;
    const test = {
      config: null as Record<string, unknown> | null,
      actions: [] as string[],
      register: (_state: string, _reason?: string) => undefined,
      incoming: (_remote: string, _name: string | null) => undefined,
      remoteAnswered: () => undefined,
      remoteHangup: () => undefined,
    };
    window.__SIP_TEST__ = test;
    window.__GARANTI_SIP_ENGINE_FACTORY__ = (config, events) => {
      test.config = config as unknown as Record<string, unknown>;
      let call: Parameters<typeof events.onCall>[0] = null;
      let sequence = 0;
      const update = (patch: Partial<NonNullable<typeof call>> | null) => {
        call = patch === null ? null : ({ ...(call ?? {}), ...patch } as NonNullable<typeof call>);
        events.onCall(call);
      };
      test.register = (state, reason) => events.onRegistration(state as never, reason);
      test.incoming = (remote, name) => {
        sequence += 1;
        update({ id: `in_${sequence}`, direction: "incoming", remote, remoteName: name, phase: "ringing", held: false, muted: false, startedAt: null, endReason: null });
      };
      test.remoteAnswered = () => update({ phase: "active", startedAt: Date.now() });
      test.remoteHangup = () => update({ phase: "ended", endReason: "BYE" });
      return {
        start: () => {
          test.actions.push("start");
          events.onRegistration("registered");
        },
        stop: () => test.actions.push("stop"),
        call: (target: string) => {
          test.actions.push(`call:${target}`);
          sequence += 1;
          update({ id: `out_${sequence}`, direction: "outgoing", remote: target, remoteName: null, phase: "ringing", held: false, muted: false, startedAt: null, endReason: null });
        },
        answer: () => {
          test.actions.push("answer");
          update({ phase: "active", startedAt: Date.now() });
        },
        hangup: () => {
          test.actions.push("hangup");
          update({ phase: "ended", endReason: "Terminated" });
        },
        setHold: (held: boolean) => {
          test.actions.push(held ? "hold" : "unhold");
          update({ held });
        },
        setMuted: (muted: boolean) => {
          test.actions.push(muted ? "mute" : "unmute");
          update({ muted });
        },
        sendDtmf: (tone: string) => test.actions.push(`dtmf:${tone}`),
      };
    };
  });
}

async function mockBackend(page: Page, enabled = true) {
  await installFakeSip(page);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (payload: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    if (url.pathname === "/auth/login") return json({ access_token: "sp-token", refresh_token: "sp-refresh", token_type: "Bearer", expires_in: 900, user: staff });
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(staff);
    if (url.pathname === "/api/webphone/config") return json(webphone(enabled));
    if (url.pathname === "/api/customers/cus_sp") {
      return json({
        customer: { public_id: "cus_sp", full_name: "Aranacak Müşteri", phone: "05551112233", email: null, username: null, notes: null, created_at: "2026-10-01T09:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z" },
        addresses: [],
        orders: [],
        conversations: [],
      });
    }
    if (url.pathname.endsWith("/summary")) return json({ total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: {}, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY", with_phone_count: 0, with_email_count: 0, with_notes_count: 0, critical_count: 0, critical_threshold: 3, category_counts: {}, recipient_phone_count: 0, provider_counts: {}, exception_counts: {}, total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0, manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 });
    if (url.pathname === "/api/shipments/pipeline-summary") return json({ counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] });
    if (url.pathname === "/api/comments/moderation-summary") return json({ manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 });
    return json({ data: [], meta: { total_count: 0, limit: 20, offset: 0 } });
  });
}

async function loginAt(page: Page, url: string) {
  await page.goto(url);
  await page.locator('input[type="email"]').fill(staff.email);
  await page.locator('input[type="password"]').fill("secret-password");
  await Promise.all([page.waitForResponse(`${backendBaseUrl}/auth/login`), page.locator('button[type="submit"]').click()]);
}

const actions = (page: Page) => page.evaluate(() => window.__SIP_TEST__.actions);

test.describe("browser softphone", () => {
  let app: Awaited<ReturnType<typeof startWebApp>>;

  test.beforeAll(async () => {
    app = await startWebApp();
  });

  test.afterAll(async () => {
    await (app.server as ViteDevServer).close();
  });

  test("registers with /api/webphone/config and runs an outgoing call with hold, mute, keypad and hangup", async ({ page }) => {
    await mockBackend(page);
    await loginAt(page, `${app.url}/mesajlar`);
    await page.getByTestId("softphone-toggle").click();
    await expect(page.getByTestId("softphone-registration")).toHaveText("Bağlı");
    expect(await page.evaluate(() => window.__SIP_TEST__.config)).toMatchObject({
      websocketUrl: "wss://pbx.example.com/ws",
      domain: "pbx.example.com",
      username: "1001",
      password: "sip-secret",
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    await page.getByTestId("softphone-number").fill("0555 111 22 33");
    await page.getByTestId("softphone-call-button").click();
    await expect(page.getByTestId("softphone-call-state")).toHaveText("Çalıyor…");
    await page.evaluate(() => window.__SIP_TEST__.remoteAnswered());
    await expect(page.getByTestId("softphone-call-state")).toContainText("Görüşmede · 00:0");

    await page.getByTestId("softphone-hold").click();
    await expect(page.getByTestId("softphone-held")).toHaveText("Beklemede");
    await expect(page.getByTestId("softphone-hold")).toHaveText("Devam");
    await page.getByTestId("softphone-hold").click();
    await expect(page.getByTestId("softphone-held")).toHaveCount(0);

    await page.getByTestId("softphone-mute").click();
    await expect(page.getByTestId("softphone-muted")).toHaveText("Mikrofon kapalı");
    await page.getByTestId("softphone-mute").click();

    await page.getByRole("button", { name: "Tuş takımı" }).click();
    await page.getByTestId("softphone-keypad").getByRole("button", { name: "5" }).click();
    await page.getByTestId("softphone-keypad").getByRole("button", { name: "#" }).click();

    await page.getByTestId("softphone-hangup").click();
    await expect(page.getByTestId("softphone-call-state")).toHaveText("Görüşme bitti");
    await expect(page.getByTestId("softphone-call")).toHaveCount(0, { timeout: 6000 });
    expect(await actions(page)).toEqual(["start", "call:0555 111 22 33", "hold", "unhold", "mute", "unmute", "dtmf:5", "dtmf:#", "hangup"]);
  });

  test("incoming call screen answers or rejects", async ({ page }) => {
    await mockBackend(page);
    await loginAt(page, `${app.url}/mesajlar`);
    await expect(page.getByTestId("softphone-toggle")).toBeVisible();

    await page.evaluate(() => window.__SIP_TEST__.incoming("05551112233", "Ayşe Müşteri"));
    await expect(page.getByTestId("softphone-incoming")).toBeVisible();
    await expect(page.getByTestId("softphone-incoming-caller")).toHaveText("Ayşe Müşteri arıyor");
    await page.getByTestId("softphone-answer").click();
    await expect(page.getByTestId("softphone-incoming")).toHaveCount(0);
    await expect(page.getByTestId("softphone-panel")).toBeVisible();
    await expect(page.getByTestId("softphone-remote")).toHaveText("Ayşe Müşteri");
    await expect(page.getByTestId("softphone-call-state")).toContainText("Görüşmede");
    await page.evaluate(() => window.__SIP_TEST__.remoteHangup());
    await expect(page.getByTestId("softphone-call-state")).toHaveText("Görüşme bitti");

    await page.evaluate(() => window.__SIP_TEST__.incoming("05559998877", null));
    await expect(page.getByTestId("softphone-incoming-caller")).toHaveText("05559998877 arıyor");
    await page.getByTestId("softphone-reject").click();
    await expect(page.getByTestId("softphone-incoming")).toHaveCount(0);
    expect(await actions(page)).toEqual(["start", "answer", "hangup"]);
  });

  test("click-to-call from the customer card and registration failure state", async ({ page }) => {
    await mockBackend(page);
    await loginAt(page, `${app.url}/musteriler/cus_sp`);
    await page.getByTestId("click-to-call").click();
    await expect(page.getByTestId("softphone-panel")).toBeVisible();
    await expect(page.getByTestId("softphone-remote")).toHaveText("05551112233");
    expect(await actions(page)).toContain("call:05551112233");
    await page.getByTestId("softphone-hangup").click();

    await page.evaluate(() => window.__SIP_TEST__.register("failed", "Authentication Error"));
    await expect(page.getByTestId("softphone-registration")).toHaveText("Kayıt başarısız: Authentication Error");
    await expect(page.getByTestId("softphone-call-button")).toBeDisabled();
  });

  test("hidden without a SIP account; English and 360px layout with one", async ({ page }) => {
    await mockBackend(page, false);
    await loginAt(page, `${app.url}/mesajlar`);
    await expect(page.getByTestId("inbox-flow")).toBeVisible();
    await expect(page.getByTestId("softphone-toggle")).toHaveCount(0);
    expect(await page.evaluate(() => window.__SIP_TEST__.config)).toBeNull();

    const other = await page.context().newPage();
    await other.setViewportSize({ width: 360, height: 740 });
    await mockBackend(other, true);
    await other.addInitScript(() => window.localStorage.setItem("garanti-lang", "en"));
    await other.goto(`${app.url}/mesajlar`);
    await other.getByTestId("softphone-toggle").click();
    await expect(other.getByTestId("softphone-registration")).toHaveText("Connected");
    await expect(other.getByTestId("softphone-call-button")).toContainText("Call");
    const box = await other.getByTestId("softphone-panel").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(361);
    const overflow = await other.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
