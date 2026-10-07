import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { AccountingRepository } from "../accounting/repository.js";

/**
 * Legacy GET /api/kolaybi/urunler (StokPage "KolayBi ürünü eşleştir" listesi). The API never calls KolayBi:
 * `POST /refresh` queues `kolaybi.product.list` and the worker stores a live result as
 * `integration_accounts.metadata.kolaybi_products`, which `GET /` serves.
 */

const liveGate = "providers.kolaybi.live_mode";

function canManageInventory(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createKolaybiProductRoutes() {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireDatabase, authenticate);
  routes.use("*", async (context, next) => {
    if (!canManageInventory(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Inventory management is not allowed" } }, 403);
    }
    await next();
  });

  routes.get("/", async (context) => {
    const readiness = await new AccountingRepository(context.get("db")!).kolaybiReadiness(liveGate);
    let snapshot: Record<string, unknown> | null = null;
    if (readiness.account) {
      const row = await context
        .get("db")!
        .selectFrom("integration_accounts")
        .select("metadata")
        .where("public_id", "=", readiness.account.public_id)
        .executeTakeFirst();
      const metadata = isRecord(row?.metadata) ? row.metadata : {};
      snapshot = isRecord(metadata.kolaybi_products) ? metadata.kolaybi_products : null;
    }
    const products = Array.isArray(snapshot?.products) ? snapshot.products : [];
    return context.json({
      products,
      total: products.length,
      synced_at: typeof snapshot?.synced_at === "string" ? snapshot.synced_at : null,
      account_configured: Boolean(readiness.account),
      live_call_permitted: readiness.live_call_permitted,
      live_gate: liveGate,
    });
  });

  routes.post("/refresh", async (context) => {
    const readiness = await new AccountingRepository(context.get("db")!).kolaybiReadiness(liveGate);
    const occurredAt = new Date().toISOString();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const requestId = `req_kolaybi_products_${suffix}`;
    const job = jobEnvelopeSchema.parse({
      job_id: `job_kolaybi_products_${suffix}`,
      queue: "provider-delivery",
      name: "kolaybi.product.list",
      payload: providerDeliveryJobPayloadSchema.parse({
        envelope: {
          request_id: requestId,
          provider: "kolaybi",
          operation: "product.list",
          direction: "outbound",
          channel: "accounting",
          ...(readiness.account ? { account_public_id: readiness.account.public_id } : {}),
          occurred_at: occurredAt,
          payload: { per_page: 200, max_pages: 20 },
          legacy_contract: { source: "server.js GET /api/kolaybi/urunler", legacy_event: "kolaybi_products_list" },
        },
      }),
      requested_at: occurredAt,
      request_id: context.get("requestId"),
    });
    const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
    return context.json({ request_id: requestId, job_id: jobId, queued: jobId !== null, live_call_permitted: readiness.live_call_permitted, live_gate: liveGate }, 202);
  });

  return routes;
}
