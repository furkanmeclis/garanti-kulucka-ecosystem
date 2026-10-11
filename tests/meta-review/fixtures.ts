import type { BackendState, ExtraRoute } from "../playwright-beta/helpers";

export const NOW = "2026-10-10T09:00:00.000Z";
const earlier = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

export type Message = {
  public_id: string;
  sender_type: "customer" | "user" | "ai";
  sender_name: string | null;
  body: string | null;
  is_read: boolean;
  sent_at: string;
  attachments: Array<{ file_public_id: string; attachment_type: string; original_name: string; mime_type: string; byte_size: number }>;
};

export function conversationFixture(id: string, channel: "whatsapp" | "instagram" | "messenger", customer: { full_name: string; phone: string | null }, lastMessage: string, overrides: Record<string, unknown> = {}) {
  return {
    public_id: id, channel, status: "open", is_in_pool: false, human_agent_enabled: false, unread_count: 1,
    last_message_text: lastMessage, last_message_sender_type: "customer", last_message_at: earlier(1), customer,
    assigned_user_email: "agent@garantikulucka.com", updated_at: earlier(1), ...overrides,
  };
}

export const customers = {
  emma: { full_name: "Emma Clarke", phone: "+44 7700 900123" },
  liam: { full_name: "Liam Walker", phone: null },
  olivia: { full_name: "Olivia Bennett", phone: null },
};

export function applyEnglishState(state: BackendState) {
  state.conversations.splice(0, state.conversations.length,
    conversationFixture("cnv_wa", "whatsapp", customers.emma, "Hi, where is my order GK-1042?"),
    conversationFixture("cnv_ig", "instagram", customers.liam, "Is the Incubator Model A in stock?", { last_message_at: earlier(30), updated_at: earlier(30) }),
    conversationFixture("cnv_fb", "messenger", customers.olivia, "Do you ship to Scotland?"),
  ) ;
  state.orders.splice(0, state.orders.length, {
    public_id: "ord_1042", order_number: "GK-1042", status: "shipped", source: "conversation", cargo_provider: "ptt", total_amount: "3500.00", currency: "TRY",
    customer_full_name: "Emma Clarke", customer_phone: "+44 7700 900123", created_at: earlier(48),
  });
  state.customers.splice(0, state.customers.length,
    { public_id: "cus_emma", full_name: "Emma Clarke", phone: "+44 7700 900123", email: "emma@example.com", notes: null, updated_at: earlier(48) },
    { public_id: "cus_liam", full_name: "Liam Walker", phone: null, email: null, notes: null, updated_at: earlier(48) },
    { public_id: "cus_olivia", full_name: "Olivia Bennett", phone: null, email: null, notes: null, updated_at: earlier(48) },
  );
  state.shipments.splice(0, state.shipments.length, {
    public_id: "shp_1042", provider: "ptt", tracking_number: "TRK900042", status: "in_transit", recipient_name: "Emma Clarke", recipient_phone: "+44 7700 900123",
    recipient_city: "London", recipient_district: "Camden", last_event_text: "Left the transfer centre", order_number: "GK-1042", customer_full_name: "Emma Clarke", updated_at: earlier(6),
  });
}

export function combine(...routes: ExtraRoute[]): ExtraRoute {
  return (request, state) => {
    for (const route of routes) {
      const answer = route(request, state);
      if (answer) return answer;
    }
    return undefined;
  };
}

const products = [
  { public_id: "prd_1", name: "Incubator Model A", unit_price: "3500.00", stock_quantity: 12, external_product_id: null },
  { public_id: "prd_2", name: "Spare Motor", unit_price: "250.00", stock_quantity: 4, external_product_id: null },
];

export function inboxRoutes() {
  const messages: Record<string, Message[]> = {
    cnv_wa: [{ public_id: "msg_wa_1", sender_type: "customer", sender_name: "Emma Clarke", body: "Hi, where is my order GK-1042?", is_read: true, sent_at: earlier(1), attachments: [] }],
    cnv_ig: [{ public_id: "msg_ig_1", sender_type: "customer", sender_name: "Liam Walker", body: "Is the Incubator Model A in stock?", is_read: true, sent_at: earlier(30), attachments: [] }],
    cnv_fb: [{ public_id: "msg_fb_1", sender_type: "customer", sender_name: "Olivia Bennett", body: "Do you ship to Scotland?", is_read: true, sent_at: earlier(1), attachments: [] }],
  };
  let counter = 0;
  const addIncoming = (conversationId: string, text: string) => {
    counter += 1;
    const sender = conversationId === "cnv_wa" ? "Emma Clarke" : conversationId === "cnv_ig" ? "Liam Walker" : "Olivia Bennett";
    (messages[conversationId] ??= []).push({ public_id: `msg_in_${counter}`, sender_type: "customer", sender_name: sender, body: text, is_read: false, sent_at: new Date().toISOString(), attachments: [] });
  };
  const route: ExtraRoute = ({ method, path, body }, state) => {
    const thread = /^\/api\/conversations\/(cnv_\w+)\/messages$/.exec(path);
    if (thread && method === "GET") {
      const rows = messages[thread[1]!] ?? [];
      const row = state.conversations.find((item) => item.public_id === thread[1]);
      if (row) {
        const last = rows.at(-1);
        if (last) { row.last_message_text = last.body ?? ""; row.last_message_sender_type = last.sender_type; row.unread_count = rows.filter((m) => m.sender_type === "customer" && !m.is_read).length; }
      }
      return { status: 200, body: { data: [...rows], has_more: false } };
    }
    if (thread && method === "POST") {
      counter += 1;
      const input = body as { body: string | null; sender_name: string; attachments: Array<{ file_public_id: string; attachment_type: string }> };
      const message: Message = {
        public_id: `msg_out_${counter}`, sender_type: "user", sender_name: input.sender_name, body: input.body, is_read: true, sent_at: new Date().toISOString(),
        attachments: input.attachments.map((item) => ({ ...item, original_name: item.attachment_type === "image" ? "incubator-model-a.png" : "invoice-GK-1042.pdf", mime_type: item.attachment_type === "image" ? "image/png" : "application/pdf", byte_size: 4 })),
      };
      (messages[thread[1]!] ??= []).push(message);
      return { status: 201, body: message };
    }
    const stateMatch = /^\/api\/conversations\/(cnv_\w+)\/state$/.exec(path);
    if (stateMatch) {
      const row = state.conversations.find((item) => item.public_id === stateMatch[1])!;
      const input = body as { human_agent_enabled?: boolean; is_in_pool?: boolean; unread_count?: number; status?: string };
      if (input.human_agent_enabled !== undefined) row.human_agent_enabled = input.human_agent_enabled;
      if (input.is_in_pool !== undefined) row.is_in_pool = input.is_in_pool;
      if (input.unread_count !== undefined) row.unread_count = input.unread_count;
      if (input.status !== undefined) row.status = input.status;
      return { status: 200, body: { ...row, notes: null } };
    }
    if (path === "/api/conversations/mark-all-read") return { status: 200, body: { updated: 0 } };
    if (/^\/api\/conversations\/cnv_\w+\/(notes|customer-notes)$/.test(path)) return { status: 200, body: { notes: (body as { notes: string }).notes } };
    if (path === "/api/ai/reply-suggestion") return { status: 200, body: { suggestion: "Your order GK-1042 left our warehouse today; tracking number TRK900042.", dry_run: false } };
    if (path === "/api/app-settings/ai-status") return { status: 200, body: { ai_enabled: true } };
    if (path === "/admin/users") {
      return { status: 200, body: { data: [{ public_id: "usr_a", email: "noah@garantikulucka.com", first_name: "Noah", last_name: "Hughes", phone: null, role: "calisan", is_active: true, is_online: true, last_seen_at: NOW, sip_username: null, sip_password_configured: false, created_at: NOW }], roles: [] } };
    }
    if (path === "/api/message-shortcuts" && method === "GET") {
      return { status: 200, body: { data: [{ public_id: "msc_1", code: "shipping", message: "Your parcel is on its way. Tracking number: TRK900042", type: "custom", is_active: true, sort_order: 0, attachments: [], updated_at: NOW }] } };
    }
    if (path === "/api/files/uploads") return { status: 201, body: { file: { public_id: "fil_up", original_name: "incubator-model-a.png", mime_type: "image/png", byte_size: 4 }, upload: { method: "PUT", headers: {}, presigned_url: "http://127.0.0.1:65531/presigned/upload" } } };
    if (path === "/presigned/upload") return { status: 200, body: {} };
    if (path.startsWith("/api/files/") && path.endsWith("/download")) return { status: 200, body: { download: { presigned_url: null } } };
    if (path === "/api/orders/product-options") return { status: 200, body: { data: products } };
    if (path === "/api/orders/customer-lookup") return { status: 200, body: { customer: null, default_address: null } };
    if (path === "/api/orders" && method === "POST") return { status: 201, body: { public_id: "ord_new", order_number: "GK-1043", status: "draft", source: "conversation", total_amount: "3500.00", currency: "TRY" } };
    return undefined;
  };
  return { route, addIncoming, messages };
}

export function commentRoutes(): ExtraRoute {
  let comments = [
    { public_id: "cmt_ig_1", platform: "instagram", external_comment_id: "17890001", media_id: "m1", post_id: null, username: "hannah.farm", text: "How much is the Incubator Model A?", status: "manual", classification: "price_question", classification_reason: "Price question", confidence: 0.86, ai_reply_draft: "Hi Hannah, we have sent you the price in a direct message.", manual_reply: null, reply_type: null, error_message: null, received_at: earlier(2), updated_at: earlier(2) },
    { public_id: "cmt_ig_2", platform: "instagram", external_comment_id: "17890002", media_id: "m1", post_id: null, username: "spam.account.99", text: "Click here for free followers!!!", status: "manual", classification: "spam", classification_reason: "Spam", confidence: 0.97, ai_reply_draft: null, manual_reply: null, reply_type: null, error_message: null, received_at: earlier(3), updated_at: earlier(3) },
    { public_id: "cmt_ig_3", platform: "instagram", external_comment_id: "17890003", media_id: "m1", post_id: null, username: "troll.account", text: "Worst shop ever, total rubbish!", status: "manual", classification: "brand_disparagement", classification_reason: "Abusive", confidence: 0.92, ai_reply_draft: null, manual_reply: null, reply_type: null, error_message: null, received_at: earlier(4), updated_at: earlier(4) },
    { public_id: "cmt_fb_1", platform: "facebook", external_comment_id: "fb_1001", media_id: null, post_id: "p1", username: "George Mills", text: "Does the spare motor fit the 2024 model?", status: "manual", classification: "product_question", classification_reason: null, confidence: 0.8, ai_reply_draft: "Hi George, yes, the spare motor fits all models from 2022 onwards.", manual_reply: null, reply_type: null, error_message: null, received_at: earlier(4), updated_at: earlier(4) },
    { public_id: "cmt_fb_2", platform: "facebook", external_comment_id: "fb_1002", media_id: null, post_id: "p1", username: "Angry Buyer", text: "This is a scam, do not buy!", status: "manual", classification: "brand_disparagement", classification_reason: null, confidence: 0.9, ai_reply_draft: null, manual_reply: null, reply_type: null, error_message: null, received_at: earlier(5), updated_at: earlier(5) },
  ];
  let config = { enabled: true, platforms: { instagram: true, facebook: true }, reply_type: "public", delete_profanity: true, delete_brand_disparagement: false, risk_manual_examples: ["refund"], auto_reply_topics: ["price"], min_confidence: 0.7 };
  return ({ method, path, url, body }) => {
    if (path === "/api/comments" && method === "GET") {
      const status = url.searchParams.get("status");
      const platform = url.searchParams.get("platform");
      const rows = comments.filter((row) => (!status || row.status === status) && (!platform || row.platform === platform));
      return { status: 200, body: { data: rows, total: rows.length, page: 1, page_size: 30 } };
    }
    if (path === "/api/comments/stats") return { status: 200, body: { counts: { pending: 0, manual: comments.filter((r) => r.status === "manual").length, auto_replied: 12, replied: comments.filter((r) => r.status === "replied").length, deleted: comments.filter((r) => r.status === "deleted").length, hidden: comments.filter((r) => r.status === "hidden").length, error: 0 } } };
    if (path === "/api/comments/control") return { status: 200, body: { status: "ok", summary: { ok: 5, warning: 0, error: 0 }, warnings: [], checks: [] } };
    if (path === "/api/comments/settings" && method === "GET") return { status: 200, body: { config } };
    if (path === "/api/comments/settings" && method === "PUT") { config = body as typeof config; return { status: 200, body: { config } }; }
    const match = /^\/api\/comments\/(cmt_\w+)\/([a-z-]+)$/.exec(path);
    if (!match) return undefined;
    const row = comments.find((entry) => entry.public_id === match[1])!;
    if (match[2] === "ai-suggestion") return { status: 200, body: { provider: "openai", operation: "comments.reply_suggestion", dry_run: false, live_call_permitted: true, comment_public_id: row.public_id, action: "reply", suggestion: row.ai_reply_draft ?? "Thank you for your comment!" } };
    const next = match[2] === "reply" ? { status: "replied", manual_reply: (body as { message: string }).message, reply_type: (body as { reply_type: string }).reply_type } : match[2] === "hide" ? { status: "hidden" } : match[2] === "delete" ? { status: "deleted" } : { status: "manual" };
    comments = comments.map((entry) => (entry.public_id === row.public_id ? { ...entry, ...next } : entry));
    return { status: 200, body: { provider: row.platform, operation: null, action: match[2], job_id: "job_1", queued: true, replayed: false, live_call_permitted: true, comment: comments.find((entry) => entry.public_id === row.public_id) } };
  };
}

function account(provider: string, overrides: Record<string, unknown> = {}) {
  return { public_id: `acc_${provider}`, provider_key: provider, provider_name: provider, display_name: provider, external_account_id: null, status: "active", metadata: {}, updated_at: NOW, ...overrides };
}
function setting(key: string, value: unknown, isSecret = false) {
  return { public_id: `set_${key}`, key, value: isSecret ? null : value, is_secret: isSecret, updated_at: NOW };
}
function token(type: string) {
  return { public_id: `tok_${type}`, token_type: type, value: null, expires_at: null, last_refreshed_at: null, updated_at: NOW };
}

export function settingsRoutes(): ExtraRoute {
  const accounts = [
    account("whatsapp", { display_name: "Garanti Kuluçka WhatsApp", external_account_id: "1128646770325911" }),
    account("instagram", { display_name: "@garantikulucka", external_account_id: "17841400000000000" }),
    account("messenger", { display_name: "Garanti Kuluçka Page", external_account_id: "296265270245200" }),
  ];
  const snapshots: Record<string, { settings: unknown[]; tokens: unknown[] }> = {
    acc_whatsapp: { settings: [setting("phone_number_id", "1128646770325911"), setting("waba_id", "1931036684950470"), setting("display_phone_number", "+90 322 911 03 70"), setting("webhook.verify_token", "x", true), setting("live_mode", true)], tokens: [token("access_token")] },
    acc_instagram: { settings: [setting("ig_user_id", "17841400000000000"), setting("login_type", "instagram_login")], tokens: [token("access_token")] },
    acc_messenger: { settings: [setting("page_id", "296265270245200")], tokens: [token("page_access_token")] },
  };
  const globalSettings = [
    { key: "ai.system_prompt", scope: "global", value: "You are the Garanti Kuluçka support assistant.", is_secret: false, updated_at: NOW },
    { key: "sip_config", scope: "global", value: { ws_url: "wss://pbx.example.com/ws", domain: "pbx.example.com", stun: "stun:stun.example.com:3478" }, is_secret: false, updated_at: NOW },
    { key: "vapi_ayarlar", scope: "global", value: { enabled: false }, is_secret: false, updated_at: NOW },
  ];
  return ({ method, path, body }) => {
    if (path === "/api/app-settings/ai-status") return { status: 200, body: { ai_enabled: true } };
    if (path === "/admin/settings" && method === "GET") return { status: 200, body: { data: globalSettings } };
    const settingMatch = /^\/admin\/settings\/([^/]+)$/.exec(path);
    if (settingMatch && method === "PUT") { const input = body as { value: unknown; is_secret: boolean }; return { status: 200, body: { key: decodeURIComponent(settingMatch[1]!), scope: "global", value: input.is_secret ? null : input.value, is_secret: input.is_secret, updated_at: NOW } }; }
    if (path === "/admin/integrations/accounts" && method === "GET") return { status: 200, body: { data: accounts } };
    if (path === "/admin/integrations/accounts" && method === "POST") { const input = body as { provider_key: string; external_account_id: string | null; display_name: string }; return { status: 201, body: account(input.provider_key, { external_account_id: input.external_account_id, display_name: input.display_name }) }; }
    const metaAction = /^\/admin\/integrations\/accounts\/([^/]+)\/(webhook-subscription|thread-control|disconnect)$/.exec(path);
    if (metaAction && method === "POST") {
      const found = accounts.find((item) => item.public_id === metaAction[1])!;
      if (metaAction[2] === "disconnect") { found.status = "inactive"; return { status: 200, body: { account: found, removed_tokens: 1, unsubscribe_job_id: `job_${found.public_id}_unsubscribe` } }; }
      const input = body as { action: string };
      return { status: 202, body: { queued: true, job_id: `job_${found.provider_key}_${input.action}`, request_id: "req_1", account_public_id: found.public_id, provider_key: found.provider_key, operation: input.action, live_gate: `providers.${found.provider_key}.live_mode` } };
    }
    const accountMatch = /^\/admin\/integrations\/accounts\/([^/]+)$/.exec(path);
    if (accountMatch && method === "GET") { const found = accounts.find((item) => item.public_id === accountMatch[1]); return found ? { status: 200, body: { account: found, ...snapshots[found.public_id] } } : { status: 404, body: { error: { code: "not_found", message: "not found" } } }; }
    const integrationSetting = /^\/admin\/integrations\/accounts\/([^/]+)\/settings\/([^/]+)$/.exec(path);
    if (integrationSetting && method === "PUT") { const input = body as { value: unknown; is_secret: boolean }; return { status: 200, body: setting(decodeURIComponent(integrationSetting[2]!), input.value, input.is_secret) }; }
    const integrationToken = /^\/admin\/integrations\/accounts\/([^/]+)\/tokens\/([^/]+)$/.exec(path);
    if (integrationToken && method === "PUT") return { status: 200, body: { public_id: "tok_new", token_type: integrationToken[2], value: null } };
    return undefined;
  };
}

export function publishRoutes(): ExtraRoute {
  let polls = 0;
  const publication = (status: string) => ({ public_id: "igp_1", account_public_id: "iac_garantikulucka", media_kind: "image", media_type: "IMAGE", media_url: "https://cdn.example.com/incubator-model-a.jpg", file_public_id: null, caption: "New arrival: Incubator Model A", idempotency_key: "k", request_id: "req_ig", job_id: "job_ig", queued: true, status, media_id: status === "published" ? "17895695668004550" : null, error_message: null, created_at: NOW });
  return ({ method, path }) => {
    if (path === "/api/instagram/publications" && method === "POST") return { status: 202, body: { provider: "instagram", operation: "media.publish", publication: publication("queued"), job_id: "job_ig", queued: true, replayed: false, live_call_permitted: true, live_gate: "providers.instagram.live_mode" } };
    if (path === "/api/instagram/publications/igp_1") { polls += 1; return { status: 200, body: publication(polls > 1 ? "published" : "queued") }; }
    return undefined;
  };
}
