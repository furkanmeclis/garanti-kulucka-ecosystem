import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { AuditRepository, parseAuditLimit, serializeAuditLog } from "../audit/repository.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import { serializeSetting, SettingsRepository } from "../settings/repository.js";

const upsertSettingSchema = z.object({
  value: z.unknown(),
  scope: z.string().min(1).default("global"),
  is_secret: z.boolean().default(false),
});

export function createSettingsRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate, requireAdmin);

  routes.get("/", async (context) => {
    const scope = context.req.query("scope") ?? "global";
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const settings = await new SettingsRepository(db, context.get("encryptor")).list(scope);
    return context.json({ data: settings.map(serializeSetting) });
  });

  routes.get("/audit", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const logs = await new AuditRepository(db).list({
      entityTypes: ["settings"],
      entityId: context.req.query("entity_id") ?? null,
      limit: parseAuditLimit(context.req.query("limit")),
    });
    return context.json({ data: logs.map(serializeAuditLog) });
  });

  routes.put("/:key", async (context) => {
    const payload = upsertSettingSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid setting payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const setting = await new SettingsRepository(db, context.get("encryptor")).upsert({
      key: context.req.param("key"),
      scope: payload.data.scope,
      value: payload.data.value,
      isSecret: payload.data.is_secret,
      actorUserId: context.get("actorUserId"),
      ipAddress: context.req.header("x-forwarded-for") ?? null,
      userAgent: context.req.header("user-agent") ?? null,
    });

    return context.json(serializeSetting(setting));
  });

  return routes;
}
