import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => ({
  token: null as string | null,
  events: [] as Array<{ payload: Record<string, unknown>; status: string }>,
  applied: [] as unknown[],
  broadcasts: [] as unknown[],
  repository: {
    webhookToken: vi.fn(async () => mocks.token),
    recordEvent: vi.fn(async (payload: Record<string, unknown>, status: string) => {
      mocks.events.push({ payload, status });
    }),
    apply: vi.fn(async (result: { bulkId: string }) => {
      mocks.applied.push(result);
      return result.bulkId === "B-404" ? null : { public_id: "ord_1", status: "pending" };
    }),
  },
}));

vi.mock("../src/orders/ivr-webhook.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/orders/ivr-webhook.js")>();
  return { ...actual, IvrWebhookRepository: vi.fn(function IvrWebhookRepository() { return mocks.repository; }) };
});

const { createApp } = await import("../src/app.js");
const { parseIvrWebhook, ivrPayloadFrom } = await import("../src/orders/ivr-webhook.js");

const config: ApiConfig = { databaseUrl: null, jwtSecret: "ivr-test-secret", encryptionKey: "ivr-test-encryption-key", encryptionKeyId: "test", accessTokenTtlSeconds: 300, refreshTokenTtlDays: 30, redisUrl: null, corsOrigin: null };
const realtimePublisher = { broadcast: vi.fn((event: unknown) => mocks.broadcasts.push(event)), publishToConversation: vi.fn(), publishToUser: vi.fn() };

function app() {
  return createApp({ config, db: {} as AppDatabase, realtimePublisher: realtimePublisher as never });
}

describe("NetGSM IVR (teyit) webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = null;
    mocks.events.length = 0;
    mocks.applied.length = 0;
    mocks.broadcasts.length = 0;
  });

  it("maps NetGSM states and key presses like the legacy handler", () => {
    expect(parseIvrWebhook({ bulkid: 123, state: "1", bilsec: "14" })).toEqual({ bulkId: "123", callStatus: "cevaplandi", pressedKey: null, listenSeconds: 14, confirmationStatus: "teyit_edildi" });
    expect(parseIvrWebhook({ bulkid: "1", state: 1, detail: { push_button: "9" } })).toMatchObject({ pressedKey: "9", confirmationStatus: "iptal_istegi" });
    expect(parseIvrWebhook({ bulkid: "1", state: "6" })).toMatchObject({ callStatus: "gecersiz_numara", confirmationStatus: "gecersiz_numara" });
    for (const state of ["2", "3", "7"]) expect(parseIvrWebhook({ bulkid: "1", state })?.confirmationStatus).toBe("ulasilamadi");
    expect(parseIvrWebhook({ bulkid: "1", state: "4" })).toBeNull();
    expect(parseIvrWebhook({ state: "1" })).toBeNull();
    expect(ivrPayloadFrom(undefined, { bulkid: "5", state: "1", "detail[push_button]": "2" })).toMatchObject({ detail: { push_button: "2" } });
  });

  it("accepts JSON, form and query callbacks without authentication and updates the order", async () => {
    const json = await app().request("/api/netgsm/webhook/sesli-mesaj", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bulkid: "B-1", state: "1", push_button: "1", bilsec: "20" }) });
    expect(json.status).toBe(200);
    await expect(json.json()).resolves.toEqual({ ok: true, processed: true, order_public_id: "ord_1", confirmation_status: "teyit_edildi" });

    const form = await app().request("/api/netgsm/webhook/sesli-mesaj", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "bulkid=B-2&state=1&push_button=9" });
    await expect(form.json()).resolves.toMatchObject({ confirmation_status: "iptal_istegi" });

    const query = await app().request("/api/netgsm/webhook/sesli-mesaj?bulkid=B-3&state=3");
    await expect(query.json()).resolves.toMatchObject({ processed: true, confirmation_status: "ulasilamadi" });

    expect(mocks.applied).toHaveLength(3);
    expect(mocks.broadcasts[0]).toMatchObject({ event: "order.updated", payload: { order_public_id: "ord_1", status: "pending" } });
    expect(mocks.events.map((event) => event.status)).toEqual(["processed", "processed", "processed"]);
  });

  it("answers 200 for unknown bulk ids, unknown states and internal errors", async () => {
    const unknown = await app().request("/api/netgsm/webhook/sesli-mesaj?bulkid=B-404&state=1");
    await expect(unknown.json()).resolves.toMatchObject({ ok: true, processed: false });
    const ignored = await app().request("/api/netgsm/webhook/sesli-mesaj?bulkid=B-5&state=99");
    await expect(ignored.json()).resolves.toEqual({ ok: true, processed: false });
    mocks.repository.apply.mockRejectedValueOnce(new Error("db down"));
    const failed = await app().request("/api/netgsm/webhook/sesli-mesaj?bulkid=B-6&state=1");
    expect(failed.status).toBe(200);
    expect(mocks.events.map((event) => event.status)).toEqual(["ignored", "ignored"]);
  });

  it("requires the shared token when one is configured and never strips it into the stored payload", async () => {
    mocks.token = "ivr-token-0123456789";
    expect((await app().request("/api/netgsm/webhook/sesli-mesaj?bulkid=B-1&state=1")).status).toBe(401);
    expect((await app().request("/api/netgsm/webhook/sesli-mesaj?bulkid=B-1&state=1&token=wrong")).status).toBe(401);
    const ok = await app().request("/api/netgsm/webhook/sesli-mesaj?bulkid=B-1&state=1&token=ivr-token-0123456789");
    expect(ok.status).toBe(200);
    expect(mocks.events[0]?.payload).not.toHaveProperty("token");
  });

  it("keeps the admin NetGSM routes protected", async () => {
    expect((await app().request("/api/netgsm/status")).status).toBe(401);
  });
});
