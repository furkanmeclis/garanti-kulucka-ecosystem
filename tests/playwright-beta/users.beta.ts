import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function managed(overrides: Record<string, unknown> = {}) {
  return { public_id: "usr_admin", email: "admin@example.com", first_name: "Ayşe", last_name: "Yılmaz", phone: null, role: "admin", is_active: true, is_online: true, last_seen_at: now, sip_username: null, sip_password_configured: false, created_at: now, ...overrides };
}

function routes() {
  const users = [
    managed(),
    managed({ public_id: "usr_2", email: "mehmet@example.com", first_name: "Mehmet", last_name: "Demir", phone: "05551112233", role: "calisan", sip_username: "101", sip_password_configured: true }),
    managed({ public_id: "usr_3", email: "kargo@example.com", first_name: "Can", last_name: "Kargo", role: "kargo_operatoru", is_active: false, last_seen_at: null }),
  ];
  const route: ExtraRoute = ({ method, path, body }) => {
    if (path === "/admin/users" && method === "GET") return { status: 200, body: { data: users, roles: ["admin", "calisan", "kargo_operatoru"] } };
    if (path === "/admin/users" && method === "POST") {
      const input = body as { email: string; first_name: string; last_name: string; phone: string | null; role: string };
      if (input.email === "taken@example.com") return { status: 409, body: { error: { code: "conflict", message: "Bu e-posta zaten kayıtlı." } } };
      return { status: 201, body: { user: managed({ public_id: "usr_new", ...input, last_seen_at: null, is_online: false }) } };
    }
    const match = /^\/admin\/users\/(usr_\w+)$/.exec(path);
    if (match && method === "PATCH") {
      const current = users.find((user) => user.public_id === match[1])!;
      const input = body as Record<string, unknown>;
      const { sip_password, ...rest } = input;
      return { status: 200, body: { user: { ...current, ...rest, ...(sip_password ? { sip_password_configured: true } : {}) } } };
    }
    if (match && method === "DELETE") return { status: 200, body: { user: users.find((user) => user.public_id === match[1]), deactivated: true } };
    if (path === "/admin/logs") {
      return {
        status: 200,
        body: {
          data: [
            { id: 1, actor_name: "Ayşe Yılmaz", action: "update", module: "settings", entity_id: "providers.netgsm.live_mode", created_at: now },
            { id: 2, actor_name: "Mehmet Demir", action: "create", module: "orders", entity_id: "ord_42", created_at: now },
            { id: 3, actor_name: null, action: "delete", module: "users", entity_id: "usr_9", created_at: now },
          ],
        },
      };
    }
    return undefined;
  };
  return route;
}

async function signIn(page: Page, role: string, viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role), { extra: routes() });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  return state;
}

test("users: list, search, create with validation and server error", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.getByTestId("desktop-settings-link").click();
  await page.getByTestId("settings-nav-item-users").click();
  await expect.poll(() => pathOf(page)).toBe("/kullanicilar");
  const table = page.getByTestId("users-table");
  await expect(table).toContainText("Mehmet Demir");
  await expect(table).toContainText("Kargo Operatörü");
  await expect(table.getByTestId("user-sip")).toContainText("101 · şifre tanımlı");
  await page.getByTestId("user-search").fill("kargo@");
  await expect(table).not.toContainText("Mehmet Demir");
  await page.getByTestId("user-search").fill("");

  await page.getByTestId("user-new").click();
  const sheet = page.getByTestId("user-sheet");
  await sheet.getByTestId("user-save").click();
  await expect(sheet.getByTestId("user-form-feedback")).toHaveText("E-posta, ad ve şifre zorunlu.");
  await sheet.getByTestId("user-first-name").fill("Zeynep");
  await sheet.getByTestId("user-last-name").fill("Kaya");
  await sheet.getByTestId("user-email").fill("taken@example.com");
  await sheet.getByTestId("user-password").fill("12345");
  await sheet.getByTestId("user-save").click();
  await expect(sheet.getByTestId("user-form-feedback")).toHaveText("Şifre en az 6 karakter olmalı.");
  await sheet.getByTestId("user-password").fill("gizli123");
  await sheet.getByTestId("user-save").click();
  await expect(sheet.getByTestId("user-form-feedback")).toContainText("Bu e-posta zaten kayıtlı.");
  await sheet.getByTestId("user-email").fill("zeynep@example.com");
  await sheet.getByTestId("user-role").selectOption("kargo_operatoru");
  await sheet.getByTestId("user-save").click();
  await expect(page.getByTestId("users-feedback")).toHaveText("Zeynep oluşturuldu.");
  await expect(table).toContainText("zeynep@example.com");
  const created = state.bodies.filter((entry) => entry.method === "POST" && entry.path === "/admin/users").at(-1)?.body;
  expect(created).toEqual({ email: "zeynep@example.com", first_name: "Zeynep", last_name: "Kaya", phone: null, password: "gizli123", role: "kargo_operatoru" });
});

test("users: edit with SIP, toggle active and delete; self is protected", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.goto("/kullanicilar");
  const table = page.getByTestId("users-table");
  const self = table.locator("tr", { hasText: "admin@example.com" });
  await expect(self.getByTestId("user-active")).toBeDisabled();
  await expect(self.getByTestId("user-delete")).toBeDisabled();

  const mehmet = table.locator("tr", { hasText: "mehmet@example.com" });
  await mehmet.getByTestId("user-edit").click();
  const sheet = page.getByTestId("user-sheet");
  await expect(sheet.getByTestId("user-sip-username")).toHaveValue("101");
  await expect(sheet.getByTestId("user-sip-password")).toHaveAttribute("placeholder", "Değiştirmek için yeni şifre");
  await sheet.getByTestId("user-phone").fill("05559998877");
  await sheet.getByTestId("user-sip-username").fill("102");
  await sheet.getByTestId("user-save").click();
  await expect(page.getByTestId("users-feedback")).toHaveText("Kullanıcı güncellendi.");
  await expect(mehmet).toContainText("05559998877");
  // A blank SIP password keeps the stored one, so it is not sent.
  expect(state.bodies.find((entry) => entry.method === "PATCH" && entry.path === "/admin/users/usr_2")?.body).toEqual({ first_name: "Mehmet", last_name: "Demir", phone: "05559998877", role: "calisan", sip_username: "102" });

  const can = table.locator("tr", { hasText: "kargo@example.com" });
  await expect(can).toContainText("Pasif");
  await can.getByTestId("user-active").check();
  await expect(can).toContainText("Aktif");
  expect(state.bodies.find((entry) => entry.method === "PATCH" && entry.path === "/admin/users/usr_3")?.body).toEqual({ is_active: true });

  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });
  await can.getByTestId("user-delete").click();
  await expect(page.getByTestId("users-feedback")).toHaveText("Kullanıcı silindi.");
  await expect(table).not.toContainText("kargo@example.com");
  expect(dialogs[0]).toContain("Can Kargo pasife alınır");
  expect(state.bodies.some((entry) => entry.method === "DELETE" && entry.path === "/admin/users/usr_3")).toBe(true);
});

test("activity logs: search and module filter, English", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await signIn(page, "owner");
  await page.goto("/islem-loglari");
  await expect(page.getByRole("heading", { name: "Activity Logs" })).toBeVisible();
  const table = page.getByTestId("logs-table");
  await expect(table).toContainText("providers.netgsm.live_mode");
  await page.getByTestId("logs-module").selectOption("orders");
  await expect(table).toContainText("ord_42");
  await expect(table).not.toContainText("usr_9");
  await page.getByTestId("logs-module").selectOption("");
  await page.getByTestId("logs-search").fill("usr_9");
  await expect(table).toContainText("delete");
  await expect(table).not.toContainText("ord_42");
});

test("users and logs: mobile cards, touch targets and manager-only access", async ({ page }) => {
  await signIn(page, "admin", viewports.phone390);
  await page.goto("/kullanicilar");
  await expect(page.getByTestId("users-cards")).toContainText("Mehmet Demir");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.goto("/islem-loglari");
  await expect(page.getByTestId("logs-cards")).toContainText("ord_42");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});

test("calisan cannot open users or logs", async ({ page }) => {
  await signIn(page, "calisan");
  await page.goto("/kullanicilar");
  await expect.poll(() => pathOf(page)).not.toBe("/kullanicilar");
  await page.goto("/islem-loglari");
  await expect.poll(() => pathOf(page)).not.toBe("/islem-loglari");
});
