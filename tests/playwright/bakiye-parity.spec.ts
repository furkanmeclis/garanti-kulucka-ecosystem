import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

const backendBaseUrl = "http://127.0.0.1:65530";

test.setTimeout(60_000);

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


type Movement = {
  public_id: string;
  kind: string;
  amount: number;
  balance_after: number;
  description: string | null;
  user_public_id: string | null;
  user_full_name: string | null;
  order_public_id: string | null;
  order_number: string | null;
  customer_full_name: string | null;
  created_at: string;
};

type PaymentRequest = {
  public_id: string;
  amount: number;
  status: string;
  user_public_id: string | null;
  user_full_name: string | null;
  processed_by_user_public_id: string | null;
  processed_at: string | null;
  note: string | null;
  created_at: string;
};

function movement(overrides: Partial<Movement>): Movement {
  return {
    public_id: "bmv_1",
    kind: "commission",
    amount: 50,
    balance_after: 50,
    description: "Sipariş komisyonu: SP-1",
    user_public_id: "usr_staff",
    user_full_name: "Ayşe Yılmaz",
    order_public_id: "ord_1",
    order_number: "SP-1",
    customer_full_name: "Mehmet Kaya",
    created_at: "2026-01-01T09:00:00.000Z",
    ...overrides,
  };
}

function paymentRequest(overrides: Partial<PaymentRequest>): PaymentRequest {
  return {
    public_id: "pay_1",
    amount: 25,
    status: "pending",
    user_public_id: "usr_staff",
    user_full_name: "Ayşe Yılmaz",
    processed_by_user_public_id: null,
    processed_at: null,
    note: null,
    created_at: "2026-01-02T09:00:00.000Z",
    ...overrides,
  };
}

for (const role of ["admin", "calisan"] as const) {
  test(`${role} Bakiye legacy parity uses backend balance ledger API`, async ({ page }) => {
    const app = await startWebApp();
    const user = loginUser({ role, email: `${role}@example.com` });
    const movements: Movement[] = [
      movement({ public_id: "bmv_4", kind: "rollback", amount: 50, balance_after: 100, description: "İptal geri alma: SP-2", order_public_id: "ord_2", order_number: "SP-2", created_at: "2026-01-01T12:00:00.000Z" }),
      movement({ public_id: "bmv_3", kind: "cancellation", amount: -50, balance_after: 50, description: "Sipariş iptali: SP-2", order_public_id: "ord_2", order_number: "SP-2", created_at: "2026-01-01T11:00:00.000Z" }),
      movement({ public_id: "bmv_2", kind: "commission", amount: 50, balance_after: 100, description: "Sipariş komisyonu: SP-2", order_public_id: "ord_2", order_number: "SP-2", created_at: "2026-01-01T10:00:00.000Z" }),
      movement({}),
    ];
    const requests: PaymentRequest[] = [
      paymentRequest({}),
      paymentRequest({ public_id: "pay_2", amount: 10, created_at: "2026-01-02T08:00:00.000Z" }),
    ];
    let staffBalance = 100;
    const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];

    const summary = () => {
      const pending = requests.filter((request) => request.status === "pending").reduce((sum, request) => sum + request.amount, 0);
      const payments = movements.filter((row) => row.kind === "payment").reduce((sum, row) => sum + Math.abs(row.amount), 0);
      return {
        scope: role === "admin" ? "all" : "own",
        balance: staffBalance,
        total_commission: 150,
        total_deduction: 50,
        total_payment: payments,
        pending_payment: pending,
        available_balance: Math.max(staffBalance - pending, 0),
        pending_request_count: requests.filter((request) => request.status === "pending").length,
      };
    };

    await installRealtimeShim(page);

    await page.route(`${backendBaseUrl}/**`, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

      if (url.pathname === "/auth/login") return json(loginBody(user));
      if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(user);
      if (url.pathname === "/api/conversations") return json({ data: [] });
      if (url.pathname === "/api/conversations/summary") {
        return json({ total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 0 } });
      }
      if (url.pathname.startsWith("/api/balances/") && method === "POST") {
        calls.push({ method, path: url.pathname, body: JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown> });
      }
      if (url.pathname === "/api/balances/summary") return json(summary());
      if (url.pathname === "/api/balances/movements") return json({ data: movements, total: movements.length });
      if (url.pathname === "/api/balances/payment-requests" && method === "GET") return json({ data: requests, total: requests.length });
      if (url.pathname === "/api/balances/payment-requests" && method === "POST") {
        expect(role).toBe("calisan");
        const body = JSON.parse(route.request().postData() ?? "{}") as { amount: string };
        const created = paymentRequest({ public_id: "pay_new", amount: Number(body.amount), created_at: "2026-01-03T09:00:00.000Z" });
        requests.unshift(created);
        return json({ request: created, replayed: false, message: "Ödeme isteği oluşturuldu" }, 201);
      }
      if (url.pathname === "/api/balances/staff") {
        expect(role).toBe("admin");
        const pending = requests.filter((request) => request.status === "pending").reduce((sum, request) => sum + request.amount, 0);
        return json({
          data: [
            { user_public_id: "usr_staff", first_name: "Ayşe", last_name: "Yılmaz", is_online: true, balance: staffBalance, pending_payment: pending, pending_request_count: 1 },
            { user_public_id: "usr_zero", first_name: "Ali", last_name: "Demir", is_online: false, balance: 0, pending_payment: 0, pending_request_count: 0 },
          ],
        });
      }
      if (url.pathname === "/api/balances/staff/usr_staff/orders") {
        return json({
          data: [
            { public_id: "ord_1", order_number: "SP-1", customer_full_name: "Mehmet Kaya", customer_phone: "05551112233", status: "delivered", total_amount: 2550, currency: "TRY", created_at: "2026-01-01T09:00:00.000Z" },
            { public_id: "ord_2", order_number: "SP-2", customer_full_name: "Zeynep Ak", customer_phone: null, status: "cancelled", total_amount: 1800, currency: "TRY", created_at: "2026-01-01T10:00:00.000Z" },
          ],
        });
      }
      if (url.pathname === "/api/balances/staff/usr_staff/reset" && method === "POST") {
        const previous = staffBalance;
        movements.unshift(movement({ public_id: "bmv_reset", kind: "payment", amount: -previous, balance_after: 0, description: "Bakiye sıfırlandı (Admin: Çalışan)", order_public_id: null, order_number: null, customer_full_name: null }));
        staffBalance = 0;
        return json({ previous_balance: previous, message: "Bakiye sıfırlandı" });
      }
      const decision = /^\/api\/balances\/payment-requests\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
      if (decision && method === "POST") {
        expect(role).toBe("admin");
        const request = requests.find((candidate) => candidate.public_id === decision[1]);
        if (!request) return json({ error: { code: "not_found", message: "İstek bulunamadı" } }, 404);
        if (request.status !== "pending") return json({ error: { code: "already_processed", message: "Bu istek zaten işlenmiş" } }, 409);
        request.status = decision[2] === "approve" ? "approved" : "rejected";
        if (request.status === "approved") staffBalance -= request.amount;
        return json({ request, message: request.status === "approved" ? "Ödeme yapıldı" : "İstek reddedildi" });
      }

      const fallback = fallbackResponse(url.pathname);
      if (fallback !== undefined) return json(fallback);
      return route.fulfill({ status: 404, body: "not found" });
    });

    try {
      // Deep link: the protected-route guard sends us to /giris and back to /bakiye after login,
      // so there is no second page.goto racing the post-login redirect.
      await page.goto(`${app.url}/bakiye`);
      await expect(page).toHaveURL(/\/giris$/);
      await Promise.all([
        page.waitForResponse(`${backendBaseUrl}/auth/login`),
        page.getByRole("button", { name: /giriş yap/i }).click(),
      ]);
      await expect(page).toHaveURL(/\/bakiye$/);
      await expect(page.getByRole("link", { name: /bakiyeler/i })).toHaveCount(1);

      const flow = page.getByTestId("balances-flow");
      const hareketler = page.getByTestId("bakiye-hareketler");
      await expect(hareketler).toContainText("Komisyon");
      await expect(hareketler).toContainText("İptal Kesintisi");
      await expect(hareketler).toContainText("Geri Alma");
      await expect(hareketler).toContainText("Sipariş iptali: SP-2");
      await expect(hareketler).toContainText("Mehmet Kaya");
      await expect(hareketler).toContainText("İptal Kesintisi₺50");
      await expect(hareketler.locator("th")).toHaveText(
        role === "admin"
          ? ["Tür", "Tutar", "Sipariş", "Bakiye Sonrası", "Açıklama", "Personel", "Tarih"]
          : ["Tür", "Tutar", "Sipariş", "Bakiye Sonrası", "Açıklama", "Tarih"],
      );

      if (role === "admin") {
        await expect(flow).toContainText("Bakiye Yönetimi");
        await expect(flow).toContainText("Tüm personellerin bakiyelerini ve ödeme isteklerini yönetin");
        await expect(page.getByTestId("bakiye-odeme-iste")).toHaveCount(0);
        const staffCard = page.getByTestId("bakiye-personel-usr_staff");
        await expect(staffCard).toContainText("Ayşe Yılmaz");
        await expect(staffCard).toContainText("+₺100");
        await expect(staffCard).toContainText("bekliyor");
        await expect(page.getByTestId("bakiye-personel-usr_zero").getByRole("button", { name: "Bakiye Sıfırla" })).toHaveCount(0);

        // personel detay modal
        await staffCard.getByRole("button", { name: "Detay" }).click();
        const modal = page.getByTestId("bakiye-detay-modal");
        await expect(modal).toContainText("Ayşe Yılmaz - Siparişler");
        await expect(modal).toContainText("SP-1");
        await expect(modal).toContainText("Teslim Edildi");
        await expect(modal).toContainText("İptal");
        await expect(modal).toContainText("05551112233");
        await modal.getByRole("button", { name: "Kapat" }).click();
        await expect(modal).toHaveCount(0);

        // payment request approve / reject
        await expect(page.getByRole("tab", { name: /Ödeme İstekleri/ })).toContainText("2");
        await page.getByRole("tab", { name: /Ödeme İstekleri/ }).click();
        const istekler = page.getByTestId("bakiye-odeme-istekleri");
        await expect(istekler.locator("th")).toHaveText(["Personel", "Tutar", "Durum", "Tarih", "İşlem"]);
        await page.getByTestId("bakiye-istek-pay_1").getByRole("button", { name: "Onayla" }).click();
        await expect(page.getByTestId("bakiye-toast")).toContainText("Ödeme yapıldı");
        await expect(page.getByTestId("bakiye-istek-pay_1")).toContainText("Ödeme Yapıldı");
        await page.getByTestId("bakiye-istek-pay_2").getByRole("button", { name: "Reddet" }).click();
        await expect(page.getByTestId("bakiye-toast")).toContainText("İstek reddedildi");
        await expect(page.getByTestId("bakiye-istek-pay_2")).toContainText("Reddedildi");
        await expect(page.getByTestId("bakiye-istek-pay_2").getByRole("button", { name: "Onayla" })).toHaveCount(0);

        // bakiye sıfırla
        page.once("dialog", (dialog) => {
          expect(dialog.message()).toContain("Ayşe Yılmaz adlı personelin bakiyesi sıfırlanacak.");
          void dialog.accept();
        });
        await page.getByTestId("bakiye-personel-usr_staff").getByRole("button", { name: "Bakiye Sıfırla" }).click();
        await expect(page.getByTestId("bakiye-toast")).toContainText("Ayşe Yılmaz bakiyesi sıfırlandı (₺75)");
        await expect(page.getByTestId("bakiye-personel-usr_staff")).toContainText("₺0");

        expect(calls.map((call) => call.path)).toEqual([
          "/api/balances/payment-requests/pay_1/approve",
          "/api/balances/payment-requests/pay_2/reject",
          "/api/balances/staff/usr_staff/reset",
        ]);
      } else {
        await expect(flow).toContainText("Bakiyem");
        await expect(flow).toContainText("Komisyon bakiyenizi ve ödeme geçmişinizi görüntüleyin");
        const stats = page.getByTestId("bakiye-stats");
        await expect(stats).toContainText("Güncel Bakiye");
        await expect(stats).toContainText("+₺100");
        await expect(stats).toContainText("Toplam Komisyon");
        await expect(stats).toContainText("+₺150");
        await expect(stats).toContainText("Toplam Kesinti");
        await expect(stats).toContainText("-₺50");
        await expect(stats).toContainText("Ödenen");
        await expect(page.getByTestId("bakiye-personel-bakiyeleri")).toHaveCount(0);

        await page.getByRole("tab", { name: "Ödeme İstekleri" }).click();
        const istekler = page.getByTestId("bakiye-odeme-istekleri");
        await expect(istekler.locator("th")).toHaveText(["Tutar", "Durum", "Tarih"]);
        await expect(istekler).toContainText("Bekliyor");
        await expect(istekler.getByRole("button", { name: "Onayla" })).toHaveCount(0);

        // ödeme iste modal
        await page.getByTestId("bakiye-odeme-iste").click();
        const modal = page.getByTestId("bakiye-odeme-modal");
        await expect(modal).toContainText("Kullanılabilir Bakiye");
        await expect(modal).toContainText("₺65");
        await expect(modal).toContainText("(₺35 bekleyen ödeme isteği)");
        await modal.getByRole("button", { name: "₺100" }).click();
        await expect(modal.getByLabel("İstenen Tutar (₺)")).toHaveValue("65");
        await modal.getByRole("button", { name: "₺50" }).click();
        await expect(modal.getByLabel("İstenen Tutar (₺)")).toHaveValue("50");
        await modal.getByRole("button", { name: "Ödeme İsteği Gönder" }).click();
        await expect(page.getByTestId("bakiye-toast")).toContainText("Ödeme isteğiniz admin'e iletildi!");
        await expect(modal).toHaveCount(0);
        await expect(istekler).toContainText("₺50");
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
          path: "/api/balances/payment-requests",
          body: { amount: "50.00", idempotency_key: expect.stringContaining("odeme_") },
        });
      }
    } finally {
      await closeWebApp(app.server);
    }
  });
}

function fallbackResponse(pathname: string) {
  const emptyData = { data: [] };
  if (pathname === "/api/customers") {
    return {
      data: [
        {
          public_id: "cus_media",
          full_name: "Slice Müşteri",
          phone: "5550000000",
          email: null,
          username: null,
          notes: null,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
  }
  if (pathname === "/api/message-shortcuts") return emptyData;
  if (pathname === "/api/customers/summary") return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  if (pathname === "/api/orders") return emptyData;
  if (pathname === "/api/orders/summary") return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  if (pathname === "/api/products") return emptyData;
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
  if (pathname === "/api/shipments") return emptyData;
  if (pathname === "/api/shipments/summary") return { total_count: 0, active_count: 0, delivered_count: 0, recipient_phone_count: 0, provider_counts: { ptt: 0, surat: 0, other: 0 }, exception_counts: { ptt_not_delivered: 0, surat_not_delivered: 0, tracking_missing: 0 } };
  if (pathname === "/api/shipments/pipeline-summary") return { counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] };
  if (pathname === "/api/reports/summary") return { conversation_count: 0, order_count: 0, shipment_count: 0, total_revenue: 0, currency: "TRY", open_conversation_count: 0, pending_confirmation_count: 0, active_shipment_count: 0, delivered_shipment_count: 0, delivered_shipment_rate: 0, confirmation_rate: 0, active_shipment_rate: 0 };
  if (pathname === "/api/webphone/config") return { enabled: false, sip_username: null, sip_password_configured: false, ws_url: null, domain: null, stun: null };
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

function loginUser(overrides: Partial<PlaywrightUser> = {}): PlaywrightUser {
  return {
    public_id: "usr_messages_slice",
    email: "calisan@example.com",
    first_name: "Çalışan",
    last_name: "Kullanıcı",
    role: "calisan",
    permissions: [],
    is_online: true,
    sip_username: "1002",
    ...overrides,
  };
}

function loginBody(user: PlaywrightUser) {
  return {
    access_token: "messages-slice-token",
    refresh_token: "messages-slice-refresh-token",
    token_type: "Bearer",
    expires_in: 900,
    user,
  };
}
