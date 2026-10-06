import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { DebugRepository, trainingChannels, type ProviderAccountStatus, type ProviderAttemptRow, type WebhookEventRow } from "../debug/repository.js";
import { formatTrainingExport, trainingFormats } from "../debug/training.js";

/**
 * Legacy admin debug pages as backend read models: `/ayarlar/whatsapp-debug`, `/ayarlar/instagram-debug`,
 * `/ayarlar/ai-debug`, `/ayarlar/ai-egitim`. The API never calls a provider here: the WhatsApp test
 * message is a `provider-delivery` job (live call gated by providers.whatsapp.live_mode + account opt-in
 * in the worker) and the AI test stays inside the same dry-run boundary as `/api/ai/reply-suggestion`.
 * Manager-only (owner/admin).
 */

const secretKeyPattern = /token|secret|password|signature|authorization|api[_-]?key/i;
const previewLength = 600;

function isManager(role: string | undefined) {
  return role === "admin" || role === "owner";
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, secretKeyPattern.test(key) ? "[redacted]" : redact(item, depth + 1)]));
  }
  return value;
}

/** Webhook payload preview: secrets redacted, truncated like the legacy in-memory webhook log. */
export function payloadPreview(raw: unknown) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = raw;
    }
  }
  const text = JSON.stringify(redact(parsed));
  return text.length > previewLength ? `${text.slice(0, previewLength)}…` : text;
}

function serializeWebhook(event: WebhookEventRow) {
  return {
    public_id: event.public_id,
    provider: event.provider_key,
    event_type: event.event_type,
    status: event.status,
    received_at: event.received_at,
    processed_at: event.processed_at,
    preview: payloadPreview(event.raw_payload),
  };
}

function serializeAttempt(attempt: ProviderAttemptRow) {
  return {
    request_id: attempt.request_id,
    provider: attempt.provider_key,
    operation: attempt.operation,
    status: attempt.status,
    status_code: attempt.status_code,
    duration_ms: attempt.duration_ms,
    error_message: attempt.error_message,
    started_at: attempt.started_at,
  };
}

function booleanValue(value: unknown) {
  return value === true || value === "true";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function accountSummary(account: ProviderAccountStatus | undefined, providerLiveMode: boolean) {
  if (!account) return null;
  const accountLive = account.settings.live_mode;
  return {
    provider: account.provider_key,
    account_public_id: account.account_public_id,
    display_name: account.display_name,
    status: account.status,
    external_account_id: account.external_account_id,
    access_token_configured: account.token_types.includes("access_token"),
    verify_token_configured: account.secret_settings.includes("webhook.verify_token") || "webhook.verify_token" in account.settings,
    account_live_mode: accountLive === undefined ? null : booleanValue(accountLive),
    live_call_permitted: account.status === "active" && providerLiveMode && (accountLive === undefined || booleanValue(accountLive)),
  };
}

const testSendSchema = z.object({
  to: z.string().trim().min(6, "Telefon numarası gerekli").max(32),
  idempotency_key: z.string().trim().min(1).max(160),
});

const aiTestSchema = z.object({ message: z.string().trim().min(1, "Test mesajı gerekli").max(2000) });

const trainingQuerySchema = z.object({
  format: z.enum(trainingFormats).default("text"),
  channel: z.enum(trainingChannels).optional(),
  answered_only: z.enum(["true", "false"]).default("true"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  min_messages: z.coerce.number().int().min(2).max(50).default(2),
});

function invalid(context: Context<AppBindings>, error: z.ZodError, fallback: string) {
  const message = error.issues[0]?.message;
  return context.json({ error: { code: "invalid_request", message: message === "Telefon numarası gerekli" || message === "Test mesajı gerekli" ? message : fallback } }, 400);
}

export function createDebugRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);
  routes.use("*", async (context, next) => {
    if (!isManager(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Hata ayıklama sayfaları yalnızca yöneticiye açıktır" } }, 403);
    }
    await next();
  });

  const repoFor = (context: Context<AppBindings>) => new DebugRepository(context.get("db")!);

  routes.get("/whatsapp", async (context) => {
    const repo = repoFor(context);
    const [accounts, providerLive, stats, webhooks, attempts] = await Promise.all([
      repo.providerAccounts(["whatsapp"]),
      repo.globalSetting("providers.whatsapp.live_mode"),
      repo.channelStats(["whatsapp"]),
      repo.recentWebhookEvents(["whatsapp", "meta"], 20),
      repo.recentProviderAttempts(["whatsapp"], 20),
    ]);
    const account = accounts[0];
    return context.json({
      live_gate: "providers.whatsapp.live_mode",
      provider_live_mode: booleanValue(providerLive),
      callback_path: "/webhooks/whatsapp",
      config: account
        ? {
            ...accountSummary(account, booleanValue(providerLive)),
            phone_number_id: stringValue(account.settings.phone_number_id) ?? account.external_account_id,
            waba_id: stringValue(account.settings.waba_id),
            display_phone_number: stringValue(account.settings.display_phone_number),
          }
        : null,
      stats,
      webhooks: webhooks.map(serializeWebhook),
      attempts: attempts.map(serializeAttempt),
    });
  });

  routes.post("/whatsapp/test-send", async (context) => {
    const payload = testSendSchema.safeParse(await context.req.json().catch(() => null));
    if (!payload.success) return invalid(context, payload.error, "Invalid test message payload");
    const to = payload.data.to.replace(/\D/g, "");
    if (to.length < 10) return context.json({ error: { code: "invalid_request", message: "Telefon numarası gerekli" } }, 400);
    const account = (await repoFor(context).providerAccounts(["whatsapp"]))[0];
    const key = payload.data.idempotency_key;
    const suffix = createHash("sha256").update(key).digest("hex").slice(0, 24);
    const occurredAt = new Date().toISOString();
    const message = `🔧 Debug test mesajı - ${new Date().toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul" })}`;
    const requestId = `req_debug_wa_${suffix}`;
    const providerPayload = providerDeliveryJobPayloadSchema.parse({
      envelope: {
        request_id: requestId,
        provider: "whatsapp",
        operation: "message.send",
        direction: "outbound",
        channel: "whatsapp",
        ...(account ? { account_public_id: account.account_public_id } : {}),
        occurred_at: occurredAt,
        payload: { to, message, idempotency_key: key },
        legacy_contract: { source: "server.js POST /api/whatsapp/debug/test-send", legacy_event: "whatsapp_debug_test_send" },
      },
    });
    const job = jobEnvelopeSchema.parse({
      job_id: `job_debug_wa_${suffix}`,
      queue: "provider-delivery",
      name: "whatsapp.message.send",
      payload: providerPayload,
      requested_at: occurredAt,
      request_id: context.get("requestId"),
    });
    const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
    return context.json(
      {
        provider: "whatsapp",
        operation: "message.send",
        request_id: requestId,
        job_id: jobId,
        queued: jobId !== null,
        to,
        message,
        account_public_id: account?.account_public_id ?? null,
        live_gate: "providers.whatsapp.live_mode",
        live_call_permitted: false,
      },
      202,
    );
  });

  routes.get("/instagram", async (context) => {
    const repo = repoFor(context);
    const [accounts, instagramLive, messengerLive, stats, webhooks, attempts] = await Promise.all([
      repo.providerAccounts(["instagram", "messenger"]),
      repo.globalSetting("providers.instagram.live_mode"),
      repo.globalSetting("providers.messenger.live_mode"),
      repo.channelStats(["instagram", "messenger"]),
      repo.recentWebhookEvents(["instagram", "messenger", "meta"], 20),
      repo.recentProviderAttempts(["instagram", "messenger"], 20),
    ]);
    return context.json({
      live_gates: { instagram: "providers.instagram.live_mode", messenger: "providers.messenger.live_mode" },
      provider_live_mode: { instagram: booleanValue(instagramLive), messenger: booleanValue(messengerLive) },
      callback_paths: { instagram: "/webhooks/instagram", messenger: "/webhooks/messenger" },
      accounts: accounts.map((account) => accountSummary(account, booleanValue(account.provider_key === "instagram" ? instagramLive : messengerLive))),
      stats,
      webhooks: webhooks.map(serializeWebhook),
      attempts: attempts.map(serializeAttempt),
    });
  });

  routes.get("/ai", async (context) => {
    const repo = repoFor(context);
    const [enabled, model, prompt, stats, recent] = await Promise.all([
      repo.globalSetting("ai.auto_reply_enabled"),
      repo.globalSetting("ai.model"),
      repo.globalSetting("ai.system_prompt"),
      repo.aiStats(),
      repo.recentAiMessages(50),
    ]);
    const promptText = typeof prompt === "string" ? prompt.trim() : "";
    return context.json({
      config: {
        provider: "openai",
        auto_reply_enabled: booleanValue(enabled),
        model: stringValue(model),
        system_prompt_source: promptText ? "database" : "default",
        system_prompt_length: promptText.length,
        live_call_permitted: false,
        dry_run: true,
      },
      stats,
      recent: recent.map((message) => ({
        public_id: message.public_id,
        body: message.body,
        sent_at: message.sent_at,
        conversation_public_id: message.conversation_public_id,
        channel: message.channel,
        customer_name: message.customer_name,
        customer_phone: message.customer_phone,
      })),
    });
  });

  routes.post("/ai/test", async (context) => {
    const payload = aiTestSchema.safeParse(await context.req.json().catch(() => null));
    if (!payload.success) return invalid(context, payload.error, "Invalid AI test payload");
    const prompt = await repoFor(context).globalSetting("ai.system_prompt");
    const promptText = typeof prompt === "string" ? prompt.trim() : "";
    return context.json({
      provider: "openai",
      operation: "messages.reply_suggestion",
      dry_run: true,
      live_call_permitted: false,
      system_prompt_source: promptText ? "database" : "default",
      system_prompt_preview: promptText.slice(0, 200),
      test_message: payload.data.message,
      reply: "AI yanıt önerisi backend dry-run sınırında tutuldu.",
    });
  });

  routes.get("/ai-training/stats", async (context) => {
    const answeredOnly = context.req.query("answered_only") !== "false";
    return context.json(await repoFor(context).trainingStats(answeredOnly));
  });

  routes.get("/ai-training/export", async (context) => {
    const query = trainingQuerySchema.safeParse(Object.fromEntries(new URL(context.req.url).searchParams));
    if (!query.success) return invalid(context, query.error, "Invalid export query");
    const conversations = await repoFor(context).trainingConversations({
      channel: query.data.channel,
      answeredOnly: query.data.answered_only === "true",
      minMessages: query.data.min_messages,
      offset: query.data.offset,
      limit: query.data.limit,
    });
    const exported = formatTrainingExport(conversations, query.data.format);
    return new Response(exported.body, {
      status: 200,
      headers: {
        "content-type": exported.contentType,
        "content-disposition": `attachment; filename="ai-egitim-${query.data.offset}-${query.data.offset + query.data.limit}.${exported.extension}"`,
        "x-export-count": String(exported.count),
        "cache-control": "no-store",
      },
    });
  });

  return routes;
}
