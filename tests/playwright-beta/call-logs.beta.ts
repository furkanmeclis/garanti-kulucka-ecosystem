import { expect, test } from "@playwright/test";
import {
  expectResponsiveLayout,
  login,
  mockBackend,
  mockUser,
  viewports,
  type ExtraRoute,
} from "./helpers";

test.use({ serviceWorkers: "block" });
const recording = "data:audio/wav;base64,UklGRg==";
const call = {
  public_id: "cal_test",
  direction: "inbound",
  status: "missed",
  caller: "05551112233",
  callee: "101",
  internal_number: "101",
  customer_number: "05551112233",
  talk_seconds: 42,
  hold_seconds: 5,
  initiated_at: "2026-10-17T09:00:00Z",
  connected_at: null,
  ended_at: "2026-10-17T09:01:00Z",
  user_public_id: "usr_calisan",
  user_name: "Ayşe Test",
  customer_public_id: "cus_1",
  order_public_id: "ord_1",
  has_recording: true,
  source: "netgsm_webhook",
};
function routes(): ExtraRoute {
  let token = "";
  return ({ path, method, body, url }) => {
    if (path === "/api/call-logs")
      return {
        status: 200,
        body: {
          data: url.searchParams.get("status") === "failed" ? [] : [call],
          total_count: 1,
          limit: 25,
          offset: 0,
        },
      };
    if (path === "/api/call-logs/cal_test/recording")
      return { status: 200, body: { download: { presigned_url: recording } } };
    if (path === "/admin/users")
      return {
        status: 200,
        body: {
          data: [
            { public_id: "usr_calisan", first_name: "Ayşe", last_name: "Test" },
          ],
          roles: [],
        },
      };
    if (
      path === "/admin/settings/netgsm.santral_webhook_token" &&
      method === "PUT"
    ) {
      token = (body as { value: string }).value;
      return {
        status: 200,
        body: { key: "netgsm.santral_webhook_token", value: token },
      };
    }
    if (path === "/admin/settings")
      return {
        status: 200,
        body: {
          data: [
            {
              key: "netgsm.santral_webhook_token",
              value: token,
              is_secret: false,
            },
          ],
        },
      };
    return undefined;
  };
}
for (const [name, viewport] of [
  ["desktop", viewports.desktop],
  ["phone", viewports.phone390],
] as const) {
  test(`Aramalar filters, recording and notification on ${name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const state = await mockBackend(page, mockUser("calisan"), {
      extra: routes(),
    });
    await page.goto("/aramalar");
    await login(page, state);
    await expect(page.getByTestId("page-call-logs")).toBeVisible();
    const list = page.getByTestId(
      name === "phone" ? "call-logs-list-cards" : "call-logs-list-table",
    );
    await expect(list).toContainText("05551112233");
    await expect(list).toContainText("Cevapsız");
    await page.getByLabel("Yön", { exact: true }).selectOption("outbound");
    await expect
      .poll(() =>
        state.requests.some(
          (r) =>
            r.path === "/api/call-logs" &&
            r.search.includes("direction=outbound"),
        ),
      )
      .toBe(true);
    await page.getByLabel("Yalnız cevapsız gelenler").check();
    await expect
      .poll(() =>
        state.requests.some(
          (r) =>
            r.path === "/api/call-logs" &&
            r.search.includes("missed_only=true"),
        ),
      )
      .toBe(true);
    await list.getByRole("button", { name: "Dinle" }).click();
    await expect(
      page.getByTestId("call-logs-section").locator("audio"),
    ).toHaveAttribute("src", recording);
    await page.getByTestId("notification-trigger").click();
    await expect(page.getByTestId("notification-callLogs")).toContainText(
      "Cevapsız gelen aramalar",
    );
    await page.keyboard.press("Escape");
    await expectResponsiveLayout(page, { checkTouchTargets: false });
    await page.getByLabel("Durum", { exact: true }).selectOption("failed");
    await expect(page.getByTestId("call-logs-list-empty")).toBeVisible();
  });
}
test("Santral token saves and builds a copyable webhook URL", async ({
  page,
}) => {
  const state = await mockBackend(page, mockUser("admin"), { extra: routes() });
  await page.goto("/ayarlar?tab=santral");
  await login(page, state);
  // Settings selects tabs with search params in the normal navigation.
  const tab = page.getByTestId("settings-tab-santral");
  if (await tab.isVisible()) await tab.click();
  await expect(page.getByTestId("santral-webhook-token")).toBeVisible();
  await page.getByTestId("santral-webhook-token").fill("test_token_123456789");
  const form = page
    .getByTestId("santral-webhook-token")
    .locator("xpath=ancestor::form");
  await form.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByTestId("santral-webhook-feedback")).toContainText(
    "Kaydedildi",
  );
  await expect
    .poll(() =>
      state.bodies.some(
        (r) => r.path === "/admin/settings/netgsm.santral_webhook_token",
      ),
    )
    .toBe(true);
  await expect(page.getByTestId("santral-webhook-url")).toContainText(
    "/api/netgsm/webhook/santral?token=test_token_123456789",
  );
});

test("customer and order call sections scope requests and support English", async ({
  page,
}) => {
  const base = routes();
  const extra: ExtraRoute = (request, state) => {
    if (request.path === "/api/orders/ord_1/actions")
      return {
        status: 200,
        body: {
          order: {
            public_id: "ord_1",
            order_number: "GK-1001",
            status: "draft",
            notes: null,
            total_amount: "300.00",
            currency: "TRY",
            customer_full_name: "Ayşe Test",
            customer_phone: "05551112233",
            deleted_at: null,
            confirmation_status: null,
            kolaybi: {
              contact_id: null,
              address_id: null,
              invoice_id: null,
              status: null,
              error: null,
              e_document_status: null,
            },
            confirmation_call: {
              status: null,
              bulk_id: null,
              pressed_key: null,
              listen_seconds: null,
              call_count: 0,
            },
            created_at: "2026-10-17T09:00:00Z",
            updated_at: "2026-10-17T09:00:00Z",
          },
          steps: [],
        },
      };
    return base(request, state);
  };
  const state = await mockBackend(page, mockUser("calisan"), { extra });
  await page.goto("/musteriler/cus_1");
  await login(page, state);
  await expect(page.getByTestId("call-logs-section")).toContainText("Aramalar");
  await expect
    .poll(() =>
      state.requests.some(
        (r) =>
          r.path === "/api/call-logs" &&
          r.search.includes("customer_public_id=cus_1"),
      ),
    )
    .toBe(true);
  await page.goto("/siparisler");
  await page
    .getByTestId("orders-table")
    .getByTestId("order-open")
    .filter({ hasText: "GK-1001" })
    .click();
  await expect(
    page.getByTestId("order-detail").getByTestId("call-logs-section"),
  ).toBeVisible();
  await expect
    .poll(() =>
      state.requests.some(
        (r) =>
          r.path === "/api/call-logs" &&
          r.search.includes("order_public_id=ord_1"),
      ),
    )
    .toBe(true);
  await page.evaluate(() => localStorage.setItem("garanti-beta-lang", "en"));
  await page.goto("/aramalar");
  await expect(
    page.getByTestId("page-call-logs").getByRole("heading", { level: 1 }),
  ).toHaveText("Call logs");
  await expect(page.getByTestId("call-logs-list-table")).toContainText(
    "Missed",
  );
});

test("cargo role cannot access the call log page", async ({ page }) => {
  const state = await mockBackend(page, mockUser("kargo_operatoru"), {
    extra: routes(),
  });
  await page.goto("/aramalar");
  await login(page, state);
  await expect(page).toHaveURL(/\/siparisler$/);
  expect(state.requests.some((r) => r.path === "/api/call-logs")).toBe(false);
});
