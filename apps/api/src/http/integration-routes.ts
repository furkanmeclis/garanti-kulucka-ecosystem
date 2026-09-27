import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import {
  IntegrationsRepository,
  serializeAccount,
  serializeAccountSnapshot,
  serializeIntegrationSetting,
  serializeIntegrationToken,
  serializeProvider,
} from "../integrations/repository.js";

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

  routes.get("/accounts", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const accounts = await new IntegrationsRepository(db, context.get("encryptor")).listAccounts();
    return context.json({ data: accounts.map(serializeAccount) });
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

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const setting = await new IntegrationsRepository(db, context.get("encryptor")).upsertSetting({
      accountPublicId: context.req.param("account_public_id"),
      key: context.req.param("key"),
      value: payload.data.value,
      isSecret: payload.data.is_secret,
      actorUserId: context.get("actorUserId"),
      ipAddress: context.req.header("x-forwarded-for") ?? null,
      userAgent: context.req.header("user-agent") ?? null,
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
