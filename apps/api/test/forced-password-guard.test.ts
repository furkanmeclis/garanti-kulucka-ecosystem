import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "../src/http/middleware.js";
import type { AppBindings } from "../src/http/types.js";

const state = vi.hoisted(() => ({ required: true }));
vi.mock("../src/auth/tokens.js", () => ({ verifyAccessToken: async () => ({ user_public_id: "usr_test", session_public_id: "ses_test", role: "owner" }) }));
vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: class {
    async findUserByPublicId() { return { id: 1, must_change_password: state.required }; }
    async findSessionByPublicId() { return { user_id: 1 }; }
  },
  isAdminRole: () => true,
}));

function app() {
  const app = new Hono<AppBindings>();
  app.use("*", async (context, next) => { context.set("db", {} as never); context.set("config", {} as never); await next(); });
  app.use("*", authenticate);
  app.all("*", (context) => context.json({ ok: true }));
  return app;
}
describe("forced password change HTTP guard", () => {
  beforeEach(() => { state.required = true; });
  it.each([["GET", "/auth/me"], ["POST", "/auth/logout"], ["POST", "/auth/account/password"]])("allows %s %s", async (method, path) => {
    expect((await app().request(path, { method, headers: { authorization: "Bearer fixture" } })).status).toBe(200);
  });
  it.each([["GET", "/api/admin/users"], ["GET", "/api/orders"], ["PATCH", "/auth/presence"], ["PATCH", "/auth/account/profile"], ["GET", "/auth/account/password"], ["POST", "/auth/me"], ["GET", "/auth/me/extra"]])("blocks %s %s with a clear error", async (method, path) => {
    const response = await app().request(path, { method, headers: { authorization: "Bearer fixture" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "password_change_required" } });
  });
  it("rechecks the database for the same token after a successful password change", async () => {
    const server = app();
    const request = () => server.request("/api/orders", { headers: { authorization: "Bearer fixture" } });
    expect((await request()).status).toBe(403);
    state.required = false;
    expect((await request()).status).toBe(200);
  });
});
