import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function smsRoutes() {
  let templates = [
    { public_id: "tpl_1", title: "Kargoya verildi", body: "Sayın {musteri_adi}, siparişiniz {kargo_firmasi} ile yola çıktı. Takip: {takip_no}", sort_order: 1, is_active: true, is_system: true, created_at: now, updated_at: now },
    { public_id: "tpl_2", title: "Teşekkür", body: "Bizi tercih ettiğiniz için teşekkürler.", sort_order: 2, is_active: true, is_system: false, created_at: now, updated_at: now },
  ];
  const message = (index: number, extra: Record<string, unknown> = {}) => ({
    public_id: `sms_${index}`, recipient_phone: `0555000000${index}`, customer_name: `Müşteri ${index}`, tracking_number: null, message: "Kargonuz yolda", is_automatic: index % 2 === 0,
    status: index === 3 ? "failed" : "sent", error_message: null, provider_bulk_id: null, request_id: `req_${index}`, job_id: null, queued: true, created_at: now, ...extra,
  });
  const route: ExtraRoute = ({ method, path, url, body }) => {
    if (path === "/api/sms/templates" && method === "GET") return { status: 200, body: { data: templates } };
    if (path === "/api/sms/templates" && method === "POST") {
      const input = body as { title: string; body: string };
      const created = { ...templates[1]!, public_id: "tpl_new", title: input.title, body: input.body };
      templates = [...templates, created];
      return { status: 201, body: { template: created } };
    }
    const match = path.match(/^\/api\/sms\/templates\/(tpl_\w+)$/);
    if (match && method === "PATCH") {
      templates = templates.map((entry) => (entry.public_id === match[1] ? { ...entry, ...(body as object) } : entry));
      return { status: 200, body: { template: templates.find((entry) => entry.public_id === match[1]) } };
    }
    if (match && method === "DELETE") {
      templates = templates.filter((entry) => entry.public_id !== match[1]);
      return { status: 200, body: { deleted: true } };
    }
    if (path === "/api/sms/history") {
      const type = url.searchParams.get("type");
      const rows = [message(1), message(2), message(3)].filter((row) => type === "all" || (type === "automatic") === row.is_automatic);
      return { status: 200, body: { data: rows, total: rows.length, page: 1, page_size: 25 } };
    }
    if (path === "/api/sms/manual-send") {
      const input = body as { recipients: string[] };
      return { status: 202, body: { provider: "netgsm", operation: "sms.send", recipient_count: input.recipients.length, queued_count: input.recipients.length, replayed: false, live_call_permitted: false, live_gate: "providers.netgsm.live_mode", messages: input.recipients.map((phone, index) => message(10 + index, { recipient_phone: phone, status: "queued" })) } };
    }
    if (path === "/api/sms/automatic/trigger") return { status: 202, body: { provider: (body as { provider: string }).provider, operation: "shipment.track", checked_count: 4, queued_count: 4, job_ids: [], live_call_permitted: false, live_gate: "providers.ptt.live_mode" } };
    return undefined;
  };
  return route;
}

function commentRoutes() {
  let comments = [
    { public_id: "cmt_1", platform: "instagram", external_comment_id: "17890", media_id: "m1", post_id: null, username: "ciftci_ali", text: "Fiyatı ne kadar?", status: "manual", classification: "price_question", classification_reason: "Fiyat sorusu", confidence: 0.82, ai_reply_draft: "Merhaba, fiyat bilgisi için DM atabilirsiniz.", manual_reply: null, reply_type: null, error_message: null, received_at: now, updated_at: now },
    { public_id: "cmt_2", platform: "facebook", external_comment_id: "fb_1", media_id: null, post_id: "p1", username: "zeynep", text: "Kargo gelmedi!", status: "manual", classification: "complaint", classification_reason: null, confidence: 0.6, ai_reply_draft: null, manual_reply: null, reply_type: null, error_message: null, received_at: now, updated_at: now },
  ];
  let config = { enabled: true, platforms: { instagram: true, facebook: false }, reply_type: "public", delete_profanity: true, delete_brand_disparagement: false, risk_manual_examples: ["iade"], auto_reply_topics: ["fiyat"], min_confidence: 0.7 };
  const route: ExtraRoute = ({ method, path, url, body }) => {
    if (path === "/api/comments" && method === "GET") {
      const status = url.searchParams.get("status");
      const platform = url.searchParams.get("platform");
      const rows = comments.filter((row) => (!status || row.status === status) && (!platform || row.platform === platform));
      return { status: 200, body: { data: rows, total: rows.length, page: 1, page_size: 30 } };
    }
    if (path === "/api/comments/stats") return { status: 200, body: { counts: { pending: 0, manual: comments.filter((row) => row.status === "manual").length, auto_replied: 5, replied: 3, deleted: 1, hidden: comments.filter((row) => row.status === "hidden").length, error: 0 } } };
    if (path === "/api/comments/control") {
      return { status: 200, body: { status: "warning", summary: { ok: 4, warning: 1, error: 0 }, warnings: [{ id: "facebook", level: "warning", title: "Facebook kapalı", detail: "Facebook yorumları işlenmiyor" }], checks: [] } };
    }
    if (path === "/api/comments/settings" && method === "GET") return { status: 200, body: { config } };
    if (path === "/api/comments/settings" && method === "PUT") {
      config = body as typeof config;
      return { status: 200, body: { config } };
    }
    const match = path.match(/^\/api\/comments\/(cmt_\w+)\/([a-z-]+)$/);
    if (!match) return undefined;
    const row = comments.find((entry) => entry.public_id === match[1])!;
    if (match[2] === "ai-suggestion") return { status: 200, body: { provider: "openai", operation: "comments.reply_suggestion", dry_run: true, live_call_permitted: false, comment_public_id: row.public_id, action: "reply", suggestion: "Merhaba Zeynep Hanım, kargonuzu hemen kontrol ediyoruz." } };
    const next = match[2] === "reply" ? { status: "replied", manual_reply: (body as { message: string }).message, reply_type: (body as { reply_type: string }).reply_type } : match[2] === "hide" ? { status: "hidden" } : match[2] === "delete" ? { status: "deleted" } : { status: "manual" };
    comments = comments.map((entry) => (entry.public_id === row.public_id ? { ...entry, ...next } : entry));
    return { status: 200, body: { provider: "instagram", operation: null, action: match[2], job_id: "job_1", queued: true, replayed: false, live_call_permitted: false, comment: comments.find((entry) => entry.public_id === row.public_id) } };
  };
  return route;
}

async function signIn(page: Page, role: string, viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const sms = smsRoutes();
  const comments = commentRoutes();
  const state = await mockBackend(page, mockUser(role), { extra: (request, current) => sms(request, current) ?? comments(request, current) });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  return state;
}

test("sms: template + variables guard, send, history filter and automatic sweep", async ({ page }) => {
  const state = await signIn(page, "calisan");
  await page.getByTestId("desktop-more-trigger").click();
  await page.getByTestId("more-sms").click();
  await expect.poll(() => pathOf(page)).toBe("/sms");
  await page.getByTestId("sms-phones").fill("0555 111 22 33\n05559998877, abc");
  await page.getByTestId("sms-template").selectOption("tpl_1");
  await expect(page.getByTestId("sms-message")).toHaveValue(/Sayın \{musteri_adi\}/);
  await page.getByTestId("sms-send").click();
  await expect(page.getByTestId("sms-feedback")).toHaveText("Mesajda doldurulmamış değişken var ({musteri_adi} vb.)");
  await page.getByTestId("sms-template").selectOption("tpl_2");
  await expect(page.getByTestId("sms-counter")).toContainText("39 karakter");
  await expect(page.getByTestId("sms-counter")).toContainText("Türkçe karakter → 70 karakter/SMS");
  await page.getByTestId("sms-send").click();
  await expect(page.getByTestId("sms-feedback")).toHaveText("2 SMS başarıyla gönderildi");
  const sent = state.bodies.find((entry) => entry.path === "/api/sms/manual-send")?.body as { recipients: string[]; template_public_id: string; idempotency_key: string };
  expect(sent).toMatchObject({ recipients: ["05551112233", "05559998877"], template_public_id: "tpl_2" });
  await expect(page.getByTestId("sms-session")).toContainText("05551112233");

  await page.getByTestId("sms-tab-history").click();
  const history = page.getByTestId("sms-history-table");
  await expect(history.getByTestId("sms-history-row")).toHaveCount(3);
  await page.getByTestId("filter-sms-type").click();
  await page.getByRole("option", { name: "Otomatik" }).click();
  await expect(history.getByTestId("sms-history-row")).toHaveCount(1);

  await page.getByTestId("sms-tab-automatic").click();
  await page.getByTestId("sms-trigger-ptt").click();
  await expect(page.getByTestId("sms-automatic-feedback")).toHaveText("PTT takip güncelleme başlatıldı");
});

test("sms templates: add, edit and the system template cannot be deleted", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.goto("/sms");
  await page.getByTestId("sms-tab-templates").click();
  await expect(page.getByTestId("sms-template-card")).toHaveCount(2);
  await expect(page.getByTestId("sms-template-card").first().getByTestId("sms-template-delete")).toHaveCount(0);
  await page.getByTestId("sms-template-new").click();
  await page.getByTestId("sms-template-save").click();
  await expect(page.getByTestId("sms-template-sheet")).toBeVisible();
  await page.getByTestId("sms-template-title").fill("Teyit");
  await page.getByTestId("sms-template-body").fill("Siparişinizi onaylıyor musunuz?");
  await page.getByTestId("sms-template-save").click();
  await expect(page.getByTestId("sms-template-feedback")).toHaveText("Şablon eklendi");
  await expect(page.getByTestId("sms-template-card")).toHaveCount(3);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("sms-template-card").nth(1).getByTestId("sms-template-delete").click();
  await expect(page.getByTestId("sms-template-feedback")).toHaveText("Şablon silindi");
  expect(state.bodies.some((entry) => entry.method === "DELETE" && entry.path === "/api/sms/templates/tpl_2")).toBe(true);
});

test("comments: control report, reply with AI suggestion, hide, settings", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.goto("/yorumlar");
  await expect(page.getByTestId("comments-control")).toContainText("Yorum AI çalışır ama uyarılar var");
  await expect(page.getByTestId("comments-tab-manual")).toContainText("2");
  await expect(page.getByTestId("comment-card")).toHaveCount(2);

  await page.getByTestId("comment-card").nth(1).getByTestId("comment-reply").click();
  const sheet = page.getByTestId("comment-reply-sheet");
  await sheet.getByTestId("comment-ai-suggest").click();
  await expect(sheet.getByTestId("comment-reply-message")).toHaveValue("Merhaba Zeynep Hanım, kargonuzu hemen kontrol ediyoruz.");
  await sheet.getByTestId("comment-reply-type-private").click();
  await sheet.getByTestId("comment-reply-send").click();
  await expect(page.getByTestId("comments-feedback")).toHaveText("Cevap gönderildi");
  expect(state.bodies.find((entry) => entry.path === "/api/comments/cmt_2/reply")?.body).toMatchObject({ message: "Merhaba Zeynep Hanım, kargonuzu hemen kontrol ediyoruz.", reply_type: "private" });

  await page.getByTestId("comment-card").first().getByTestId("comment-hide").click();
  await expect(page.getByTestId("comments-feedback")).toHaveText("Yorum gizlendi");
  await expect(page.getByTestId("comment-card").first()).toContainText("Gizlendi");

  await page.getByTestId("comments-settings-open").click();
  const settings = page.getByTestId("comments-settings");
  await expect(settings.getByTestId("comments-platform-facebook")).not.toBeChecked();
  await settings.getByTestId("comments-platform-facebook").check();
  await settings.getByTestId("comments-topics").fill("fiyat\ngaranti");
  await settings.getByTestId("comments-settings-save").click();
  await expect(settings.getByTestId("comments-settings-feedback")).toHaveText("Ayarlar kaydedildi");
  expect(state.bodies.find((entry) => entry.method === "PUT" && entry.path === "/api/comments/settings")?.body).toMatchObject({ platforms: { instagram: true, facebook: true }, auto_reply_topics: ["fiyat", "garanti"] });
});

test("sms and comments on a phone, English; cargo operator gets SMS but not comments", async ({ page }) => {
  await signIn(page, "calisan", viewports.phone360);
  await page.goto("/yorumlar");
  await expect(page.getByTestId("comment-card")).toHaveCount(2);
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.goto("/sms");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.evaluate(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await page.reload();
  await expect(page.getByTestId("sms-tab-history")).toHaveText("History");
});

test("cargo operator: SMS allowed, comments redirected", async ({ page }) => {
  await signIn(page, "kargo_operatoru");
  await page.goto("/sms");
  await expect(page.getByTestId("page-sms")).toBeVisible();
  await page.goto("/yorumlar");
  await expect.poll(() => pathOf(page)).toBe("/siparisler");
});
