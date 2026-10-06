import { Hono } from "hono";
import { z } from "zod";
import { validateIntegrationSetting } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { AuditRepository, parseAuditLimit, serializeAuditLog } from "../audit/repository.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import {
  IntegrationsRepository,
  instagramAnalyticsSummaryFromMetadata,
  parseProviderAttemptLimit,
  serializeAccount,
  serializeAccountSnapshot,
  serializeIntegrationSetting,
  serializeIntegrationToken,
  serializeProviderDebugSummary,
  serializeProviderAttempt,
  serializeProvider,
} from "../integrations/repository.js";
import { apiProviderCatalog } from "../providers/catalog.js";
import { isAllowedOutboundUserUrl } from "../security/url-policy.js";

const metadataSchema = z.record(z.string(), z.unknown()).default({});

const upsertAccountSchema = z.object({
  provider_key: z.string().min(1),
  display_name: z.string().min(1),
  external_account_id: z.string().min(1).nullable().default(null),
  metadata: metadataSchema,
});

const upsertSettingSchema = z.object({
  value: z.unknown(),
  is_secret: z.boolean().default(false),
});

const upsertTokenSchema = z.object({
  value: z.unknown(),
  expires_at: z.string().datetime().nullable().default(null),
});

const providerCronTriggerSchema = z.object({
  idempotency_key: z.string().min(1),
});

const instagramPublishPreviewSchema = z.object({
  account_public_id: z.string().min(1).nullable().default(null),
  image_url: z.string().url(),
  caption: z.string().min(1).max(2200),
  idempotency_key: z.string().min(1),
});

function cronTriggerRequestId(providerKey: string, idempotencyKey: string) {
  return `cron_${providerKey}_${idempotencyKey.replace(/[^a-zA-Z0-9_-]+/g, "_").toLowerCase()}`;
}

function instagramPublishRequestId(idempotencyKey: string) {
  return `igpub_${idempotencyKey.replace(/[^a-zA-Z0-9_-]+/g, "_").toLowerCase()}`;
}

export function createIntegrationRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate, requireAdmin);

  routes.get("/providers", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const providers = await new IntegrationsRepository(db, context.get("encryptor")).listProviders();
    return context.json({ data: providers.map(serializeProvider) });
  });

  routes.get("/provider-catalog", (context) => context.json({ data: apiProviderCatalog }));

  routes.get("/accounts", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const accounts = await new IntegrationsRepository(db, context.get("encryptor")).listAccounts();
    return context.json({ data: accounts.map(serializeAccount) });
  });

  routes.get("/audit", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const repository = new AuditRepository(db);
    const input = {
      entityTypes: ["integration_accounts", "integration_settings", "integration_tokens"],
      entityId: context.req.query("entity_id") ?? null,
      limit: parseAuditLimit(context.req.query("limit")),
    };
    const [logs, totalCount] = await Promise.all([
      repository.list(input),
      repository.count({ entityTypes: input.entityTypes, entityId: input.entityId }),
    ]);
    return context.json({ data: logs.map(serializeAuditLog), summary: { total_count: totalCount } });
  });

  routes.get("/provider-attempts", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const attempts = await new IntegrationsRepository(db, context.get("encryptor")).listProviderAttempts({
      providerKey: context.req.query("provider_key") ?? null,
      accountPublicId: context.req.query("account_public_id") ?? null,
      limit: parseProviderAttemptLimit(context.req.query("limit")),
    });

    return context.json({ data: attempts.map(serializeProviderAttempt) });
  });

  routes.get("/provider-debug-summary", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const summary = await new IntegrationsRepository(db, context.get("encryptor")).getProviderDebugSummary();
    return context.json(serializeProviderDebugSummary(summary));
  });

  // NetGSM bakiye: tarayıcı NetGSM'e asla gitmez. Canlı provider kapısı kapalıyken
  // backend dry-run sınırı döner; canlı bakiye sorgusu worker/provider op ile açılacak.
  routes.get("/netgsm/balance", (context) => {
    const catalogItem = apiProviderCatalog.find((item) => item.provider === "netgsm");
    return context.json({
      provider: "netgsm",
      operation: "account.balance",
      balance: null,
      currency: "TRY",
      sms_credit: null,
      status: "dry_run",
      live_call_permitted: false,
      live_gate: catalogItem?.live_feature_flag_key ?? "providers.netgsm.live_mode",
      block_reason: catalogItem?.live_block_reason ?? "fixture_replay_contract_required",
      checked_at: new Date().toISOString(),
    });
  });

  routes.post("/provider-cron-triggers/:provider_key", async (context) => {
    const providerKey = context.req.param("provider_key");
    if (providerKey !== "ptt" && providerKey !== "surat") {
      return context.json({ error: { code: "unsupported_provider", message: "Cron debug trigger supports ptt and surat only" } }, 400);
    }

    const payload = providerCronTriggerSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid provider cron trigger payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    let attempt;
    try {
      attempt = await new IntegrationsRepository(db, context.get("encryptor")).createProviderCronTriggerAttempt({
        providerKey,
        idempotencyKey: payload.data.idempotency_key,
        requestId: cronTriggerRequestId(providerKey, payload.data.idempotency_key),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("idempotency key reuse mismatch")) {
        return context.json({ error: { code: "idempotency_conflict", message: "Provider cron trigger key was reused with different payload" } }, 409);
      }
      throw error;
    }

    return context.json(serializeProviderAttempt(attempt), 202);
  });

  routes.post("/instagram-publish-previews", async (context) => {
    const payload = instagramPublishPreviewSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid Instagram publish preview payload" } }, 400);
    }
    if (!isAllowedOutboundUserUrl(payload.data.image_url)) {
      return context.json({ error: { code: "invalid_request", message: "Instagram image URL is not allowed" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    let attempt;
    try {
      attempt = await new IntegrationsRepository(db, context.get("encryptor")).createInstagramPublishPreviewAttempt({
        accountPublicId: payload.data.account_public_id,
        imageUrl: payload.data.image_url,
        caption: payload.data.caption,
        idempotencyKey: payload.data.idempotency_key,
        requestId: instagramPublishRequestId(payload.data.idempotency_key),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("idempotency key reuse mismatch")) {
        return context.json({ error: { code: "idempotency_conflict", message: "Instagram publish key was reused with different payload" } }, 409);
      }
      throw error;
    }

    return context.json(serializeProviderAttempt(attempt), 202);
  });

  routes.get("/accounts/:account_public_id/analytics-summary", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const snapshot = await new IntegrationsRepository(db, context.get("encryptor")).getAccountSnapshot(
      context.req.param("account_public_id"),
    );
    if (!snapshot) {
      return context.json({ error: { code: "integration_account_not_found", message: "Integration account not found" } }, 404);
    }

    return context.json(instagramAnalyticsSummaryFromMetadata(snapshot.account.metadata));
  });

  routes.get("/accounts/:account_public_id", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const snapshot = await new IntegrationsRepository(db, context.get("encryptor")).getAccountSnapshot(
      context.req.param("account_public_id"),
    );
    if (!snapshot) {
      return context.json({ error: { code: "integration_account_not_found", message: "Integration account not found" } }, 404);
    }

    return context.json(serializeAccountSnapshot(snapshot));
  });

  routes.post("/accounts", async (context) => {
    const payload = upsertAccountSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid integration account payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const account = await new IntegrationsRepository(db, context.get("encryptor")).upsertAccount({
      providerKey: payload.data.provider_key,
      displayName: payload.data.display_name,
      externalAccountId: payload.data.external_account_id,
      metadata: payload.data.metadata,
      actorUserId: context.get("actorUserId"),
      ipAddress: context.req.header("x-forwarded-for") ?? null,
      userAgent: context.req.header("user-agent") ?? null,
    });

    return context.json(serializeAccount(account));
  });

  routes.put("/accounts/:account_public_id/settings/:key", async (context) => {
    const payload = upsertSettingSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid integration setting payload" } }, 400);
    }
    const validation = validateIntegrationSettingPayload(context.req.param("key"), payload.data.value);
    if (!validation.success) {
      return context.json({ error: { code: "invalid_setting", message: validation.message } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const setting = await new IntegrationsRepository(db, context.get("encryptor")).upsertSetting({
      accountPublicId: context.req.param("account_public_id"),
      key: validation.data.key,
      value: validation.data.value,
      isSecret: validation.data.is_secret,
      actorUserId: context.get("actorUserId"),
      ipAddress: context.req.header("x-forwarded-for") ?? null,
      userAgent: context.req.header("user-agent") ?? null,
    });
    await context.get("settingsChangePublisher").publishSettingsChanged({
      scope: `integration:${context.req.param("account_public_id")}`,
      key: setting.key,
      version: null,
      source: "integration_settings",
    });

    return context.json(serializeIntegrationSetting(setting));
  });

  routes.put("/accounts/:account_public_id/tokens/:token_type", async (context) => {
    const payload = upsertTokenSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid integration token payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const token = await new IntegrationsRepository(db, context.get("encryptor")).upsertToken({
      accountPublicId: context.req.param("account_public_id"),
      tokenType: context.req.param("token_type"),
      value: payload.data.value,
      expiresAt: payload.data.expires_at ? new Date(payload.data.expires_at) : null,
      actorUserId: context.get("actorUserId"),
      ipAddress: context.req.header("x-forwarded-for") ?? null,
      userAgent: context.req.header("user-agent") ?? null,
    });

    return context.json(serializeIntegrationToken(token));
  });

  return routes;
}

function validateIntegrationSettingPayload(key: string, value: unknown) {
  try {
    return { success: true as const, data: validateIntegrationSetting(key, value) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false as const, message: `Invalid value for integration setting key ${key}` };
    }
    return { success: false as const, message: error instanceof Error ? error.message : `Invalid integration setting key: ${key}` };
  }
}
