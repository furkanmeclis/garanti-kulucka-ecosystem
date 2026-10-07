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

interface MockProduct {
  public_id: string;
  sku: string | null;
  name: string;
  category: string | null;
  unit_price: string;
  stock_quantity: number;
  is_active: boolean;
  external_product_id: string | null;
  unit: string;
  description: string | null;
  updated_at: string;
}

interface MockMovement {
  public_id: string;
  product_public_id: string;
  movement_type: "in" | "out" | "adjustment";
  quantity: number;
  previous_quantity: number;
  new_quantity: number;
  notes: string | null;
  created_by_user_email: string | null;
  created_at: string;
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

function product(overrides: Partial<MockProduct> & Pick<MockProduct, "public_id" | "name">): MockProduct {
  return {
    sku: null,
    category: "other",
    unit_price: "0.00",
    stock_quantity: 0,
    is_active: true,
    external_product_id: null,
    unit: "Adet",
    description: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function inferCategory(name: string) {
  const normalized = name.toLocaleLowerCase("tr");
  if (normalized.includes("kuluçka") || normalized.includes("makine")) return "incubator";
  if (normalized.includes("yedek") || normalized.includes("parça")) return "spare_part";
  return "other";
}

test("calisan Stok CRUD, stok giriş/çıkış ve hareket geçmişi backend API üzerinden çalışır", async ({ page }) => {
  const app = await startWebApp();
  const user = loginUser();
  const productQueries: string[] = [];
  const createPayloads: unknown[] = [];
  const updatePayloads: unknown[] = [];
  const movementPayloads: unknown[] = [];
  const deletedIds: string[] = [];
  let sequence = 0;
  let kolaybiRefreshes = 0;
  let products: MockProduct[] = [
    product({
      public_id: "prd_incubator",
      sku: "KLC-001",
      name: "El yapımı kuluçka makinası",
      category: "incubator",
      unit_price: "2550.00",
      stock_quantity: 12,
      external_product_id: "6202487",
    }),
    product({ public_id: "prd_fan", sku: "FAN-01", name: "Yedek Fan", category: "spare_part", unit_price: "85.00", stock_quantity: 0 }),
    product({ public_id: "prd_termostat", sku: "TRM-01", name: "Termostat", category: "spare_part", unit_price: "120.00", stock_quantity: 4 }),
    product({ public_id: "prd_box", sku: "DGR-002", name: "Karton Kutu", category: "other", unit_price: "5.00", stock_quantity: 40 }),
    product({ public_id: "prd_inactive", sku: "OLD-1", name: "Eski Kuluçka", category: "incubator", stock_quantity: 1, is_active: false }),
  ];
  const movements: MockMovement[] = [];

  await installRealtimeShim(page);

  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname === "/auth/login") return json(loginBody(user));
    if (url.pathname === "/auth/me") return json(user);

    if (url.pathname === "/api/products/kolaybi") {
      return json({ products: [{ id: "7633402", name: "Kuluçka 96 KolayBi", sale_price: "8500", stock_quantity: 2, unit: "Adet", category: null }], total: 1, synced_at: "2026-10-07T08:00:00.000Z", account_configured: true, live_call_permitted: false, live_gate: "providers.kolaybi.live_mode" });
    }
    if (url.pathname === "/api/products/kolaybi/refresh") {
      kolaybiRefreshes += 1;
      return json({ request_id: "req_1", job_id: "job_1", queued: true, live_call_permitted: false, live_gate: "providers.kolaybi.live_mode" }, 202);
    }
    if (url.pathname === "/api/products" && request.method() === "GET") {
      productQueries.push(url.search);
      const active = url.searchParams.get("active");
      const category = url.searchParams.get("category");
      const rows = products.filter(
        (item) => (active !== "true" || item.is_active) && (!category || item.category === category),
      );
      return json({ data: rows });
    }
    if (url.pathname === "/api/products" && request.method() === "POST") {
      const payload = request.postDataJSON() as Partial<MockProduct> & { name: string };
      createPayloads.push(payload);
      sequence += 1;
      const created = product({
        public_id: `prd_new_${sequence}`,
        name: payload.name,
        sku: payload.sku ?? null,
        category: payload.category ?? inferCategory(payload.name),
        unit: payload.unit ?? "Adet",
        unit_price: payload.unit_price ?? "0.00",
        stock_quantity: payload.stock_quantity ?? 0,
        description: payload.description ?? null,
        external_product_id: payload.external_product_id ?? null,
      });
      products = [...products, created];
      return json(created, 201);
    }

    const movementMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/stock-movements$/);
    if (movementMatch) {
      const publicId = decodeURIComponent(movementMatch[1] ?? "");
      const target = products.find((item) => item.public_id === publicId);
      if (!target) return json({ error: { code: "not_found", message: "Ürün bulunamadı" } }, 404);
      if (request.method() === "GET") {
        return json({ data: movements.filter((item) => item.product_public_id === publicId).reverse() });
      }
      const payload = request.postDataJSON() as { movement_type: "in" | "out"; quantity: number; notes: string | null };
      movementPayloads.push(payload);
      const delta = payload.movement_type === "in" ? payload.quantity : -payload.quantity;
      if (target.stock_quantity + delta < 0) {
        return json({ error: { code: "insufficient_stock", message: "Yetersiz stok" } }, 409);
      }
      const movement: MockMovement = {
        public_id: `stm_${movements.length + 1}`,
        product_public_id: publicId,
        movement_type: payload.movement_type,
        quantity: payload.quantity,
        previous_quantity: target.stock_quantity,
        new_quantity: target.stock_quantity + delta,
        notes: payload.notes,
        created_by_user_email: user.email,
        created_at: "2026-01-02T10:00:00.000Z",
      };
      movements.push(movement);
      target.stock_quantity += delta;
      return json({ product: target, movement }, 201);
    }

    const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
    if (productMatch && productMatch[1] !== "summary") {
      const publicId = decodeURIComponent(productMatch[1] ?? "");
      const target = products.find((item) => item.public_id === publicId);
      if (!target) return json({ error: { code: "not_found", message: "Ürün bulunamadı" } }, 404);
      if (request.method() === "PATCH") {
        const payload = request.postDataJSON() as Partial<MockProduct>;
        updatePayloads.push(payload);
        Object.assign(target, payload);
        return json(target);
      }
      if (request.method() === "DELETE") {
        deletedIds.push(publicId);
        target.is_active = false;
        return json(target);
      }
    }

    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) return json(fallback);
    await route.fulfill({ status: 404, body: "not found" });
  });

  try {
    await page.goto(`${app.url}/giris`);
    await page.getByRole("button", { name: /giriş yap/i }).click();
    await expect(page.getByRole("link", { name: /stoklar/i })).toHaveCount(1);
    await page.getByRole("link", { name: /stoklar/i }).click();

    const flow = page.getByTestId("inventory-flow");
    await expect(flow.getByRole("heading", { name: "Stok Kategorileri" })).toBeVisible();
    await expect(flow).toContainText("Stoklarınızı yönetmek için kategori seçiniz.");
    await expect(page.getByTestId("stok-category-incubator")).toContainText("1 Ürün");
    await expect(page.getByTestId("stok-category-incubator")).toContainText("(12 adet)");
    await expect(page.getByTestId("stok-category-spare_part")).toContainText("2 Ürün");
    await expect(page.getByTestId("stok-category-other")).toContainText("1 Ürün");
    await expect(page.getByTestId("stok-critical-warning")).toContainText("Kritik stok uyarısı: 2 ürün kritik seviyede, 1 ürün tükendi");
    await expect(page.getByTestId("stok-critical-warning")).toContainText("Yedek Fan (0)");
    await expect(page.getByTestId("stok-critical-warning")).not.toContainText("Eski Kuluçka");
    expect(productQueries.some((query) => query.includes("active=true"))).toBe(true);

    // Kategori + arama + durum filtreleri
    await page.getByTestId("stok-category-spare_part").click();
    await expect(flow.getByRole("heading", { name: "Yedek Parçalar" })).toBeVisible();
    await expect(flow).toContainText("Toplam 2 ürün listeleniyor");
    await expect(page.getByTestId("stok-product-prd_fan")).toContainText("Tükendi");
    await expect(page.getByTestId("stok-product-prd_termostat")).toContainText("Kritik");
    await page.getByLabel("Stok durumu").selectOption("tukendi");
    await expect(flow).toContainText("Toplam 1 ürün listeleniyor");
    await expect(page.getByTestId("stok-product-prd_termostat")).toHaveCount(0);
    await page.getByLabel("Stok durumu").selectOption("all");
    await page.getByLabel("Bu kategoride ara").fill("trm");
    await expect(flow).toContainText("Toplam 1 ürün listeleniyor");
    await expect(page.getByTestId("stok-product-prd_termostat")).toBeVisible();
    await page.getByLabel("Bu kategoride ara").fill("bulunmayan");
    await expect(page.getByTestId("stok-empty")).toContainText("Bu kategoride ürün yok");
    await page.getByRole("button", { name: "Kategorilere dön" }).click();

    // Yeni stok kartı
    await page.getByRole("button", { name: "Yeni Stok" }).click();
    const modal = page.getByTestId("stok-modal");
    await expect(modal).toContainText("Yeni Stok Kartı");
    await modal.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByTestId("stok-notice")).toContainText("Ürün adı gerekli");
    expect(createPayloads).toHaveLength(0);
    await modal.getByLabel("Stok Fiş Kodu / Kod").fill("KLC-024");
    await modal.getByLabel("Ürün Adı *").fill("Mini Kuluçka 24");
    await expect(modal.getByTestId("stok-kolaybi-info")).toContainText("1 KolayBi ürünü");
    await expect(page.locator("#stok-kolaybi-products option")).toHaveAttribute("value", "7633402");
    await modal.getByTestId("stok-kolaybi-refresh").click();
    await expect(modal.getByTestId("stok-kolaybi-info")).toContainText("Liste isteği kuyruğa alındı");
    expect(kolaybiRefreshes).toBe(1);
    await modal.getByLabel("KolayBi Ürün Eşleştirme").fill("7633402");
    await modal.getByLabel("Miktar *").fill("3");
    await modal.getByLabel("Birim Tutar").fill("900");
    await expect(modal.getByLabel("Toplam Tutar")).toHaveValue("2700.00");
    await modal.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByTestId("stok-notice")).toContainText("Yeni stok kartı oluşturuldu");
    expect(createPayloads[0]).toEqual({
      name: "Mini Kuluçka 24",
      sku: "KLC-024",
      unit: "Adet",
      unit_price: "900.00",
      stock_quantity: 3,
      description: null,
      external_product_id: "7633402",
    });
    await expect(page.getByTestId("stok-category-incubator")).toContainText("2 Ürün");

    // Düzenle
    await page.getByTestId("stok-category-incubator").click();
    await page.getByTestId("stok-product-prd_new_1").click();
    await expect(modal).toContainText("Stok Düzenle");
    await expect(modal.getByLabel("Ürün Adı *")).toHaveValue("Mini Kuluçka 24");
    await modal.getByLabel("Ürün Adı *").fill("Mini Kuluçka 24 Pro");
    await modal.getByLabel("Birim", { exact: true }).selectOption("Koli");
    await modal.getByRole("button", { name: "Onayla" }).click();
    await expect(page.getByTestId("stok-notice")).toContainText("Stok kartı güncellendi");
    expect(updatePayloads[0]).toMatchObject({ name: "Mini Kuluçka 24 Pro", unit: "Koli", stock_quantity: 3, sku: "KLC-024" });
    await expect(page.getByTestId("stok-product-prd_new_1")).toContainText("Mini Kuluçka 24 Pro");
    await expect(page.getByTestId("stok-product-prd_new_1")).toContainText("Birim: Koli");

    // Stok giriş → hareket yazılır
    await page.getByRole("button", { name: "El yapımı kuluçka makinası işlemleri" }).click();
    await page.getByRole("menuitem", { name: "Stok Giriş" }).click();
    await expect(modal).toContainText("Stok Giriş İşlemi");
    await expect(modal).toContainText("Mevcut Stok: 12 Adet");
    await expect(modal).toContainText("Gireceğiniz miktar mevcut stoğun üzerine eklenecektir.");
    await modal.getByLabel("Miktar *").fill("5");
    await modal.getByLabel("Açıklama").fill("Tedarikçi teslimatı");
    await modal.getByRole("button", { name: "Onayla" }).click();
    await expect(page.getByTestId("stok-notice")).toContainText("Giriş: 5 Adet → Yeni stok: 17");
    expect(movementPayloads[0]).toEqual({ movement_type: "in", quantity: 5, notes: "Tedarikçi teslimatı" });
    await expect(page.getByTestId("stok-product-prd_incubator")).toContainText("17");

    // Stok çıkış: yetersiz stok istemci tarafında engellenir, geçerli çıkış yazılır
    await page.getByRole("button", { name: "El yapımı kuluçka makinası işlemleri" }).click();
    await page.getByRole("menuitem", { name: "Stok Çıkış" }).click();
    await expect(modal).toContainText("Stok Çıkış İşlemi");
    await modal.getByLabel("Miktar *").fill("100");
    await modal.getByRole("button", { name: "Onayla" }).click();
    await expect(page.getByTestId("stok-notice")).toContainText("Yetersiz stok! Mevcut: 17, Çıkış: 100");
    expect(movementPayloads).toHaveLength(1);
    await modal.getByLabel("Miktar *").fill("2");
    await modal.getByRole("button", { name: "Onayla" }).click();
    await expect(page.getByTestId("stok-notice")).toContainText("Çıkış: 2 Adet → Yeni stok: 15");
    expect(movementPayloads[1]).toEqual({ movement_type: "out", quantity: 2, notes: null });

    // Hareket geçmişi
    await page.getByRole("button", { name: "El yapımı kuluçka makinası işlemleri" }).click();
    await page.getByRole("menuitem", { name: "Stok Hareketleri" }).click();
    const history = page.getByTestId("stok-history");
    await expect(history).toContainText("Stok Hareketleri — El yapımı kuluçka makinası");
    await expect(history.locator("tbody tr")).toHaveCount(2);
    await expect(history.locator("tbody tr").first()).toContainText("Çıkış");
    await expect(history.locator("tbody tr").first()).toContainText("17 → 15");
    await expect(history.locator("tbody tr").nth(1)).toContainText("Giriş");
    await expect(history.locator("tbody tr").nth(1)).toContainText("12 → 17");
    await expect(history).toContainText("Tedarikçi teslimatı");
    await history.getByRole("button", { name: "Kapat" }).click();

    // Soft delete (aktif=false)
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain('"Mini Kuluçka 24 Pro" stok kartını silmek istediğinize emin misiniz?');
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Mini Kuluçka 24 Pro işlemleri" }).click();
    await page.getByRole("menuitem", { name: "Sil" }).click();
    await expect(page.getByTestId("stok-notice")).toContainText('"Mini Kuluçka 24 Pro" silindi');
    expect(deletedIds).toEqual(["prd_new_1"]);
    await expect(page.getByTestId("stok-product-prd_new_1")).toHaveCount(0);
  } finally {
    await closeWebApp(app.server);
  }
});

test("kargo_operatoru Stoklar menüsünü görmez", async ({ page }) => {
  const app = await startWebApp();
  const user = loginUser({ role: "kargo_operatoru", email: "kargo@example.com" });
  await installRealtimeShim(page);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/login") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(loginBody(user)) });
      return;
    }
    if (url.pathname === "/auth/me") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(user) });
      return;
    }
    const fallback = url.pathname === "/api/products" ? { data: [] } : fallbackResponse(url.pathname);
    if (fallback !== undefined) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(fallback) });
      return;
    }
    await route.fulfill({ status: 404, body: "not found" });
  });
  try {
    await page.goto(`${app.url}/giris`);
    await page.getByRole("button", { name: /giriş yap/i }).click();
    await expect(page.getByRole("link", { name: /siparişler/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /stoklar/i })).toHaveCount(0);
  } finally {
    await closeWebApp(app.server);
  }
});

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
    public_id: "usr_stok_parity",
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
    access_token: "stok-parity-token",
    refresh_token: "stok-parity-refresh-token",
    token_type: "Bearer",
    expires_in: 900,
    user,
  };
}
