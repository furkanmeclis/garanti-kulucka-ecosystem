import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import pino from "pino";
import { healthStatusSchema } from "@garanti-kulucka/shared";
import type { AppDatabase } from "@garanti-kulucka/database";
import { loadConfig, type ApiConfig } from "./config.js";
import { createAuthRoutes } from "./http/auth-routes.js";
import { createDomainRoutes } from "./http/domain-routes.js";
import { createFileRoutes } from "./http/file-routes.js";
import { createIntegrationRoutes } from "./http/integration-routes.js";
import { createSettingsRoutes } from "./http/settings-routes.js";
import { createWebhookRoutes } from "./http/webhook-routes.js";
import { createWebphoneRoutes } from "./http/webphone-routes.js";
import type { AppBindings } from "./http/types.js";
import { createSecretEncryptor, type SecretEncryptor } from "./security/encryption.js";

const logger = pino({ name: "api" });

export interface CreateAppOptions {
  config?: ApiConfig;
  db?: AppDatabase | null;
  encryptor?: SecretEncryptor;
}

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const encryptor =
    options.encryptor ?? createSecretEncryptor(config.encryptionKey, config.encryptionKeyId);
  const app = new Hono<AppBindings>();

  if (config.corsOrigin) {
    app.use(
      "*",
      cors({
        origin: config.corsOrigin,
        credentials: true,
      }),
    );
  }

  app.use("*", async (context, next) => {
    const requestId = context.req.header("x-request-id") ?? randomUUID();
    context.header("x-request-id", requestId);
    context.set("config", config);
    context.set("db", options.db ?? null);
    context.set("encryptor", encryptor);
    context.set("auth", null);
    context.set("actorUserId", null);
    await next();
  });

  app.use("*", honoLogger());

  app.onError((error, context) => {
    logger.error({ err: error, path: context.req.path }, "Unhandled API error");
    return context.json(
      {
        error: {
          code: "internal_error",
          message: "Unexpected server error",
        },
      },
      500,
    );
  });

  app.get("/health/live", (context) => {
    const payload = healthStatusSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    });

    return context.json(payload);
  });

  app.get("/health/ready", async (context) => {
    const db = context.get("db");
    if (db) {
      await db.selectFrom("roles").select("id").limit(1).execute();
    }

    const payload = healthStatusSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    });

    return context.json(payload);
  });

  app.route("/auth", createAuthRoutes());
  app.route("/api", createDomainRoutes());
  app.route("/api/files", createFileRoutes());
  app.route("/api/webphone", createWebphoneRoutes());
  app.route("/webhooks", createWebhookRoutes());
  app.route("/admin/settings", createSettingsRoutes());
  app.route("/admin/integrations", createIntegrationRoutes());

  return app;
}

export type ApiApp = ReturnType<typeof createApp>;
