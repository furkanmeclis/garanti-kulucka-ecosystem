import { expect, test, type Page } from "@playwright/test";
import type {} from "../../apps/web-beta/src/softphone/engine";
import { login, mockBackend, mockUser, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

declare global {
  interface Window {
    __BETA_SIP__: {
      config: Record<string, unknown> | null;
      actions: string[];
      register: (state: string, reason?: string) => void;
      incoming: (remote: string, name: string | null) => void;
      remoteAnswered: () => void;
      remoteHangup: () => void;
    };
  }
}

async function installFakeSip(page: Page) {
  await page.addInitScript(() => {
    const test = {
      config: null as Record<string, unknown> | null,
      actions: [] as string[],
      register: (_state: string, _reason?: string) => undefined,
      incoming: (_remote: string, _name: string | null) => undefined,
      remoteAnswered: () => undefined,
      remoteHangup: () => undefined,
    };
    window.__BETA_SIP__ = test;
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


async function setup(page: Page, enabled = true) {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await installFakeSip(page);
  const extra: ExtraRoute = ({ path }) => {
    if (path === "/api/webphone/config") return { status: 200, body: { enabled, sip_websocket_url: "wss://pbx.invalid/ws", sip_domain: "pbx.invalid", sip_username: "1001", sip_password: "test", ice_servers: [] } };
    if (path === "/api/orders/customer-lookup") return { status: 200, body: { customer: { public_id: "cus_1", full_name: "Ayşe Yılmaz", phone: "05551234567" }, default_address: null } };
    if (path === "/api/orders/ord_1/actions") return { status: 200, body: { order: {
      public_id: "ord_1", order_number: "GK-1001", status: "draft", notes: null, total_amount: "300.00", currency: "TRY", customer_full_name: "Ayşe Yılmaz", customer_phone: "05551234567", deleted_at: null, confirmation_status: null,
      kolaybi: { contact_id: null, address_id: null, invoice_id: null, status: null, error: null, e_document_status: null },
      confirmation_call: { status: null, bulk_id: null, pressed_key: null, listen_seconds: null, call_count: 0 }, created_at: "2026-10-07T09:00:00.000Z", updated_at: "2026-10-07T09:00:00.000Z",
    }, steps: [] } };
    if (path === "/api/call-logs/client-events") return { status: 404, body: {} };
    return undefined;
  };
  const state = await mockBackend(page, mockUser("admin"), { extra });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  if (enabled) await expect(page.getByTestId("softphone-registration")).toHaveAttribute("data-state", "registered");
  return Object.assign(state, { sockets });
}

test("softphone: order call, controls, contextual client event and silent 404", async ({ page }) => {
  const state = await setup(page);
  await page.getByTestId("desktop-nav").getByRole("link", { name: "Siparişler", exact: true }).click();
  await page.getByTestId("orders-table").getByTestId("order-open").filter({ hasText: "GK-1001" }).click();
  await page.getByTestId("order-detail").getByTestId("click-to-call").click();
  const panel = page.getByTestId("softphone-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("softphone-call-state")).toContainText("Çalıyor");
  await page.evaluate(() => window.__BETA_SIP__.remoteAnswered());
  await panel.getByTestId("softphone-mute").click();
  await expect(panel.getByTestId("softphone-mute")).toHaveAttribute("aria-pressed", "true");
  await panel.getByTestId("softphone-hold").click();
  await expect(panel.getByTestId("softphone-hold")).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "5", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BETA_SIP__.actions)).toContain("dtmf:5");
  await expect.poll(() => panel.getByTestId("softphone-call-state").textContent()).toMatch(/00:0[1-9]/);
  await panel.getByTestId("softphone-hangup").click();
  await expect(panel.getByTestId("softphone-call-state")).toContainText("Görüşme bitti");
  await expect.poll(() => state.bodies.filter((entry) => entry.path === "/api/call-logs/client-events").length).toBe(1);
  const body = state.bodies.find((entry) => entry.path === "/api/call-logs/client-events")!.body as Record<string, unknown>;
  expect(body).toMatchObject({ direction: "outbound", phone: "05551234567", order_public_id: "ord_1", customer_public_id: "cus_1", client_status: "answered", talk_seconds: expect.any(Number) });
  expect(Date.parse(String(body.ended_at))).toBeGreaterThan(Date.parse(String(body.started_at)));
  expect(body.talk_seconds).toBeGreaterThan(0);
  expect(state.sockets).toEqual([]);
  expect(await page.evaluate(() => window.__BETA_SIP__.actions.filter((value) => value === "start").length)).toBe(1);
});

test("softphone: incoming customer match, answer/reject and 360px layout", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const state = await setup(page);
  await page.evaluate(() => window.__BETA_SIP__.incoming("05551234567", null));
  const modal = page.getByTestId("softphone-incoming");
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId("softphone-incoming-caller")).toHaveText("Ayşe Yılmaz");
  await expect(modal).toContainText("05551234567");
  await modal.getByTestId("softphone-answer").click();
  await expect(modal).toBeHidden();
  const panel = page.getByTestId("softphone-panel");
  await expect(panel.getByTestId("softphone-call-state")).toContainText("Görüşmede");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await panel.getByRole("button").all()) {
    const box = await button.boundingBox();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await panel.getByTestId("softphone-hangup").click();
  await page.evaluate(() => window.__BETA_SIP__.incoming("05551234567", null));
  await expect(modal).toBeVisible();
  await modal.getByTestId("softphone-reject").click();
  await expect(modal).toBeHidden();
  await expect.poll(() => state.bodies.filter((entry) => entry.path === "/api/call-logs/client-events").length).toBe(2);
  expect(state.sockets).toEqual([]);
  expect(state.bodies.filter((entry) => entry.path === "/api/call-logs/client-events").at(-1)?.body).toMatchObject({ direction: "inbound", client_status: "cancelled", talk_seconds: 0 });
});

test("softphone: no SIP account leaves no phone UI or engine", async ({ page }) => {
  await setup(page, false);
  await expect(page.getByTestId("softphone-toggle")).toHaveCount(0);
  expect(await page.evaluate(() => window.__BETA_SIP__.actions)).toEqual([]);
});
