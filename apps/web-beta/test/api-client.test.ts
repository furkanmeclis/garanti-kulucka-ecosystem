import { describe, expect, it, vi } from "vitest";
import { ApiError, buildUrl, createApiClient, isNetworkError } from "../src/lib/api";
import type { StoredTokens } from "../src/lib/session-storage";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setup(initial: StoredTokens | null, responses: Array<Response | ((url: string, init: RequestInit) => Response)>) {
  let tokens = initial;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return typeof next === "function" ? next(String(url), init ?? {}) : next;
  });
  const onSessionExpired = vi.fn();
  const api = createApiClient({
    baseUrl: "/backend",
    getTokens: () => tokens,
    setTokens: (next) => {
      tokens = next;
    },
    onSessionExpired,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { api, calls, onSessionExpired, tokens: () => tokens };
}

const user = { public_id: "usr_1", email: "a@example.com", role: "admin", permissions: [] };

describe("API client", () => {
  it("builds URLs from VITE_BACKEND_BASE_URL and skips empty query values", () => {
    expect(buildUrl("/backend", "/api/orders", { search: "ab c", status: "", offset: 0, limit: undefined })).toBe("/backend/api/orders?search=ab+c&offset=0");
    expect(buildUrl("http://127.0.0.1:3000/", "auth/me")).toBe("http://127.0.0.1:3000/auth/me");
  });

  it("logs in without a token, stores the pair and sends the bearer afterwards", async () => {
    const { api, calls, tokens } = setup(null, [json(200, { access_token: "at", refresh_token: "rt", token_type: "Bearer", expires_in: 900, user }), json(200, user)]);
    const session = await api.login("a@example.com", "pw");
    expect(session.user.role).toBe("admin");
    expect(tokens()).toEqual({ access_token: "at", refresh_token: "rt" });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: "a@example.com", password: "pw" });
    await api.me();
    expect(calls[1]!.url).toBe("/backend/auth/me");
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer at");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    const { api, calls, tokens } = setup({ access_token: "old", refresh_token: "rt" }, [
      json(401, { error: { code: "unauthorized" } }),
      json(200, { access_token: "new", refresh_token: "rt2", token_type: "Bearer", expires_in: 900 }),
      json(200, { total_count: 4, active_count: 1, delivered_count: 2, pending_confirmation_count: 1, total_revenue: 10, currency: "TRY" }),
    ]);
    const summary = await api.orderSummary();
    expect(summary.total_count).toBe(4);
    expect(calls.map((call) => call.url)).toEqual(["/backend/api/orders/summary", "/backend/auth/refresh", "/backend/api/orders/summary"]);
    expect((calls[2]!.init.headers as Record<string, string>).Authorization).toBe("Bearer new");
    expect(tokens()).toEqual({ access_token: "new", refresh_token: "rt2" });
  });

  it("clears the session and reports expiry when refresh fails", async () => {
    const { api, onSessionExpired, tokens } = setup({ access_token: "old", refresh_token: "rt" }, [json(401, {}), json(401, {})]);
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(tokens()).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("surfaces backend error codes and recognises network errors", async () => {
    const { api } = setup({ access_token: "t", refresh_token: "r" }, [json(403, { error: { code: "forbidden", message: "Yetki yok" } })]);
    const error = await api.listCustomers().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "forbidden", message: "Yetki yok" });
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(error)).toBe(false);
  });

  it("passes list filters and paging to the backend", async () => {
    const { api, calls } = setup({ access_token: "t", refresh_token: "r" }, [json(200, { data: [], meta: { total_count: 0, limit: 20, offset: 40 } })]);
    await api.listOrders({ search: "GK-1", status: "delivered", limit: 20, offset: 40, sort_by: "created_at", sort_direction: "desc" });
    expect(calls[0]!.url).toBe("/backend/api/orders?search=GK-1&status=delivered&limit=20&offset=40&sort_by=created_at&sort_direction=desc");
  });

  it("logs out and always clears local tokens", async () => {
    const { api, tokens } = setup({ access_token: "t", refresh_token: "r" }, [json(500, {})]);
    await expect(api.logout()).rejects.toBeInstanceOf(ApiError);
    expect(tokens()).toBeNull();
  });
});
