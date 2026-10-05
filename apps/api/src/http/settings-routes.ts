import { Hono, type Context } from "hono";
import { z } from "zod";
import { validateGlobalSetting } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { AuditRepository, parseAuditLimit, serializeAuditLog } from "../audit/repository.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import { serializeSetting, serializeSettingVersion, SettingsRepository } from "../settings/repository.js";

const upsertSettingSchema = z.object({
  value: z.unknown(),
  scope: z.string().min(1).default("global"),
  is_secret: z.boolean().default(false),
});

const rollbackSettingSchema = z.object({
  version: z.number().int().positive(),
  scope: z.string().min(1).default("global"),
});

function invalidSettingResponse(context: Context<AppBindings>, message: string) {
  return context.json({ error: { code: "invalid_setting", message } }, 400);
}

export function createSettingsRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate, requireAdmin);

  routes.get("/", async (context) => {
    const scope = context.req.query("scope") ?? "global";
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const settings = await new SettingsRepository(db, context.get("encryptor"), context.get("settingsCache")).list(scope);
    return context.json({ data: settings.map(serializeSetting) });
  });

  routes.get("/audit", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const repository = new AuditRepository(db);
    const input = {
      entityTypes: ["settings"],
      entityId: context.req.query("entity_id") ?? null,
      limit: parseAuditLimit(context.req.query("limit")),
    };
    const [logs, totalCount] = await Promise.all([
      repository.list(input),
      repository.count({ entityTypes: input.entityTypes, entityId: input.entityId }),
    ]);
    return context.json({ data: logs.map(serializeAuditLog), summary: { total_count: totalCount } });
  });

  routes.get("/:key/versions", async (context) => {
    const scope = context.req.query("scope") ?? "global";
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const versions = await new SettingsRepository(db, context.get("encryptor"), context.get("settingsCache")).listVersions(
      scope,
      context.req.param("key"),
    );
    return context.json({ data: versions.map(serializeSettingVersion) });
  });

  routes.put("/:key", async (context) => {
    const payload = upsertSettingSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid setting payload" } }, 400);
    }

    const validation = validateSetting(context.req.param("key"), payload.data.value);
    if (!validation.success) {
      return invalidSettingResponse(context, validation.message);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const { setting, version } = await new SettingsRepository(db, context.get("encryptor"), context.get("settingsCache")).upsert({
      key: validation.data.key,
      scope: payload.data.scope,
      value: validation.data.value,
      isSecret: validation.data.is_secret,
      actorUserId: context.get("actorUserId"),
      ipAddress: context.req.header("x-forwarded-for") ?? null,
      userAgent: context.req.header("user-agent") ?? null,
    });

    await context.get("settingsChangePublisher").publishSettingsChanged({
      scope: setting.scope,
      key: setting.key,
      version,
      source: "settings",
    });

    return context.json(serializeSetting(setting));
  });

  routes.post("/:key/rollback", async (context) => {
    const payload = rollbackSettingSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid setting rollback payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    try {
      const { setting, version } = await new SettingsRepository(db, context.get("encryptor"), context.get("settingsCache")).rollback({
        key: context.req.param("key"),
        scope: payload.data.scope,
        version: payload.data.version,
        actorUserId: context.get("actorUserId"),
        ipAddress: context.req.header("x-forwarded-for") ?? null,
        userAgent: context.req.header("user-agent") ?? null,
      });

      await context.get("settingsChangePublisher").publishSettingsChanged({
        scope: setting.scope,
        key: setting.key,
        version,
        source: "settings",
      });

      return context.json(serializeSetting(setting));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unknown admin setting")) {
        return invalidSettingResponse(context, error.message);
      }
      if (error instanceof Error && error.message.startsWith("Secret settings cannot")) {
        return context.json({ error: { code: "secret_rollback_rejected", message: error.message } }, 400);
      }
      throw error;
    }
  });

  return routes;
}

function validateSetting(key: string, value: unknown) {
  try {
    return { success: true as const, data: validateGlobalSetting(key, value) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false as const, message: `Invalid value for admin setting key ${key}` };
    }
    return { success: false as const, message: error instanceof Error ? error.message : `Invalid admin setting key: ${key}` };
  }
}
