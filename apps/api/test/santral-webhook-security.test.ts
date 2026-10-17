import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../src/http/types.js";
import { MemoryRateLimitStore } from "../src/http/rate-limit.js";

const mocks = vi.hoisted(() => ({
  token: null as string | null,
  recordEvent: vi.fn(async () => ({ id: 1 })),
  ingest: vi.fn(async () => ({ id: 1, public_id: "call_test", recording_url: null })),
  claimMissedNotification: vi.fn(async () => false),
  execute: vi.fn(async () => []),
}));
vi.mock("@garanti-kulucka/database", async (original) => ({
  ...(await original<typeof import("@garanti-kulucka/database")>()),
  CallLogsRepository: vi.fn(function () {
    return { ...mocks, webhookToken: async () => mocks.token };
  }),
}));
const { createSantralWebhookRoutes } = await import("../src/http/call-log-routes.js");

function app(limit = 600) {
  const app = new Hono<AppBindings>();
  const store = new MemoryRateLimitStore();
  app.use("*", async (c, next) => {
    c.set("rateLimitStore", store);
    c.set("config", { webhookRateLimitPerMinute: limit } as never);
    c.set("logger", { info: vi.fn(), error: vi.fn(), warn: vi.fn() });
    const chain = { set: () => chain, where: () => chain, execute: mocks.execute };
    c.set("db", { updateTable: () => chain } as never);
    await next();
  });
  app.route("/", createSantralWebhookRoutes());
  return app;
}
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe.each(["development", "production"])("santral webhook %s", (env) => {
  it.each([null, "santral-token-0123456789"])("token %s always acknowledges and rejects forged work", async (expected) => {
    vi.stubEnv("APP_ENV", env); mocks.token = expected;
    for (const received of [undefined, "wrong", "santral-token-0123456789"]) {
      vi.clearAllMocks();
      const response = await app().request(`/santral${received ? `?token=${received}` : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "cdr", unique_id: "test" }) });
      const accepted = expected ? received === expected : env !== "production";
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, processed: accepted });
      expect(mocks.ingest).toHaveBeenCalledTimes(accepted ? 1 : 0);
      expect(mocks.recordEvent).toHaveBeenCalledWith(accepted ? expect.objectContaining({ scenario: "cdr" }) : {}, accepted ? "received" : "rejected");
      if (!accepted) expect(mocks.execute).not.toHaveBeenCalled();
    }
  });
});
it("limits bursts while preserving the santral HTTP 200 acknowledgment", async () => {
  mocks.token = "santral-token-0123456789";
  const api = app(1);
  const request = () => api.request("/santral?token=santral-token-0123456789", { method: "POST", headers: { "content-type": "application/json" }, body: '{"scenario":"cdr"}' });
  await request(); vi.clearAllMocks();
  const limited = await request();
  expect(limited.status).toBe(200);
  expect(await limited.json()).toEqual({ ok: true, processed: false });
  expect(limited.headers.get("retry-after")).toBeTruthy();
  expect(mocks.ingest).not.toHaveBeenCalled();
});
