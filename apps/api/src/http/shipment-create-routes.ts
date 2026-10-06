import { Hono, type Context } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { DomainRepository, serializeShipment } from "../domain/repository.js";
import {
  MissingRecipientFieldError,
  ShipmentAlreadyExistsError,
  ShipmentCreateRepository,
  ShipmentOrderNotFoundError,
  calculateShipmentMeasurements,
  missingRecipientField,
  type CargoProviderKey,
  type CreatedShipment,
  type ShipmentPaymentStatus,
  type ShipmentPrintData,
} from "../shipments/repository.js";

/**
 * Legacy kargo create flows (frontend KargolarPage `_kargoOlusturInternal`, `topluKargoAktar`, kargo onay
 * modal; server.js `/api/ptt/gonderi/olustur` kabulEkle2 and Sürat `OrtakBarkodOlustur`) reproduced as
 * backend-owned routes. The canonical shipment row is written here with status `pending`; the provider
 * call is queued on `provider-delivery` (`<provider>.shipment.create`) and the worker keeps live calls gated
 * by `providers.<provider>.live_mode` + account opt-in. Print routes feed the barkodlu fatura print view.
 */

const idempotencyKeySchema = z.string().trim().min(1).max(160);
const providerSchema = z.enum(["ptt", "surat"]);
const paymentStatusSchema = z.enum(["karsi_odemeli", "odeme_alindi"]);

const createShipmentSchema = z.object({
  provider: providerSchema,
  payment_status: paymentStatusSchema.default("karsi_odemeli"),
  idempotency_key: idempotencyKeySchema,
  recipient_address: z.string().trim().max(1000).optional(),
  recipient_city: z.string().trim().max(120).optional(),
  recipient_district: z.string().trim().max(120).optional(),
});

const bulkCreateSchema = z.object({
  provider: providerSchema,
  order_public_ids: z.array(z.string().trim().min(1)).min(1).max(200),
  idempotency_key: idempotencyKeySchema,
});

const markPrintedSchema = z.object({
  idempotency_key: idempotencyKeySchema.optional(),
});

function canCreateShipments(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan" || role === "kargo_operatoru";
}

function safeKey(value: string, length = 96) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, length);
}

export const cargoProviderLabels: Record<CargoProviderKey, string> = {
  ptt: "PTT Kargo",
  surat: "Sürat Kargo",
};

async function readJson(context: Context<AppBindings>) {
  try {
    return (await context.req.json()) as unknown;
  } catch {
    return null;
  }
}

function dbUnavailable(context: Context<AppBindings>) {
  return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
}

/** Provider payload keys follow the worker adapters (ptt.ts createXmlBody, surat.ts shipmentPayload). */
export function buildShipmentCreatePayload(created: CreatedShipment, provider: CargoProviderKey, paymentStatus: ShipmentPaymentStatus) {
  const amount = created.draft.total_amount;
  const cashOnDelivery = paymentStatus === "karsi_odemeli";
  const base = {
    shipment_public_id: created.shipment_public_id,
    order_public_id: created.draft.order_public_id,
    order_number: created.draft.order_number,
    notlar: amount ? `Sipariş Tutarı: ${amount} TL` : "",
  };
  if (provider === "ptt") {
    return {
      ...base,
      barkodNo: created.barcode_number ?? "",
      musteriReferansNo: `REF-${created.draft.order_number}`,
      aliciAdi: created.recipient.name,
      aliciTelefon: created.recipient.phone,
      aliciAdres: created.recipient.address,
      aliciIl: created.recipient.city,
      aliciIlce: created.recipient.district,
      agirlik: created.measurements.weight_kg,
      desi: created.measurements.desi,
      odemeTipi: cashOnDelivery ? "alici" : "gonderici",
      kapidaOdeme: cashOnDelivery,
      kapidaOdemeTutar: cashOnDelivery ? amount : "",
      ucretAlicidan: cashOnDelivery,
    };
  }
  return {
    ...base,
    aliciAd: created.recipient.name,
    aliciTelefon: created.recipient.phone,
    aliciAdres: created.recipient.address,
    aliciIl: created.recipient.city,
    aliciIlce: created.recipient.district,
    kg: created.measurements.weight_kg,
    desi: created.measurements.desi,
    kargoTuru: 3,
    odemeTipi: 1,
    referansNo: created.draft.order_number,
    kapidaOdemeTutari: cashOnDelivery ? Number(amount) : 0,
    kapidaOdemeTahsilatTipi: cashOnDelivery ? 1 : 0,
  };
}

async function queueShipmentCreate(
  context: Context<AppBindings>,
  created: CreatedShipment,
  provider: CargoProviderKey,
  paymentStatus: ShipmentPaymentStatus,
  idempotencyKey: string,
) {
  const occurredAt = new Date().toISOString();
  const requestId = `req_${provider}_create_${safeKey(idempotencyKey)}`;
  const providerPayload = providerDeliveryJobPayloadSchema.parse({
    envelope: {
      request_id: requestId,
      provider,
      operation: "shipment.create",
      direction: "outbound",
      channel: "cargo",
      occurred_at: occurredAt,
      payload: { ...buildShipmentCreatePayload(created, provider, paymentStatus), idempotency_key: idempotencyKey },
      legacy_contract: {
        source: "legacy-kargo-olustur",
        legacy_event: provider === "ptt" ? "kabulEkle2" : "OrtakBarkodOlustur",
      },
    },
  });
  const job = jobEnvelopeSchema.parse({
    job_id: `job_shipment_create_${safeKey(idempotencyKey, 80)}`,
    queue: "provider-delivery",
    name: `${provider}.shipment.create`,
    payload: providerPayload,
    requested_at: occurredAt,
    request_id: context.get("requestId"),
  });
  const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
  return { requestId, jobId };
}

function broadcastShipment(context: Context<AppBindings>, shipmentPublicId: string, status: string, trackingNumber: string | null) {
  context.get("realtimePublisher").broadcast({
    event: "shipment.updated",
    id: `shipment_${shipmentPublicId}_${Date.now()}`,
    occurred_at: new Date().toISOString(),
    payload: { shipment_public_id: shipmentPublicId, status, tracking_number: trackingNumber },
  });
}

type CreateOutcome =
  | { ok: true; status: 200 | 201; body: Record<string, unknown> }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string; shipment_public_id?: string };

async function createOne(
  context: Context<AppBindings>,
  repo: ShipmentCreateRepository,
  input: {
    orderPublicId: string;
    provider: CargoProviderKey;
    paymentStatus: ShipmentPaymentStatus;
    idempotencyKey: string;
    overrides: { address?: string | undefined; city?: string | undefined; district?: string | undefined };
  },
): Promise<CreateOutcome> {
  let created: CreatedShipment;
  try {
    created = await repo.createShipment({
      orderPublicId: input.orderPublicId,
      provider: input.provider,
      paymentStatus: input.paymentStatus,
      idempotencyKey: input.idempotencyKey,
      actorUserId: context.get("actorUserId") ?? null,
      recipientOverrides: input.overrides,
    });
  } catch (error) {
    if (error instanceof ShipmentOrderNotFoundError) return { ok: false, status: 404, code: "not_found", message: "Sipariş bulunamadı" };
    if (error instanceof ShipmentAlreadyExistsError) {
      return { ok: false, status: 409, code: "shipment_already_exists", message: error.message, shipment_public_id: error.shipmentPublicId };
    }
    if (error instanceof MissingRecipientFieldError) return { ok: false, status: 422, code: "missing_recipient_field", message: error.message };
    throw error;
  }

  const queued = created.replayed
    ? { requestId: `req_${input.provider}_create_${safeKey(input.idempotencyKey)}`, jobId: null }
    : await queueShipmentCreate(context, created, input.provider, input.paymentStatus, input.idempotencyKey);
  const shipment = await new DomainRepository(context.get("db")!).getShipmentByPublicId(created.shipment_public_id);
  if (!created.replayed && shipment) broadcastShipment(context, shipment.public_id, shipment.status, shipment.tracking_number);

  return {
    ok: true,
    status: created.replayed ? 200 : 201,
    body: {
      provider: input.provider,
      operation: "shipment.create",
      request_id: queued.requestId,
      job_id: queued.jobId,
      queued: queued.jobId !== null,
      replayed: created.replayed,
      live_call_permitted: false,
      live_gate: `providers.${input.provider}.live_mode`,
      order_public_id: created.draft.order_public_id,
      order_number: created.draft.order_number,
      barcode_number: created.barcode_number,
      barcode_range: created.barcode_range,
      barcode_pool_exhausted: created.barcode_pool_exhausted,
      weight_kg: created.measurements.weight_kg,
      desi: created.measurements.desi,
      payment_status: input.paymentStatus,
      message: `${cargoProviderLabels[input.provider]} barkod oluşturuldu!${created.barcode_number ? ` Takip: ${created.barcode_number}` : ""}`,
      shipment: shipment ? serializeShipment(shipment) : null,
    },
  };
}

export function serializeShipmentPrint(data: ShipmentPrintData) {
  const provider = data.provider.toLocaleLowerCase("tr-TR");
  const providerLabel = provider.includes("sürat") || provider.includes("surat") ? "Sürat Kargo" : provider.includes("ptt") ? "PTT Kargo" : data.provider || "Kargo";
  return {
    shipment_public_id: data.shipment_public_id,
    provider: data.provider,
    provider_label: providerLabel,
    status: data.status,
    tracking_number: data.tracking_number,
    barcode_number: data.barcode_number,
    barcode_value: data.barcode_value,
    barcode_format: "CODE128",
    payment_type: data.payment_type,
    label_printed_at: data.label_printed_at,
    invoice_title: `Sipariş: ${data.order_number ?? data.shipment_public_id}`,
    recipient: {
      name: data.recipient_name,
      phone: data.recipient_phone,
      address: data.recipient_address,
      city: data.recipient_city,
      district: data.recipient_district,
    },
    order: data.order_public_id
      ? {
          public_id: data.order_public_id,
          order_number: data.order_number,
          total_amount: data.order_total_amount,
          currency: data.order_currency,
          created_at: data.order_created_at,
        }
      : null,
    items: data.items,
    created_at: data.created_at,
  };
}

export function createShipmentCreateRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("/orders/:order_public_id/shipment-draft", requireDatabase, authenticate);
  routes.use("/orders/:order_public_id/shipments", requireDatabase, authenticate);
  routes.use("/shipments/bulk-create", requireDatabase, authenticate);
  routes.use("/shipments/:shipment_public_id/print", requireDatabase, authenticate);
  routes.use("/shipments/:shipment_public_id/printed", requireDatabase, authenticate);

  routes.get("/orders/:order_public_id/shipment-draft", async (context) => {
    if (!canCreateShipments(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment create access is not allowed" } }, 403);
    }
    const db = context.get("db");
    if (!db) return dbUnavailable(context);
    const draft = await new ShipmentCreateRepository(db).getDraft(context.req.param("order_public_id"));
    if (!draft) return context.json({ error: { code: "not_found", message: "Sipariş bulunamadı" } }, 404);
    return context.json({
      order_public_id: draft.order_public_id,
      order_number: draft.order_number,
      order_status: draft.order_status,
      total_amount: draft.total_amount,
      currency: draft.currency,
      cargo_provider: draft.cargo_provider,
      recipient: {
        name: draft.recipient_name,
        phone: draft.recipient_phone,
        address: draft.recipient_address,
        city: draft.recipient_city,
        district: draft.recipient_district,
      },
      items: draft.items,
      missing_field: missingRecipientField({ ...draft, order_number: draft.order_number }),
      measurements: {
        ptt: calculateShipmentMeasurements(draft.items, "ptt"),
        surat: calculateShipmentMeasurements(draft.items, "surat"),
      },
      existing_shipment: draft.existing_shipment,
    });
  });

  routes.post("/orders/:order_public_id/shipments", async (context) => {
    if (!canCreateShipments(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment create access is not allowed" } }, 403);
    }
    const payload = createShipmentSchema.safeParse(await readJson(context));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid shipment create payload" } }, 400);
    }
    const db = context.get("db");
    if (!db) return dbUnavailable(context);

    const outcome = await createOne(context, new ShipmentCreateRepository(db), {
      orderPublicId: context.req.param("order_public_id"),
      provider: payload.data.provider,
      paymentStatus: payload.data.payment_status,
      idempotencyKey: payload.data.idempotency_key,
      overrides: {
        address: payload.data.recipient_address,
        city: payload.data.recipient_city,
        district: payload.data.recipient_district,
      },
    });
    if (!outcome.ok) {
      return context.json(
        { error: { code: outcome.code, message: outcome.message, ...(outcome.shipment_public_id ? { shipment_public_id: outcome.shipment_public_id } : {}) } },
        outcome.status,
      );
    }
    return context.json(outcome.body, outcome.status);
  });

  // Legacy `topluKargoAktar`: orders that already have a shipment are skipped, an order with missing address
  // fields fails the whole request before anything is created ("N siparişte adres bilgisi eksik"), the rest are
  // created one by one with `karsi_odemeli`.
  routes.post("/shipments/bulk-create", async (context) => {
    if (!canCreateShipments(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment create access is not allowed" } }, 403);
    }
    const payload = bulkCreateSchema.safeParse(await readJson(context));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid bulk shipment payload" } }, 400);
    }
    const db = context.get("db");
    if (!db) return dbUnavailable(context);
    const repo = new ShipmentCreateRepository(db);
    const provider = payload.data.provider;
    const orderIds = [...new Set(payload.data.order_public_ids)];

    const drafts = await Promise.all(orderIds.map(async (id) => ({ id, draft: await repo.getDraft(id) })));
    const pending = drafts.filter((entry) => entry.draft && !entry.draft.existing_shipment);
    const skipped = drafts.filter((entry) => !entry.draft || entry.draft.existing_shipment);
    if (pending.length === 0) {
      return context.json(
        { error: { code: "nothing_to_create", message: "Seçili siparişler arasında kargoya aktarılacak sipariş yok (hepsinde takip no var)" } },
        409,
      );
    }
    const missing = pending.filter((entry) => entry.draft && missingRecipientField(entry.draft));
    if (missing.length > 0) {
      return context.json(
        {
          error: {
            code: "missing_recipient_field",
            message: `${missing.length} siparişte adres bilgisi eksik. Önce adres bilgilerini tamamlayın.`,
            order_public_ids: missing.map((entry) => entry.id),
          },
        },
        422,
      );
    }

    const results: Array<Record<string, unknown>> = skipped.map((entry) => ({
      order_public_id: entry.id,
      status: "skipped",
      reason: entry.draft ? "shipment_already_exists" : "not_found",
      shipment: null,
    }));
    let created = 0;
    let failed = 0;
    for (const entry of pending) {
      try {
        const outcome = await createOne(context, repo, {
          orderPublicId: entry.id,
          provider,
          paymentStatus: "karsi_odemeli",
          idempotencyKey: `${payload.data.idempotency_key}:${entry.id}`,
          overrides: {},
        });
        if (outcome.ok) {
          created += 1;
          results.push({ order_public_id: entry.id, status: "created", reason: null, ...outcome.body });
        } else {
          failed += 1;
          results.push({ order_public_id: entry.id, status: "failed", reason: outcome.code, message: outcome.message, shipment: null });
        }
      } catch (error) {
        failed += 1;
        results.push({ order_public_id: entry.id, status: "failed", reason: "internal_error", message: error instanceof Error ? error.message : "Bilinmeyen hata", shipment: null });
      }
    }

    const label = cargoProviderLabels[provider];
    return context.json({
      provider,
      created_count: created,
      skipped_count: skipped.length,
      failed_count: failed,
      message: created > 0 ? `${created} sipariş ${label}'ya aktarıldı!${failed > 0 ? ` (${failed} hata)` : ""}` : "Hiçbir sipariş aktarılamadı",
      results,
    });
  });

  routes.get("/shipments/:shipment_public_id/print", async (context) => {
    if (!canCreateShipments(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment print access is not allowed" } }, 403);
    }
    const db = context.get("db");
    if (!db) return dbUnavailable(context);
    const data = await new ShipmentCreateRepository(db).getPrintData(context.req.param("shipment_public_id"));
    if (!data) return context.json({ error: { code: "not_found", message: "Shipment was not found" } }, 404);
    return context.json(serializeShipmentPrint(data));
  });

  routes.post("/shipments/:shipment_public_id/printed", async (context) => {
    if (!canCreateShipments(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment print access is not allowed" } }, 403);
    }
    const payload = markPrintedSchema.safeParse((await readJson(context)) ?? {});
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid shipment printed payload" } }, 400);
    }
    const db = context.get("db");
    if (!db) return dbUnavailable(context);
    const shipmentPublicId = context.req.param("shipment_public_id");
    const result = await new ShipmentCreateRepository(db).markPrinted(shipmentPublicId);
    if (!result) return context.json({ error: { code: "not_found", message: "Shipment was not found" } }, 404);
    return context.json({ shipment_public_id: shipmentPublicId, label_printed_at: result.label_printed_at });
  });

  return routes;
}
