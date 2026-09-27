import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import pino from "pino";
import { healthStatusSchema } from "@garanti-kulucka/shared";

const logger = pino({ name: "api" });

export function createApp() {
  const app = new Hono();

  app.use("*", async (context, next) => {
    const requestId = context.req.header("x-request-id") ?? randomUUID();
    context.header("x-request-id", requestId);
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

  app.get("/health/ready", (context) => {
    const payload = healthStatusSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    });

    return context.json(payload);
  });

  return app;
}

export type ApiApp = ReturnType<typeof createApp>;
