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

type ActionOrder = {
  public_id: string;
  order_number: string;
  status: string;
  notes: string | null;
  total_amount: string;
  currency: string;
  customer_full_name: string | null;
  customer_phone: string | null;
  deleted_at: string | null;
  confirmation_status: string | null;
  kolaybi: { contact_id: string | null; address_id: string | null; invoice_id: string | null; status: string | null; error: string | null; e_document_status: string | null };
  confirmation_call: { status: string | null; bulk_id: string | null; pressed_key: string | null; listen_seconds: number | null; call_count: number };
  created_at: string;
  updated_at: string;
};

function actionOrder(overrides: Partial<ActionOrder> = {}): ActionOrder {
  return {
    public_id: "ord_1",
    order_number: "SP-1001",
    status: "draft",
    notes: null,
    total_amount: "2400.00",
    currency: "TRY",
    customer_full_name: "Mehmet Kaya",
    customer_phone: "05551112233",
    deleted_at: null,
    confirmation_status: null,
    kolaybi: { contact_id: null, address_id: null, invoice_id: null, status: null, error: null, e_document_status: null },
    confirmation_call: { status: null, bulk_id: null, pressed_key: null, listen_seconds: null, call_count: 0 },
    created_at: "2026-10-05T09:00:00.000Z",
    updated_at: "2026-10-05T09:00:00.000Z",
    ...overrides,
  };
}

function listOrder(order: ActionOrder) {
  return {
    public_id: order.public_id,
    order_number: order.order_number,
    status: order.status,
    source: "manual",
    cargo_provider: "ptt",
    total_amount: order.total_amount,
    currency: order.currency,
    confirmation_status: order.confirmation_status,
    notes: order.notes,
    customer_full_name: order.customer_full_name,
    created_by_user_public_id: "usr_staff",
    created_by_user_email: "staff@example.com",
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

function step(operation: string, provider: "kolaybi" | "netgsm", action: string) {
  return {
    public_id: `ops_${operation}`,
    action,
    provider,
    operation,
    attempt: 0,
    status: "queued",
    request_id: `req_order_${operation}`,
    job_id: `job_order_${operation}`,
    queued: true,
    error_message: null,
    created_at: "2026-10-06T09:00:00.000Z",
    updated_at: "2026-10-06T09:00:00.000Z",
  };
}

for (const role of ["admin", "calisan", "kargo_operatoru"] as const) {
  test(`${role} Sipariş aksiyonları legacy parity uses backend order action API`, async ({ page }) => {
    const app = await startWebApp();
    const user = loginUser({ role, email: `${role}@example.com` });
    const orders: ActionOrder[] = [
      actionOrder(),
      actionOrder({ public_id: "ord_2", order_number: "SP-1002", customer_full_name: "Zeynep Ak", confirmation_status: "teyit_edildi" }),
    ];
    const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const find = (publicId: string) => orders.find((order) => order.public_id === publicId && !order.deleted_at);

    await installRealtimeShim(page);
    await page.route(`${backendBaseUrl}/**`, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      if (url.pathname === "/auth/login") return json(loginBody(user));
      if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(user);
      if (url.pathname === "/api/conversations") return json({ data: [] });
      if (url.pathname === "/api/conversations/summary") {
        return json({ total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 0 } });
      }
      if (url.pathname === "/api/orders/product-options") return json({ data: [] });
      if (url.pathname === "/admin/integrations/provider-debug-summary") {
        return json({ providers: [], cron: { provider_keys: ["ptt", "surat"], operation: "shipment.track", total_attempts: 0, success_count: 0, failure_count: 0, retry_count: 0, total_duration_ms: 0, latest_attempt: null } });
      }
      if (url.pathname.startsWith("/admin/") || url.pathname === "/api/files/orphans") return json({ data: [] });
      if (url.pathname === "/api/orders" && method === "GET") {
        const visible = orders.filter((order) => !order.deleted_at).map(listOrder);
        return json({ data: visible, meta: { total_count: visible.length, limit: 50, offset: 0 } });
      }
      if (url.pathname.startsWith("/api/orders/") && method !== "GET") calls.push({ method, path: url.pathname, body });

      if (url.pathname === "/api/orders/bulk/confirmation-calls") {
        const ids = body.order_public_ids as string[];
        const results = ids.map((id) => {
          const order = find(id);
          if (!order) return { order_public_id: id, queued: false, skipped_reason: "not_found" };
          if (order.confirmation_status === "teyit_edildi") return { order_public_id: id, queued: false, skipped_reason: "already_confirmed" };
          order.confirmation_call.call_count += 1;
          return { order_public_id: id, queued: true, replayed: false, skipped_reason: null };
        });
        return json({ provider: "netgsm", operation: "call.confirmation.create", requested_count: ids.length, queued_count: results.filter((row) => row.queued).length, live_call_permitted: false, live_gate: "providers.netgsm.live_mode", results }, 202);
      }
      if (url.pathname === "/api/orders/bulk/kolaybi-transfer") {
        const ids = body.order_public_ids as string[];
        const results = ids.map((id) => ({ order_public_id: id, queued: true, replayed: false, skipped_reason: null }));
        return json({ provider: "kolaybi", operation: "contact.find", requested_count: ids.length, queued_count: ids.length, live_call_permitted: false, live_gate: "providers.kolaybi.live_mode", results }, 202);
      }

      const match = /^\/api\/orders\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (match && match[1] !== "summary" && match[1] !== "customer-lookup" && match[1] !== "product-options") {
        const order = find(match[1] as string);
        const suffix = match[2] ?? "";
        if (!order) return json({ error: { code: "not_found", message: "Sipariş bulunamadı" } }, 404);
        const stateResponse = () => json({ order });
        if (suffix === "/actions") return json({ order, steps: [] });
        if (suffix === "/status" && method === "PATCH") {
          order.status = body.status as string;
          return json(listOrder(order));
        }
        if (suffix === "/kolaybi/transfer") {
          order.kolaybi.status = "contact_lookup";
          return json({ provider: "kolaybi", operation: "contact.find", replayed: false, live_call_permitted: false, live_gate: "providers.kolaybi.live_mode", workflow: "kolaybi_cari_invoice", step: step("contact.find", "kolaybi", "kolaybi_transfer") }, 202);
        }
        if (suffix === "/provider-sync") {
          order.kolaybi = { contact_id: "41", address_id: "8", invoice_id: "5501", status: "completed", error: null, e_document_status: null };
          order.status = "confirmed";
          return json({ advanced_count: 3, order, steps: [{ ...step("invoice.create", "kolaybi", "kolaybi_transfer"), status: "succeeded" }] });
        }
        if (suffix === "/kolaybi/e-document") {
          order.kolaybi.e_document_status = "queued";
          return json({ provider: "kolaybi", operation: "invoice.e_document.create", replayed: false, live_call_permitted: false, live_gate: "providers.kolaybi.live_mode", step: step("invoice.e_document.create", "kolaybi", "e_document_create") }, 202);
        }
        if (suffix === "/confirmation-call") {
          order.confirmation_call.call_count += 1;
          return json({ provider: "netgsm", operation: "call.confirmation.create", replayed: false, live_call_permitted: false, live_gate: "providers.netgsm.live_mode", step: step("call.confirmation.create", "netgsm", "confirmation_call") }, 202);
        }
        if (suffix === "/confirmation") {
          order.confirmation_status = body.confirmation_status === "bekliyor" ? null : (body.confirmation_status as string);
          return stateResponse();
        }
        if (suffix === "/notes") {
          order.notes = (body.notes as string | null) ?? null;
          return stateResponse();
        }
        if (suffix === "/cancel") {
          order.status = body.status as string;
          if (order.kolaybi.invoice_id) order.kolaybi.e_document_status = "cancel_queued";
          return json({ replayed: false, order, e_document_cancel: order.kolaybi.invoice_id ? step("invoice.e_document.cancel", "kolaybi", "e_document_cancel") : null });
        }
        if (suffix === "/restore") {
          order.status = "draft";
          return stateResponse();
        }
        if (suffix === "" && method === "DELETE") {
          order.deleted_at = "2026-10-06T10:00:00.000Z";
          return json({ deleted: true, replayed: false, commission_preserved: role === "kargo_operatoru", order, e_document_cancel: null });
        }
      }
      const fallback = fallbackResponse(url.pathname);
      if (fallback !== undefined) return json(fallback);
      return route.fulfill({ status: 404, body: "not found" });
    });

    try {
      await page.goto(`${app.url}/giris`);
      await page.getByRole("button", { name: /giriş yap/i }).click();
      await expect(page.getByRole("link", { name: /siparişler/i })).toHaveCount(1);
      await page.getByRole("link", { name: /siparişler/i }).click();
      await expect(page.getByTestId("order-row-ord_1")).toBeVisible({ timeout: 15_000 });

      // Toplu aksiyonlar are enabled by the selection.
      await expect(page.getByTestId("orders-bulk-confirmation")).toBeDisabled();
      await expect(page.getByTestId("orders-bulk-kolaybi")).toBeDisabled();
      await page.getByTestId("orders-select-all").click();
      await expect(page.getByTestId("orders-bulk-confirmation")).toBeEnabled();
      page.once("dialog", (dialog) => {
        expect(dialog.message()).toBe("2 adet teyit edilmemiş siparişe arama yapılacak. Devam?");
        void dialog.accept();
      });
      await page.getByTestId("orders-bulk-confirmation").click();
      await expect(page.getByTestId("orders-bulk-message")).toHaveText("Toplu Teyit Araması: 1 başarılı, 1 hatalı");
      page.once("dialog", (dialog) => {
        expect(dialog.message()).toBe("2 adet sipariş KolayBi'ye aktarılacak. Devam?");
        void dialog.accept();
      });
      await page.getByTestId("orders-select-all").click();
      await page.getByTestId("orders-bulk-kolaybi").click();
      await expect(page.getByTestId("orders-bulk-message")).toHaveText("Toplu KolayBi Aktarım: 2 başarılı, 0 hatalı");

      // Detail actions.
      await page.getByTestId("order-row-ord_1").click();
      const actions = page.getByTestId("order-actions");
      await expect(actions).toContainText("Durumu Değiştir");
      await expect(page.getByTestId("order-teyit-badge")).toHaveText("Bekliyor");
      await expect(page.getByTestId("order-kolaybi-badge")).toHaveText("Bekliyor");

      await page.getByTestId("order-kolaybi-transfer").click();
      await expect(page.getByTestId("order-action-message")).toHaveText("KolayBi aktarımı kuyruğa alındı");
      await expect(page.getByTestId("order-kolaybi-badge")).toHaveText("Aktarılıyor...");
      await page.getByTestId("order-provider-sync").click();
      await expect(page.getByTestId("order-kolaybi-badge")).toHaveText("Aktarıldı");
      await expect(page.getByTestId("order-kolaybi-info")).toHaveText("KolayBi'ye aktarılmış · Fatura ID: 5501");
      await expect(page.getByTestId("order-kolaybi-transfer")).toBeDisabled();

      await page.getByTestId("order-e-document-send").click();
      await expect(page.getByTestId("order-action-message")).toHaveText("e-Fatura GİB'e gönderiliyor...");

      await page.getByTestId("order-confirmation-call").click();
      await expect(page.getByTestId("order-action-message")).toHaveText("Arama başlatıldı! (Mehmet Kaya - 05551112233)");
      await page.getByTestId("order-manual-confirm").click();
      await expect(page.getByTestId("order-teyit-badge")).toHaveText("Teyitli");

      await page.getByTestId("order-notes-input").fill("Kapıya bırakılacak");
      await page.getByTestId("order-notes-save").click();
      await expect(page.getByTestId("order-action-message")).toHaveText("Not kaydedildi");

      await page.getByTestId("order-status-preparing").click();
      await expect(page.getByTestId("order-action-message")).toHaveText("Sipariş durumu güncellendi: Hazırlanıyor");

      page.once("dialog", (dialog) => {
        expect(dialog.message()).toBe("\"SP-1001\" siparişi iptal edilecek.\nKolayBi faturası silinecek ve e-Fatura iptal edilecek.\n\nDevam etmek istiyor musunuz?");
        void dialog.accept();
      });
      await page.getByTestId("order-cancel").click();
      await expect(page.getByTestId("order-action-message")).toHaveText("KolayBi faturası ve e-Fatura iptal ediliyor...");
      await expect(page.getByTestId("order-kolaybi-badge")).toHaveText("KB İptal Edildi");

      page.once("dialog", (dialog) => {
        expect(dialog.message()).toBe("\"SP-1001\" siparişi geri alınacak ve \"Oluşturuldu\" durumuna çevrilecek.\n\nDevam etmek istiyor musunuz?");
        void dialog.accept();
      });
      await page.getByTestId("order-restore").click();
      await expect(page.getByTestId("order-action-message")).toHaveText("Sipariş geri alındı ve 'Oluşturuldu' durumuna döndürüldü");

      page.once("dialog", (dialog) => {
        expect(dialog.message()).toContain("\"SP-1001\" siparişi kalıcı olarak silinecek!");
        expect(dialog.message()).toContain("Bu işlem geri alınamaz. Devam etmek istiyor musunuz?");
        void dialog.accept();
      });
      await page.getByTestId("order-delete").click();
      await expect(page.getByTestId("order-row-ord_1")).toHaveCount(0);

      const paths = calls.map((call) => `${call.method} ${call.path}`);
      expect(paths).toEqual([
        "POST /api/orders/bulk/confirmation-calls",
        "POST /api/orders/bulk/kolaybi-transfer",
        "POST /api/orders/ord_1/kolaybi/transfer",
        "POST /api/orders/ord_1/provider-sync",
        "POST /api/orders/ord_1/kolaybi/e-document",
        "POST /api/orders/ord_1/confirmation-call",
        "PATCH /api/orders/ord_1/confirmation",
        "PATCH /api/orders/ord_1/notes",
        "PATCH /api/orders/ord_1/status",
        "POST /api/orders/ord_1/cancel",
        "POST /api/orders/ord_1/restore",
        "DELETE /api/orders/ord_1",
      ]);
      for (const call of calls.filter((item) => ["POST /api/orders/ord_1/kolaybi/transfer", "POST /api/orders/ord_1/cancel", "DELETE /api/orders/ord_1"].includes(`${item.method} ${item.path}`))) {
        expect(call.body.idempotency_key).toEqual(expect.any(String));
      }
      expect(calls[0]?.body).toMatchObject({ order_public_ids: ["ord_1", "ord_2"], idempotency_key: expect.stringContaining("bulk_teyit_") });
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
