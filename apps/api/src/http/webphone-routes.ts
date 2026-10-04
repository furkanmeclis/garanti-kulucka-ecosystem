import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import { serializeProviderAttempt } from "../integrations/repository.js";
import { serializeWebphoneConfig, WebphoneConfigRepository } from "../webphone/config.js";

const testCallSchema = z.object({
  customer_name: z.string().min(1).default("Test Müşteri"),
  customer_phone: z.string().min(1),
  cargo_provider: z.string().min(1).default("PTT"),
  tracking_number: z.string().min(1).default("279172790012"),
  last_event_text: z.string().min(1).default("şubede bekliyor"),
  idempotency_key: z.string().min(1),
});

function requestIdFromIdempotencyKey(idempotencyKey: string) {
  return `vapitest_${idempotencyKey.replace(/[^a-zA-Z0-9_-]+/g, "_").toLowerCase()}`;
}

export function createWebphoneRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);

  routes.get("/config", async (context) => {
    const db = context.get("db");
    const auth = context.get("auth");
    if (!db || !auth) {
      return context.json({ error: { code: "unauthorized", message: "Valid session is required" } }, 401);
    }

    const repository = new WebphoneConfigRepository(db, context.get("encryptor"));
    const record = await repository.getForUser(auth.user_public_id);
    if (!record) {
      return context.json({ error: { code: "not_found", message: "Webphone user config was not found" } }, 404);
    }

    return context.json(serializeWebphoneConfig(record, (encryptedValue) => repository.decryptSipPassword(encryptedValue)));
  });

  routes.post("/test-call", requireAdmin, async (context) => {
    const payload = testCallSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid webphone test call payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    let attempt;
    try {
      attempt = await new WebphoneConfigRepository(db, context.get("encryptor")).createTestCallAttempt({
        customerName: payload.data.customer_name,
        customerPhone: payload.data.customer_phone,
        cargoProvider: payload.data.cargo_provider,
        trackingNumber: payload.data.tracking_number,
        lastEventText: payload.data.last_event_text,
        idempotencyKey: payload.data.idempotency_key,
        requestId: requestIdFromIdempotencyKey(payload.data.idempotency_key),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("idempotency key reuse mismatch")) {
        return context.json({ error: { code: "idempotency_conflict", message: "Webphone test call key was reused with different payload" } }, 409);
      }
      throw error;
    }

    return context.json(serializeProviderAttempt(attempt), 202);
  });

  return routes;
}
