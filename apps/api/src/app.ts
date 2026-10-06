import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import pino from "pino";
import { createStructuredLog, healthStatusSchema, resolveMetricsExposure, type MetricsExposureConfig } from "@garanti-kulucka/shared";
import type { AppDatabase } from "@garanti-kulucka/database";
import { loadConfig, type ApiConfig } from "./config.js";
import { createAuthRoutes } from "./http/auth-routes.js";
import { createBalanceRoutes } from "./http/balance-routes.js";
import { createCommentRoutes } from "./http/comment-routes.js";
import { createDomainRoutes } from "./http/domain-routes.js";
import { createFileRoutes } from "./http/file-routes.js";
import { createIntegrationRoutes } from "./http/integration-routes.js";
import { createSmsRoutes } from "./http/sms-routes.js";
import { createSettingsRoutes } from "./http/settings-routes.js";
import { createShipmentCreateRoutes } from "./http/shipment-create-routes.js";
import { createAccountRoutes, createAdminUserRoutes, createAppSettingsRoutes } from "./http/admin-user-routes.js";
import { createWebhookRoutes } from "./http/webhook-routes.js";
import { createWebphoneRoutes } from "./http/webphone-routes.js";
import { createRateLimitStore, type RateLimitStore } from "./http/rate-limit.js";
import type { ApiLogger, AppBindings } from "./http/types.js";
import { getApiMetrics, httpMetricsMiddleware, metricsRouteHandler, type ApiMetrics } from "./observability/metrics.js";
import { noopRealtimePublisher, type RealtimePublisher } from "./realtime.js";
import { createSecretEncryptor, type SecretEncryptor } from "./security/encryption.js";
import type { SettingsCache } from "./settings/cache.js";
import { noopSettingsChangePublisher, type SettingsChangePublisher } from "./settings/change-bus.js";
import {
  noopProviderDeliveryQueuePublisher,
  type ProviderDeliveryQueuePublisher,
  type WebhookQueuePublisher,
} from "./webhooks/queue-publisher.js";

const logger = pino({ name: "api" });

export interface CreateAppOptions {
  config?: ApiConfig;
  db?: AppDatabase | null;
  encryptor?: SecretEncryptor;
  webhookQueuePublisher?: WebhookQueuePublisher;
  providerDeliveryQueuePublisher?: ProviderDeliveryQueuePublisher;
  realtimePublisher?: RealtimePublisher;
  settingsCache?: SettingsCache | null;
  settingsChangePublisher?: SettingsChangePublisher;
  rateLimitStore?: RateLimitStore;
  logger?: ApiLogger;
  metrics?: ApiMetrics;
  metricsExposure?: MetricsExposureConfig;
}

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const appLogger = options.logger ?? logger;
  const encryptor =
    options.encryptor ?? createSecretEncryptor(config.encryptionKey, config.encryptionKeyId);
  const rateLimitStore = options.rateLimitStore ?? createRateLimitStore(config);
  const metrics = options.metrics ?? getApiMetrics();
  const metricsExposure = options.metricsExposure ?? resolveMetricsExposure(process.env);
  const app = new Hono<AppBindings>();

  app.use("*", httpMetricsMiddleware(metrics));

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
    context.set("requestId", requestId);
    context.set("logger", appLogger);
    context.set("realtimePublisher", options.realtimePublisher ?? noopRealtimePublisher);
    context.set("providerDeliveryQueuePublisher", options.providerDeliveryQueuePublisher ?? noopProviderDeliveryQueuePublisher);
    context.set("settingsCache", options.settingsCache ?? null);
    context.set("settingsChangePublisher", options.settingsChangePublisher ?? noopSettingsChangePublisher);
    context.set("rateLimitStore", rateLimitStore);
    await next();
  });

  app.use("*", honoLogger());

  app.onError((error, context) => {
    appLogger.error(
      createStructuredLog({
        level: "error",
        service: "api",
        event: "api.unhandled_error",
        request_id: context.get("requestId"),
        msg: "Unhandled API error",
        context: { err: error, path: context.req.path },
      }),
      "Unhandled API error",
    );
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
    const startedAt = performance.now();
    const dependencies: Record<string, { status: "ok" | "degraded"; latency_ms?: number; error?: string }> = {};

    if (!db) {
      dependencies.database = {
        status: "degraded",
        error: "not_configured",
      };
    } else {
      try {
        await db.selectFrom("roles").select("id").limit(1).execute();
        dependencies.database = {
          status: "ok",
          latency_ms: Math.round(performance.now() - startedAt),
        };
      } catch (error) {
        dependencies.database = {
          status: "degraded",
          latency_ms: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : "unknown_error",
        };
      }
    }

    const status = Object.values(dependencies).some((dependency) => dependency.status === "degraded") ? "degraded" : "ok";

    const payload = healthStatusSchema.parse({
      status,
      service: "api",
      timestamp: new Date().toISOString(),
      dependencies,
    });

    return context.json(payload, status === "ok" ? 200 : 503);
  });

  app.get("/metrics", metricsRouteHandler(metrics, metricsExposure));

  app.route("/auth", createAuthRoutes());
  app.route("/auth/account", createAccountRoutes());
  app.route("/api", createDomainRoutes());
  app.route("/api", createShipmentCreateRoutes());
  app.route("/api/comments", createCommentRoutes());
  app.route("/api/sms", createSmsRoutes());
  app.route("/api/balances", createBalanceRoutes());
  app.route("/api/files", createFileRoutes());
  app.route("/api/webphone", createWebphoneRoutes());
  app.route("/api/app-settings", createAppSettingsRoutes());
  app.route(
    "/webhooks",
    createWebhookRoutes(
      options.webhookQueuePublisher
        ? { queuePublisher: options.webhookQueuePublisher }
        : {},
    ),
  );
  app.route("/admin/settings", createSettingsRoutes());
  app.route("/admin/integrations", createIntegrationRoutes());
  app.route("/admin", createAdminUserRoutes());

  return app;
}

export type ApiApp = ReturnType<typeof createApp>;
