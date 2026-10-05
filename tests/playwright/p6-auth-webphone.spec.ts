import { expect, type Page, type Route, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

const backendBaseUrl = "http://127.0.0.1:65530";
const tokenStorageKey = "garanti.web.access_token";

test.setTimeout(60_000);

interface BrowserUser {
  public_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  permissions: string[];
  is_online: boolean;
  sip_username: string | null;
}

async function startWebApp() {
  const server = await createServer({
    root: "apps/web",
    configFile: "apps/web/vite.config.ts",
    server: {
      host: "127.0.0.1",
      port: 0,
    },
    define: {
      "import.meta.env.VITE_BACKEND_BASE_URL": JSON.stringify(backendBaseUrl),
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite dev server did not expose a TCP address");
  }
  return { url: `http://127.0.0.1:${address.port}`, server };
}

async function closeWebApp(server: ViteDevServer) {
  await server.close();
}

test("browser auth covers login, refresh rotation, logout, revoked and disabled sessions", async ({ page }) => {
  const app = await startWebApp();
  const requestedPaths: string[] = [];
  const authState = {
    user: adminUser(),
    accessToken: "access_admin_initial",
    refreshToken: "refresh_initial",
    nextAccessToken: "access_admin_rotated",
    nextRefreshToken: "refresh_rotated",
    revokedTokens: new Set<string>(),
    disabled: false,
  };

  await routeP6Backend(page, requestedPaths, authState);

  try {
    await page.goto(app.url);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page.getByTestId("inbox-flow")).toBeVisible();
    await expect(page.getByText("Backend API, presigned dosya ve Socket.IO sınırları aktif")).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), tokenStorageKey)).toBe("access_admin_initial");

    const firstRefresh = await page.evaluate(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh_initial" }),
      });
      return { status: response.status, body: await response.json() };
    }, backendBaseUrl);
    expect(firstRefresh).toMatchObject({
      status: 200,
      body: {
        access_token: "access_admin_rotated",
        refresh_token: "refresh_rotated",
      },
    });

    const reusedRefresh = await page.evaluate(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh_initial" }),
      });
      return { status: response.status, body: await response.json() };
    }, backendBaseUrl);
    expect(reusedRefresh).toMatchObject({
      status: 401,
      body: { error: { code: "invalid_refresh_token" } },
    });

    await page.getByRole("button", { name: "Çıkış" }).click();
    await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), tokenStorageKey)).toBeNull();

    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [tokenStorageKey, "access_admin_initial"],
    );
    authState.revokedTokens.add("access_admin_initial");
    await page.reload();
    await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), tokenStorageKey)).toBeNull();

    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [tokenStorageKey, "access_admin_rotated"],
    );
    authState.disabled = true;
    await page.reload();
    await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), tokenStorageKey)).toBeNull();

    expect(requestedPaths).toContain("/auth/login");
    expect(requestedPaths).toContain("/auth/refresh");
    expect(requestedPaths).toContain("/auth/logout");
    expect(requestedPaths.filter((path) => path === "/auth/me").length).toBeGreaterThanOrEqual(2);
  } finally {
    await closeWebApp(app.server);
  }
});

test("browser role denial keeps kargo operator away from admin routes but reads webphone config", async ({ page }) => {
  const app = await startWebApp();
  const requestedPaths: string[] = [];
  const authState = {
    user: cargoUser(),
    accessToken: "access_cargo",
    refreshToken: "refresh_cargo",
    nextAccessToken: "access_cargo_rotated",
    nextRefreshToken: "refresh_cargo_rotated",
    revokedTokens: new Set<string>(),
    disabled: false,
  };

  await routeP6Backend(page, requestedPaths, authState);

  try {
    const anonymousWebphone = await page.evaluate(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/webphone/config`);
      return { status: response.status, body: await response.json() };
    }, backendBaseUrl);
    expect(anonymousWebphone).toMatchObject({
      status: 401,
      body: { error: { code: "unauthorized" } },
    });

    await page.goto(`${app.url}/ayarlar`);
    await page.getByLabel("E-posta").fill("cargo@example.com");
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page.getByTestId("inbox-flow")).toBeVisible();
    await expect(page.getByTestId("admin-flow")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ayarlar" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Santral" })).toHaveCount(0);
    expect(requestedPaths).not.toContain("/admin/settings");
    expect(requestedPaths).toContain("/api/webphone/config");

    const nonAdminWrite = await page.evaluate(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/settings/sip_config`, {
        method: "PUT",
        headers: {
          authorization: "Bearer access_cargo",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          value: { ws_url: "wss://sip.example.com/ws", domain: "sip.example.com" },
          scope: "global",
          is_secret: false,
        }),
      });
      return { status: response.status, body: await response.json() };
    }, backendBaseUrl);
    expect(nonAdminWrite).toMatchObject({
      status: 403,
      body: { error: { code: "forbidden" } },
    });
  } finally {
    await closeWebApp(app.server);
  }
});

test("browser calisan users read webphone config for softphone initialization", async ({ page }) => {
  const app = await startWebApp();
  const requestedPaths: string[] = [];
  const authState = {
    user: calisanUser(),
    accessToken: "access_calisan",
    refreshToken: "refresh_calisan",
    nextAccessToken: "access_calisan_rotated",
    nextRefreshToken: "refresh_calisan_rotated",
    revokedTokens: new Set<string>(),
    disabled: false,
  };

  await routeP6Backend(page, requestedPaths, authState);

  try {
    await page.goto(app.url);
    await page.getByLabel("E-posta").fill("calisan@example.com");
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page.getByTestId("inbox-flow")).toBeVisible();
    expect(requestedPaths).toContain("/api/webphone/config");
  } finally {
    await closeWebApp(app.server);
  }
});

test("browser webphone shows SIP boundary and persists VAPI call log without a real SIP call", async ({ page }) => {
  const app = await startWebApp();
  const requestedPaths: string[] = [];
  const vapiAttempts: unknown[] = [];
  const authState = {
    user: adminUser(),
    accessToken: "access_admin_initial",
    refreshToken: "refresh_initial",
    nextAccessToken: "access_admin_rotated",
    nextRefreshToken: "refresh_rotated",
    revokedTokens: new Set<string>(),
    disabled: false,
    vapiAttempts,
  };

  await routeP6Backend(page, requestedPaths, authState);

  try {
    await page.goto(`${app.url}/santral`);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page.getByTestId("webphone-flow")).toBeVisible();
    await expect(page.getByText("Santral aktif")).toBeVisible();
    await expect(page.getByText("sip.example.com")).toBeVisible();
    expect(requestedPaths).toContain("/api/webphone/config");

    await page.goto(`${app.url}/sesli-asistan`);
    await expect(page.getByTestId("sip-config-detail")).toContainText("direct_sip_over_webrtc");
    await page.goto(`${app.url}/sesli-asistan/vapi`);
    await expect(page.getByTestId("vapi-flow")).toBeVisible();
    await expect(page.getByTestId("vapi-detail")).toContainText("sip.example.com");
    await page.getByRole("button", { name: "VAPI test araması hazırla" }).click();
    await expect(page.getByText("VAPI test araması canlı çağrı kapalıyken kaydedildi")).toBeVisible();
    await expect(page.getByTestId("vapi-test-call-detail")).toContainText("call.test vapitest_vapi_test_05051234567");
    await expect(page.getByTestId("vapi-test-call-detail")).toContainText("Canlı çağrı");
    await expect(page.getByTestId("vapi-test-call-detail")).toContainText("kapalı");
    expect(vapiAttempts).toHaveLength(1);
    expect(requestedPaths).toContain("/api/webphone/test-call");
  } finally {
    await closeWebApp(app.server);
  }
});

async function routeP6Backend(
  page: Page,
  requestedPaths: string[],
  authState: {
    user: BrowserUser;
    accessToken: string;
    refreshToken: string;
    nextAccessToken: string;
    nextRefreshToken: string;
    revokedTokens: Set<string>;
    disabled: boolean;
    vapiAttempts?: unknown[];
  },
) {
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    requestedPaths.push(url.pathname);
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: corsHeaders(),
      });
      return;
    }
    const authorization = route.request().headers().authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

    if (url.pathname === "/auth/login") {
      await json(route, {
        access_token: authState.accessToken,
        refresh_token: authState.refreshToken,
        token_type: "Bearer",
        expires_in: 300,
        user: authState.user,
      });
      return;
    }

    if (url.pathname === "/auth/refresh") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { refresh_token?: string };
      if (body.refresh_token !== authState.refreshToken) {
        await json(route, { error: { code: "invalid_refresh_token" } }, 401);
        return;
      }
      authState.refreshToken = authState.nextRefreshToken;
      authState.accessToken = authState.nextAccessToken;
      await json(route, {
        access_token: authState.nextAccessToken,
        refresh_token: authState.nextRefreshToken,
        token_type: "Bearer",
        expires_in: 300,
      });
      return;
    }

    if (url.pathname === "/auth/me") {
      if (!token || authState.revokedTokens.has(token) || authState.disabled) {
        await json(route, { error: { code: "unauthorized" } }, 401);
        return;
      }
      await json(route, authState.user);
      return;
    }

    if (url.pathname === "/auth/logout") {
      if (token) authState.revokedTokens.add(token);
      await json(route, { status: "ok" });
      return;
    }

    if (url.pathname === "/api/webphone/config") {
      if (!token || authState.revokedTokens.has(token) || authState.disabled) {
        await json(route, { error: { code: "unauthorized" } }, 401);
        return;
      }
      await json(route, {
        enabled: true,
        sip_websocket_url: "wss://sip.example.com/ws",
        sip_domain: "sip.example.com",
        sip_username: authState.user.sip_username,
        sip_password: "sip-secret",
        ice_servers: [{ urls: "stun:stun.example.com:3478" }],
        media_proxy_enabled: false,
        transport: "direct_sip_over_webrtc",
      });
      return;
    }

    if (url.pathname === "/admin/settings/sip_config") {
      if (authState.user.role !== "admin") {
        await json(route, { error: { code: "forbidden" } }, 403);
        return;
      }
      await json(route, {
        key: "sip_config",
        scope: "global",
        value: JSON.parse(route.request().postData() ?? "{}").value ?? {},
        is_secret: false,
        updated_at: now(),
      });
      return;
    }

    if (url.pathname === "/api/webphone/test-call") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { idempotency_key?: string };
      const attempt = {
        public_id: "pat_vapi_browser",
        provider_key: "vapi",
        account_public_id: null,
        request_id: `vapitest_${body.idempotency_key ?? "browser"}`,
        operation: "call.test",
        direction: "outbound",
        status: "success",
        status_code: 202,
        duration_ms: 1,
        retry_decision: "none",
        next_retry_at: null,
        idempotency_key: body.idempotency_key ?? null,
        request_metadata: {},
        provider_request_preview: {
          method: "POST",
          path: "/vapi/calls",
          headers: { authorization: "[redacted]" },
          body,
          live_call_performed: false,
        },
        response_metadata: { queued: false },
        error_code: null,
        error_message: null,
        started_at: now(),
        updated_at: now(),
      };
      authState.vapiAttempts?.push(attempt);
      await json(route, attempt, 202);
      return;
    }

    await json(route, responseForPath(url.pathname), 200);
  });
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: corsHeaders(),
    body: JSON.stringify(body),
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, accept",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };
}

function responseForPath(pathname: string) {
  if (pathname === "/api/conversations") return { data: [] };
  if (pathname === "/api/conversations/summary") {
    return {
      total_count: 0,
      unread_count: 0,
      pool_count: 0,
      human_agent_count: 0,
      channel_counts: { instagram: 0, facebook: 0 },
      status_counts: { open: 0, closed: 0 },
    };
  }
  if (pathname === "/api/customers") return { data: [] };
  if (pathname === "/api/customers/summary") {
    return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  }
  if (pathname === "/api/comments/moderation-summary") {
    return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  }
  if (pathname === "/api/balances/summary") {
    return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  }
  if (pathname === "/api/orders/summary") {
    return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  }
  if (pathname === "/api/products/summary") {
    return {
      total_count: 0,
      active_count: 0,
      critical_count: 0,
      critical_threshold: 5,
      category_counts: { incubator: 0, spare_part: 0, other: 0 },
    };
  }
  if (pathname === "/api/shipments/summary") {
    return {
      total_count: 0,
      active_count: 0,
      delivered_count: 0,
      recipient_phone_count: 0,
      provider_counts: { ptt: 0, surat: 0, other: 0 },
      exception_counts: { ptt_not_delivered: 0, surat_not_delivered: 0, tracking_missing: 0 },
    };
  }
  if (pathname === "/api/shipments/pipeline-summary") {
    return {
      counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 },
      rows: [],
    };
  }
  if (pathname === "/api/reports/summary") {
    return {
      conversation_count: 0,
      order_count: 0,
      shipment_count: 0,
      total_revenue: 0,
      currency: "TRY",
      open_conversation_count: 0,
      pending_confirmation_count: 0,
      active_shipment_count: 0,
      delivered_shipment_count: 0,
      delivered_shipment_rate: 0,
      confirmation_rate: 0,
      active_shipment_rate: 0,
    };
  }
  if (pathname === "/api/orders") return { data: [] };
  if (pathname === "/api/products") return { data: [] };
  if (pathname === "/api/shipments") return { data: [] };
  if (pathname === "/admin/settings") {
    return {
      data: [
        {
          key: "sip_config",
          scope: "global",
          value: { ws_url: "wss://sip.example.com/ws", domain: "sip.example.com", stun: "stun:stun.example.com:3478" },
          is_secret: false,
          updated_at: now(),
        },
      ],
    };
  }
  if (pathname === "/admin/integrations/accounts") return { data: [] };
  if (pathname === "/admin/integrations/provider-catalog") return { data: [] };
  if (pathname === "/admin/integrations/provider-attempts") return { data: [] };
  if (pathname === "/admin/integrations/provider-debug-summary") {
    return {
      providers: [],
      cron: {
        provider_keys: ["ptt", "surat"],
        operation: "shipment.track",
        total_attempts: 0,
        success_count: 0,
        failure_count: 0,
        retry_count: 0,
        total_duration_ms: 0,
        latest_attempt: null,
      },
    };
  }
  if (pathname === "/admin/settings/audit") return { data: [], summary: { total_count: 0 } };
  if (pathname === "/admin/integrations/audit") return { data: [], summary: { total_count: 0 } };
  if (pathname === "/api/files/orphans") return { data: [], summary: { total_count: 0 } };
  return { data: [] };
}

function adminUser(): BrowserUser {
  return {
    public_id: "usr_admin",
    email: "admin@example.com",
    first_name: "Admin",
    last_name: "User",
    role: "admin",
    permissions: ["settings:read", "settings:write"],
    is_online: true,
    sip_username: "agent100",
  };
}

function calisanUser(): BrowserUser {
  return {
    public_id: "usr_calisan",
    email: "calisan@example.com",
    first_name: "Calisan",
    last_name: "User",
    role: "calisan",
    permissions: [],
    is_online: true,
    sip_username: "agent-calisan",
  };
}

function cargoUser(): BrowserUser {
  return {
    public_id: "usr_cargo",
    email: "cargo@example.com",
    first_name: "Cargo",
    last_name: "Operator",
    role: "kargo_operatoru",
    permissions: [],
    is_online: true,
    sip_username: "agent-kargo",
  };
}

function now() {
  return "2026-01-01T00:00:00.000Z";
}
