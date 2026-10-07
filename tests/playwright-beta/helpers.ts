import { expect, type Page, type Route } from "@playwright/test";

/** Must match `e2eBackendBaseUrl` in apps/web-beta/vite.config.ts (baked into the `build:e2e` bundle). */
export const backendBaseUrl = "http://127.0.0.1:65531";

export interface MockUser {
  public_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  permissions: string[];
}

export function mockUser(role: string, overrides: Partial<MockUser> = {}): MockUser {
  return {
    public_id: `usr_${role}`,
    email: `${role}@example.com`,
    first_name: "Ayşe",
    last_name: "Yılmaz",
    role,
    permissions: [],
    ...overrides,
  };
}

export const viewports = {
  phone360: { width: 360, height: 740 },
  phone390: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  laptop: { width: 1024, height: 768 },
  desktop: { width: 1280, height: 800 },
  wide: { width: 1536, height: 900 },
} as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const order = (index: number, overrides: Record<string, unknown> = {}) => ({
  public_id: `ord_${index}`,
  order_number: `GK-${String(1000 + index)}`,
  status: index % 3 === 0 ? "delivered" : index % 3 === 1 ? "pending_confirmation" : "shipped",
  source: "manual",
  cargo_provider: index % 2 === 0 ? "ptt" : "surat",
  total_amount: `${(index * 125.5).toFixed(2)}`,
  currency: "TRY",
  customer_full_name: `Müşteri Uzun Adı Soyadı ${index}`,
  customer_phone: `0555${String(1000000 + index)}`,
  created_at: new Date(Date.UTC(2026, 9, 1 + (index % 28), 10, 30)).toISOString(),
  ...overrides,
});

const shipment = (index: number) => ({
  public_id: `shp_${index}`,
  provider: index % 2 === 0 ? "ptt" : "surat",
  tracking_number: index % 5 === 0 ? null : `TRK${String(900000 + index)}`,
  status: index % 2 === 0 ? "in_transit" : "delivered",
  recipient_name: `Alıcı ${index}`,
  recipient_phone: "05551112233",
  recipient_city: "İstanbul",
  recipient_district: "Kadıköy",
  last_event_text: "Transfer merkezinden çıkış yaptı ve dağıtım şubesine yönlendirildi",
  order_number: `GK-${String(1000 + index)}`,
  customer_full_name: `Müşteri ${index}`,
  updated_at: new Date(Date.UTC(2026, 9, 5, 12, index % 60)).toISOString(),
});

const conversation = (index: number) => ({
  public_id: `cnv_${index}`,
  channel: index % 2 === 0 ? "instagram" : "facebook",
  status: index % 4 === 0 ? "closed" : "open",
  is_in_pool: index % 3 === 0,
  human_agent_enabled: index % 2 === 1,
  unread_count: index % 3,
  last_message_text: `Merhaba, siparişim ne zaman gelir? Kargo takip numarasını paylaşır mısınız ${index}`,
  last_message_sender_type: "customer",
  last_message_at: new Date(Date.UTC(2026, 9, 5, 9, index % 60)).toISOString(),
  customer: { full_name: `Konuşma Müşterisi ${index}`, phone: `0555000${String(index).padStart(4, "0")}` },
  assigned_user_email: index % 2 ? "calisan@example.com" : null,
  updated_at: new Date(Date.UTC(2026, 9, 5, 9, index % 60)).toISOString(),
});

const customer = (index: number) => ({
  public_id: `cus_${index}`,
  full_name: `${index % 2 ? "Mehmet" : "Zeynep"} Müşteri ${index}`,
  phone: index % 4 === 0 ? null : `0532${String(1000000 + index)}`,
  email: index % 3 === 0 ? `musteri${index}@example.com` : null,
  notes: index % 5 === 0 ? "Kuluçka makinesi için yedek parça soruyor" : null,
  updated_at: new Date(Date.UTC(2026, 9, 4, 8, index % 60)).toISOString(),
});

export interface BackendState {
  user: MockUser;
  password: string;
  requests: Array<{ method: string; path: string; search: string; auth: string | null }>;
  orders: ReturnType<typeof order>[];
  shipments: ReturnType<typeof shipment>[];
  conversations: ReturnType<typeof conversation>[];
  customers: ReturnType<typeof customer>[];
  fail: Set<string>;
  bodies: Array<{ method: string; path: string; body: unknown }>;
}

/** Extra per-spec routes: return `{ status, body }` to answer, or undefined to fall through to the built-in mocks. */
export type ExtraRoute = (request: { method: string; path: string; url: URL; body: unknown }, state: BackendState) => { status: number; body: unknown } | undefined;

/** Mocks the beta panel's backend calls (cross-origin, so CORS and preflights are answered too). */
export async function mockBackend(page: Page, user: MockUser, options: { orderCount?: number; extra?: ExtraRoute; anonymous?: (path: string) => boolean } = {}) {
  const state: BackendState = {
    user,
    password: "dogru-sifre",
    requests: [],
    orders: Array.from({ length: options.orderCount ?? 45 }, (_, index) => order(index + 1)),
    shipments: Array.from({ length: 33 }, (_, index) => shipment(index + 1)),
    conversations: Array.from({ length: 27 }, (_, index) => conversation(index + 1)),
    customers: Array.from({ length: 31 }, (_, index) => customer(index + 1)),
    fail: new Set(),
    bodies: [],
  };

  await page.route(`${backendBaseUrl}/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders });
    state.requests.push({ method, path: url.pathname, search: url.search, auth: request.headers()["authorization"] ?? null });
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, headers: { ...corsHeaders, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const authed = request.headers()["authorization"] === "Bearer beta-access";
    if (state.fail.has(url.pathname)) return json(500, { error: { code: "boom", message: "fail" } });

    const parsedBody = (() => {
      try {
        return request.postData() ? (JSON.parse(request.postData() ?? "") as unknown) : undefined;
      } catch {
        return request.postData();
      }
    })();
    if (method !== "GET") state.bodies.push({ method, path: url.pathname, body: parsedBody });
    // Public backend endpoints (e.g. the KVKK deletion form) reach the extra routes without a session.
    if (url.pathname !== "/auth/login" && (authed || options.anonymous?.(url.pathname)) && options.extra) {
      const answer = options.extra({ method, path: url.pathname, url, body: parsedBody }, state);
      if (answer) return json(answer.status, answer.body);
    }

    if (url.pathname === "/auth/login") {
      const body = JSON.parse(request.postData() ?? "{}") as { email?: string; password?: string };
      if (body.password !== state.password) return json(401, { error: { code: "invalid_credentials", message: "Invalid" } });
      return json(200, { access_token: "beta-access", refresh_token: "beta-refresh", token_type: "Bearer", expires_in: 900, user: state.user });
    }
    if (!authed) return json(401, { error: { code: "unauthorized", message: "Unauthorized" } });
    if (url.pathname === "/auth/me") return json(200, state.user);
    if (url.pathname === "/auth/logout") return json(200, { ok: true });
    if (url.pathname === "/auth/account/profile") {
      const body = JSON.parse(request.postData() ?? "{}") as { first_name: string; last_name?: string };
      state.user = { ...state.user, first_name: body.first_name, last_name: body.last_name ?? "" };
      return json(200, { first_name: state.user.first_name, last_name: state.user.last_name });
    }
    if (url.pathname === "/auth/account/password") return json(200, { updated: true });

    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const search = (url.searchParams.get("search") ?? "").toLocaleLowerCase("tr-TR");
    const page_ = <T,>(rows: T[]) => json(200, { data: rows.slice(offset, offset + limit), meta: { total_count: rows.length, limit, offset } });

    if (url.pathname === "/api/orders/summary") {
      return json(200, { total_count: state.orders.length, active_count: 12, delivered_count: 15, pending_confirmation_count: 7, total_revenue: 154230.5, currency: "TRY" });
    }
    if (url.pathname === "/api/conversations/summary") {
      return json(200, { total_count: 27, unread_count: 5, pool_count: 9, human_agent_count: 13, channel_counts: { instagram: 14, facebook: 13 }, status_counts: { open: 20, closed: 7 } });
    }
    if (url.pathname === "/api/customers/summary") {
      if (state.user.role === "kargo_operatoru") return json(403, { error: { code: "forbidden", message: "Forbidden" } });
      return json(200, { total_count: 31, with_phone_count: 23, with_email_count: 10, with_notes_count: 6 });
    }
    if (url.pathname === "/api/shipments/summary") {
      return json(200, { total_count: 33, active_count: 17, delivered_count: 16, recipient_phone_count: 33, provider_counts: { ptt: 16, surat: 17, other: 0 }, exception_counts: { ptt_not_delivered: 8, surat_not_delivered: 9, tracking_missing: 6 } });
    }
    if (url.pathname === "/api/orders") {
      const status = url.searchParams.get("status");
      const provider = url.searchParams.get("cargo_provider");
      let rows = state.orders.filter((row) => (!search || `${row.order_number} ${row.customer_full_name}`.toLocaleLowerCase("tr-TR").includes(search)) && (!status || row.status === status) && (!provider || row.cargo_provider === provider));
      if (url.searchParams.get("sort_direction") === "asc") rows = [...rows].reverse();
      return page_(rows);
    }
    if (url.pathname === "/api/shipments") {
      const status = url.searchParams.get("status");
      const provider = url.searchParams.get("provider");
      const rows = state.shipments.filter((row) => (!search || `${row.tracking_number} ${row.recipient_name} ${row.order_number}`.toLocaleLowerCase("tr-TR").includes(search)) && (!status || row.status === status) && (!provider || row.provider === provider));
      return page_(rows);
    }
    if (url.pathname === "/api/conversations") {
      const channel = url.searchParams.get("channel");
      const status = url.searchParams.get("status");
      return page_(state.conversations.filter((row) => (!channel || row.channel === channel) && (!status || row.status === status)));
    }
    if (url.pathname === "/api/customers") {
      if (state.user.role === "kargo_operatoru") return json(403, { error: { code: "forbidden", message: "Forbidden" } });
      return page_(state.customers);
    }
    const customerMatch = /^\/api\/customers\/([^/]+)(\/notes)?$/.exec(url.pathname);
    if (customerMatch) {
      if (state.user.role === "kargo_operatoru") return json(403, { error: { code: "forbidden", message: "Forbidden" } });
      const index = state.customers.findIndex((row) => row.public_id === decodeURIComponent(customerMatch[1] ?? ""));
      if (index < 0) return json(404, { error: { code: "not_found", message: "Müşteri bulunamadı" } });
      if (method === "PATCH") {
        state.customers[index] = { ...state.customers[index]!, ...(parsedBody as Record<string, unknown>), updated_at: new Date(Date.UTC(2026, 9, 6, 9)).toISOString() };
        return json(200, state.customers[index]);
      }
      const row = state.customers[index]!;
      return json(200, {
        customer: { ...row, username: null, created_at: new Date(Date.UTC(2026, 0, 2, 9)).toISOString() },
        addresses: [{ public_id: "adr_1", label: "Ev", address_line: "Atatürk Cd. No:1", city: "Konya", district: "Selçuklu", country: "TR", postal_code: "42000", is_default: true }],
        orders: state.orders.slice(0, 3).map((item) => ({ ...item, customer_full_name: row.full_name })),
        conversations: state.conversations.slice(0, 2).map((item) => ({ ...item, customer: { full_name: row.full_name, phone: row.phone } })),
      });
    }
    return json(404, { error: { code: "not_found", message: `not mocked: ${url.pathname}` } });
  });
  return state;
}

export async function login(page: Page, state: BackendState) {
  await page.getByLabel(/E-posta|Email/).fill(state.user.email);
  await page.getByLabel(/Şifre|Password/).fill(state.password);
  await page.getByRole("button", { name: /Giriş yap|Sign in/ }).click();
}

export function pathOf(page: Page) {
  return new URL(page.url()).pathname;
}

/** Layout invariants: no horizontal page scroll and (on touch widths) 44px touch targets. */
export async function expectResponsiveLayout(page: Page, options: { checkTouchTargets: boolean }) {
  const report = await page.evaluate((checkTouchTargets) => {
    const doc = document.documentElement;
    const problems: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) problems.push(`page-scroll-x:${doc.scrollWidth}>${doc.clientWidth}`);
    // Header rows must not overlap (brand | nav | actions).
    const headerParts = ["brand", "desktop-nav", "header-actions"]
      .map((id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`))
      .filter((element): element is HTMLElement => Boolean(element) && element!.getBoundingClientRect().width > 0)
      .map((element) => ({ id: element.dataset.testid, box: element.getBoundingClientRect() }));
    for (let i = 0; i < headerParts.length; i += 1) {
      for (let j = i + 1; j < headerParts.length; j += 1) {
        const a = headerParts[i]!.box;
        const b = headerParts[j]!.box;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) problems.push(`header-overlap:${headerParts[i]!.id}/${headerParts[j]!.id}`);
      }
    }
    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.position === "fixed" && box.right <= 0) continue;
      if (element.closest(".sr-only")) continue;
      if (box.right > doc.clientWidth + 1 && !element.closest("[data-allow-overflow]")) {
        // Children of a horizontally scrollable container are fine.
        let parent = element.parentElement;
        let clipped = false;
        while (parent) {
          const parentStyle = getComputedStyle(parent);
          if (/(auto|scroll|hidden|clip)/.test(parentStyle.overflowX) && parent.getBoundingClientRect().right <= doc.clientWidth + 1) {
            clipped = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (!clipped) problems.push(`overflow:${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)}`);
      }
    }
    if (checkTouchTargets) {
      for (const element of Array.from(document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, [role=button], [role=menuitem], [role=combobox]"))) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0 || element.closest(".sr-only")) continue;
        if (box.bottom < 0 || box.top > window.innerHeight * 3) continue;
        if (box.height < 43.5 || (box.width < 43.5 && element.tagName !== "INPUT")) {
          problems.push(`touch:${element.tagName.toLowerCase()}[${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}]=${Math.round(box.width)}x${Math.round(box.height)}`);
        }
      }
    }
    return problems;
  }, options.checkTouchTargets);
  expect(report).toEqual([]);
}
