import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// P5 slice 15: layout visual parity + route split. Structural/bounding-box checks instead of pixel screenshots.
const backendBaseUrl = "http://127.0.0.1:65530";

test.setTimeout(90_000);

interface PlaywrightUser {
  public_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  permissions: string[];
  is_online: boolean;
  sip_username: string;
}

declare global {
  interface Window {
    __GARANTI_REALTIME_TEST__?: {
      emitted: Array<{ event: string; payload: unknown }>;
      emitServer: (event: string, payload: unknown) => void;
    };
  }
}

const desktopViewport = { width: 1280, height: 720 };
const mobileViewport = { width: 390, height: 844 };

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
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function closeWebApp(server: ViteDevServer) {
  await server.close();
}

function loginUser(overrides: Partial<PlaywrightUser> = {}): PlaywrightUser {
  return {
    public_id: "usr_layout",
    email: "calisan.layout.uzun.eposta.adresi@example.com",
    first_name: "Ayşegül Nur",
    last_name: "Karaoğlanoğlu-Yıldırımtürk",
    role: "calisan",
    permissions: [],
    is_online: true,
    sip_username: "1003",
    ...overrides,
  };
}

function loginBody(user: PlaywrightUser) {
  return {
    access_token: "layout-token",
    refresh_token: "layout-refresh",
    token_type: "Bearer",
    expires_in: 900,
    user,
  };
}

function fallbackResponse(pathname: string): unknown {
  const emptyData = { data: [] };
  const emptyAudit = { data: [], summary: { total_count: 0 } };
  if (pathname === "/api/conversations") return emptyData;
  if (pathname === "/api/conversations/summary") {
    return { total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 0 } };
  }
  if (pathname === "/api/customers") return emptyData;
  if (pathname === "/api/message-shortcuts") return emptyData;
  if (pathname === "/api/customers/summary") return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  if (pathname === "/api/orders") return emptyData;
  if (pathname === "/api/orders/summary") return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  if (pathname === "/api/products" || pathname === "/api/orders/product-options") return emptyData;
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
  if (pathname === "/api/shipments") return emptyData;
  if (pathname === "/api/shipments/summary") return { total_count: 0, active_count: 0, delivered_count: 0, recipient_phone_count: 0, provider_counts: { ptt: 0, surat: 0, other: 0 }, exception_counts: { ptt_not_delivered: 0, surat_not_delivered: 0, tracking_missing: 0 } };
  if (pathname === "/api/shipments/pipeline-summary") return { counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] };
  if (pathname === "/api/reports/summary") return { conversation_count: 0, order_count: 0, shipment_count: 0, total_revenue: 0, currency: "TRY", open_conversation_count: 0, pending_confirmation_count: 0, active_shipment_count: 0, delivered_shipment_count: 0, delivered_shipment_rate: 0, confirmation_rate: 0, active_shipment_rate: 0 };
  if (pathname === "/api/webphone/config") return { enabled: false, sip_username: null, sip_password_configured: false, ws_url: null, domain: null, stun: null };
  if (pathname === "/admin/settings") return emptyData;
  if (pathname === "/admin/integrations/accounts") return emptyData;
  if (pathname === "/admin/integrations/provider-catalog") return emptyData;
  if (pathname === "/admin/integrations/provider-attempts") return emptyData;
  if (pathname === "/admin/integrations/provider-debug-summary") {
    const provider = (key: string) => ({ provider_key: key, total_attempts: 0, success_count: 0, failure_count: 0, retry_count: 0, average_duration_ms: 0, latest_attempt: null });
    return {
      providers: [provider("ptt"), provider("surat")],
      cron: { provider_keys: ["ptt", "surat"], operation: "shipment.track", total_attempts: 0, success_count: 0, failure_count: 0, retry_count: 0, total_duration_ms: 0, latest_attempt: null },
    };
  }
  if (pathname === "/admin/settings/audit" || pathname === "/admin/integrations/audit" || pathname === "/api/files/orphans") return emptyAudit;
  return undefined;
}

async function installRealtimeShim(page: Page) {
  await page.addInitScript(`
    (() => {
      const emitted = [];
      const sockets = [];
      window.__GARANTI_REALTIME_TEST__ = {
        emitted,
        emitServer(event, payload) {
          for (const socket of sockets) {
            for (const listener of socket.listeners[event] || []) listener(payload);
          }
        }
      };
      window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => {
        const socket = {
          listeners: {},
          connect() { emitted.push({ event: "connect", payload: null }); },
          disconnect() { emitted.push({ event: "disconnect", payload: null }); },
          emit(event, payload) { emitted.push({ event, payload }); },
          on(event, listener) {
            socket.listeners[event] = socket.listeners[event] || [];
            socket.listeners[event].push(listener);
          },
          off(event, listener) {
            socket.listeners[event] = (socket.listeners[event] || []).filter((candidate) => candidate !== listener);
          }
        };
        sockets.push(socket);
        return socket;
      };
    })();
  `);
}

/** Mocks the backend for `user` (mutable via the returned holder so one page can switch roles). */
async function mockBackend(page: Page, initialUser: PlaywrightUser) {
  const state = { user: initialUser, presenceCalls: 0, logoutCalls: 0 };
  await installRealtimeShim(page);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (status: number, payload: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

    if (url.pathname === "/auth/login") return json(200, loginBody(state.user));
    if (url.pathname === "/auth/me") return json(200, state.user);
    if (url.pathname === "/auth/logout") {
      state.logoutCalls += 1;
      return json(200, { logged_out: true });
    }
    if (url.pathname === "/auth/presence" && method !== "GET") {
      state.presenceCalls += 1;
      const body = JSON.parse(route.request().postData() ?? "{}") as { is_online?: boolean };
      state.user = { ...state.user, is_online: body.is_online ?? !state.user.is_online };
      return json(200, state.user);
    }
    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) return json(200, fallback);
    return json(404, { error: { code: "not_found", message: "not mocked" } });
  });
  return state;
}

async function login(page: Page) {
  await Promise.all([
    page.waitForResponse(`${backendBaseUrl}/auth/login`),
    page.getByRole("button", { name: /giriş yap/i }).click(),
  ]);
}

function pathOf(page: Page) {
  return new URL(page.url()).pathname;
}

interface LayoutFrame {
  problems: string[];
  topbarHeight: number;
  navWidth: number;
  navTop: number;
  brandBottom: number;
  viewportWidth: number;
}

/** Structural layout parity: no overlap/overflow inside the header and between header and content. */
async function measureLayout(page: Page, panelTestId: string): Promise<LayoutFrame> {
  return page.evaluate((testId) => {
    const problems: string[] = [];
    const viewportWidth = document.documentElement.clientWidth;
    const query = (selector: string) => document.querySelector<HTMLElement>(selector);
    const topbar = query(".topbar");
    const brand = query('[data-testid="app-brand"]');
    const nav = query('[data-testid="app-nav"]');
    const actions = query('[data-testid="app-header-actions"]');
    const workspace = query(".workspace");
    const panel = query(`[data-testid="${testId}"]`);
    if (!topbar || !brand || !nav || !actions || !workspace || !panel) {
      return { problems: ["missing-shell-node"], topbarHeight: 0, navWidth: 0, navTop: 0, brandBottom: 0, viewportWidth };
    }
    const rect = (element: Element) => element.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const boxes = { brand: rect(brand), nav: rect(nav), actions: rect(actions) };
    const names = Object.keys(boxes) as Array<keyof typeof boxes>;
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        if (overlaps(boxes[names[i]!], boxes[names[j]!])) problems.push(`overlap:${names[i]}-${names[j]}`);
      }
    }
    for (const element of Array.from(topbar.querySelectorAll<HTMLElement>("*"))) {
      const box = rect(element);
      if (box.width === 0 || element.closest("nav")) continue;
      if (box.right > viewportWidth + 1 || box.left < -1) {
        problems.push(`topbar-overflow:${element.className || element.tagName}`);
      }
    }
    for (const link of Array.from(nav.querySelectorAll<HTMLElement>("a"))) {
      if (link.scrollWidth > link.clientWidth + 1 || link.scrollHeight > link.clientHeight + 1) {
        problems.push(`nav-text-clipped:${link.textContent ?? ""}`);
      }
    }
    for (const selector of [".profile-name", ".profile-email", ".presence-toggle span", ".logout-button span"]) {
      const element = query(selector);
      if (!element || rect(element).width <= 1) continue;
      const style = getComputedStyle(element);
      const clipsWithEllipsis = style.textOverflow === "ellipsis" || getComputedStyle(element.parentElement!).textOverflow === "ellipsis";
      if (element.scrollWidth > element.clientWidth + 1 && !clipsWithEllipsis) problems.push(`text-overflow:${selector}`);
    }
    const panelBox = rect(panel);
    if (rect(workspace).top < rect(topbar).bottom - 1) problems.push("workspace-under-topbar");
    if (panelBox.left < -1 || panelBox.right > viewportWidth + 1) problems.push("panel-horizontal-overflow");
    if (document.documentElement.scrollWidth > viewportWidth + 1) problems.push("document-horizontal-scroll");
    return {
      problems,
      topbarHeight: rect(topbar).height,
      navWidth: boxes.nav.width,
      navTop: boxes.nav.top,
      brandBottom: boxes.brand.bottom,
      viewportWidth,
    };
  }, panelTestId);
}

test("protected routes redirect to /giris and back, unknown and role-restricted routes go home", async ({ page }) => {
  const app = await startWebApp();
  const backend = await mockBackend(page, loginUser());
  try {
    await page.setViewportSize(desktopViewport);

    // Unauthenticated deep link → /giris, then back to the requested page after login.
    await page.goto(`${app.url}/siparisler`);
    await expect(page.getByRole("button", { name: /giriş yap/i })).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe("/giris");
    await login(page);
    await expect.poll(() => pathOf(page)).toBe("/siparisler");
    await expect(page.getByTestId("orders-flow")).toBeVisible();

    // Authenticated: "/" and /giris → role home (legacy HomeRedirect: personel → /mesajlar).
    await page.goto(`${app.url}/`);
    await expect.poll(() => pathOf(page)).toBe("/mesajlar");
    await expect(page.getByTestId("inbox-flow")).toBeVisible();
    await page.goto(`${app.url}/giris`);
    await expect.poll(() => pathOf(page)).toBe("/mesajlar");

    // Admin-only page for personel and an unknown page both fall back to home.
    await page.goto(`${app.url}/raporlar`);
    await expect.poll(() => pathOf(page)).toBe("/mesajlar");
    await expect(page.getByTestId("raporlar-page")).toHaveCount(0);
    await page.goto(`${app.url}/boyle-bir-sayfa-yok`);
    await expect.poll(() => pathOf(page)).toBe("/mesajlar");

    // Logout returns to /giris without remembering the last page.
    await page.getByRole("button", { name: /çıkış/i }).click();
    await expect(page.getByRole("button", { name: /giriş yap/i })).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe("/giris");
    expect(backend.logoutCalls).toBe(1);

    // kargo_operatoru home is /siparisler; pages outside the role redirect there.
    backend.user = loginUser({ role: "kargo_operatoru", email: "kargo@example.com", first_name: "Kargo", last_name: "Operatör" });
    await login(page);
    await expect.poll(() => pathOf(page)).toBe("/siparisler");
    await expect(page.getByTestId("orders-flow")).toBeVisible();
    await page.goto(`${app.url}/musteriler`);
    await expect.poll(() => pathOf(page)).toBe("/siparisler");
    await page.goto(`${app.url}/kargo/pipeline`);
    await expect(page.getByTestId("shipment-pipeline-flow")).toBeVisible();
    expect(pathOf(page)).toBe("/kargo/pipeline");
  } finally {
    await closeWebApp(app.server);
  }
});

test("header shows brand, role nav, presence, profile, language and logout like legacy", async ({ page }) => {
  const app = await startWebApp();
  const backend = await mockBackend(page, loginUser());
  try {
    await page.setViewportSize(desktopViewport);
    await page.goto(`${app.url}/giris`);
    await login(page);
    await expect(page.getByTestId("inbox-flow")).toBeVisible();

    const header = page.getByTestId("app-topbar");
    await expect(page.getByTestId("app-brand")).toHaveText("GGaranti Kuluçka");
    const nav = page.getByRole("navigation", { name: "Ana gezinme" });
    await expect(nav.getByRole("link")).toHaveText([
      "Mesajlar",
      "Yorumlar",
      "Müşteriler",
      "Siparişler",
      "Kargo",
      "Pipeline",
      "İptaller",
      "Stoklar",
      "Bakiyeler",
      "SMS",
      "Ayarlar",
      "Dosya",
    ]);

    // Exactly one active item, matching the route (Pipeline must not also light up Kargo).
    await nav.getByRole("link", { name: "Pipeline" }).click();
    await expect(page.getByTestId("shipment-pipeline-flow")).toBeVisible();
    expect(pathOf(page)).toBe("/kargo/pipeline");
    await expect(nav.locator('[aria-current="page"]')).toHaveText(["Pipeline"]);
    await nav.getByRole("link", { name: "Kargo" }).click();
    await expect(page.getByTestId("shipments-flow")).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveText(["Kargo"]);

    // Profile: initials avatar + presence dot, full name, role label and e-mail.
    const profile = page.getByTestId("app-profile");
    await expect(profile.locator(".profile-avatar")).toContainText("AK");
    await expect(profile.getByTestId("profile-presence-dot")).toHaveClass(/online/);
    await expect(profile.locator(".profile-name")).toHaveText("Ayşegül Nur Karaoğlanoğlu-Yıldırımtürk");
    await expect(profile.locator(".profile-role")).toHaveText("Personel");
    await expect(profile.getByText("calisan.layout.uzun.eposta.adresi@example.com")).toBeVisible();

    // Presence toggle (personel only) updates button and avatar dot.
    const presence = header.getByTestId("presence-toggle");
    await expect(presence).toHaveText("Çevrimiçi");
    await Promise.all([page.waitForResponse(`${backendBaseUrl}/auth/presence`), presence.click()]);
    await expect(presence).toHaveText("Çevrimdışı");
    await expect(profile.getByTestId("profile-presence-dot")).not.toHaveClass(/online/);
    expect(backend.presenceCalls).toBe(1);

    // Language switch: TR ↔ EN, persisted like legacy `garanti-lang`.
    const language = page.getByTestId("language-switch");
    await expect(language.getByRole("button", { name: "TR" })).toHaveAttribute("aria-pressed", "true");
    await language.getByRole("button", { name: "EN" }).click();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Orders" })).toBeVisible();
    await expect(presence).toHaveText("Offline");
    await expect(profile.locator(".profile-role")).toHaveText("Personnel");
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Shipments" })).toBeVisible();
    await page.getByTestId("language-switch").getByRole("button", { name: "TR" }).click();
    await expect(page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("link", { name: "Kargo" })).toBeVisible();

    // Logout button is always reachable in the header.
    await page.getByRole("button", { name: /çıkış/i }).click();
    await expect(page.getByRole("button", { name: /giriş yap/i })).toBeVisible();

    // Admin: no presence toggle and no presence dot (legacy: admin is an observer).
    backend.user = loginUser({ role: "admin", email: "admin@example.com", first_name: "Admin", last_name: "User" });
    await login(page);
    await expect(page.getByTestId("inbox-flow")).toBeVisible();
    await expect(page.getByTestId("presence-toggle")).toHaveCount(0);
    await expect(page.getByTestId("profile-presence-dot")).toHaveCount(0);
    await expect(page.getByTestId("app-profile").locator(".profile-role")).toHaveText("Admin");
    await expect(page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("link", { name: "VAPI AI" })).toBeVisible();

    // Bootstrap owner (first admin) gets the admin shell instead of an empty redirect loop.
    await page.getByRole("button", { name: /çıkış/i }).click();
    backend.user = loginUser({ role: "owner", email: "owner@example.com", first_name: "System", last_name: "Owner" });
    await login(page);
    await expect.poll(() => pathOf(page)).toBe("/mesajlar");
    await expect(page.getByTestId("inbox-flow")).toBeVisible();
    await expect(page.getByTestId("app-profile").locator(".profile-role")).toHaveText("Admin");
    await expect(page.getByTestId("profile-presence-dot")).toHaveCount(0);
    await page.goto(`${app.url}/raporlar`);
    await expect(page.getByTestId("raporlar-page")).toBeVisible();
  } finally {
    await closeWebApp(app.server);
  }
});

for (const role of ["calisan", "admin"] as const) {
  test(`${role} desktop and mobile shell keep header rows without overlap or overflow`, async ({ page }) => {
    const app = await startWebApp();
    await mockBackend(page, loginUser({ role, ...(role === "admin" ? { email: "admin@example.com" } : {}) }));
    const routes = [
      { path: "/mesajlar", testId: "inbox-flow" },
      { path: "/siparisler", testId: "orders-flow" },
      { path: "/kargo", testId: "shipments-flow" },
      { path: "/kargo/pipeline", testId: "shipment-pipeline-flow" },
      { path: "/iptaller", testId: "cancellations-flow" },
    ];
    try {
      await page.setViewportSize(desktopViewport);
      await page.goto(`${app.url}/giris`);
      await login(page);
      await expect(page.getByTestId("inbox-flow")).toBeVisible();

      for (const viewport of ["desktop", "mobile"] as const) {
        await page.setViewportSize(viewport === "desktop" ? desktopViewport : mobileViewport);
        for (const route of routes) {
          await page.goto(`${app.url}${route.path}`);
          await expect(page.getByTestId(route.testId)).toBeVisible();
          // Active nav item is scrolled into view even on narrow screens.
          await expect(page.getByTestId("app-nav").locator('[aria-current="page"]')).toBeInViewport();
          const frame = await measureLayout(page, route.testId);
          expect(frame.problems, `${viewport} ${route.path}`).toEqual([]);
          if (viewport === "desktop") {
            // Legacy desktop: one 64px bar (logo | horizontal nav | presence/profile).
            expect(frame.topbarHeight, `${route.path} topbar height`).toBeLessThanOrEqual(80);
            expect(frame.navWidth).toBeGreaterThan(400);
          } else {
            // Mobile: brand/actions row + full-width scrollable nav row, never more than two rows.
            expect(frame.topbarHeight, `${route.path} mobile topbar height`).toBeLessThanOrEqual(130);
            expect(frame.navTop).toBeGreaterThanOrEqual(frame.brandBottom - 1);
            expect(frame.navWidth).toBeGreaterThanOrEqual(frame.viewportWidth - 32);
          }
        }

        // Nav must stay usable: the last item can be scrolled into view and clicked.
        const nav = page.getByTestId("app-nav");
        const lastLink = nav.getByRole("link").last();
        await lastLink.scrollIntoViewIfNeeded();
        await expect(lastLink).toBeInViewport();
        await expect(page.getByRole("button", { name: /çıkış/i })).toBeInViewport();
      }
    } finally {
      await closeWebApp(app.server);
    }
  });
}
