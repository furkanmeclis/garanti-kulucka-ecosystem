import type { AppDatabase, VapiCallQueueTable, VapiCallsTable } from "@garanti-kulucka/database";
import { sql, type Selectable } from "kysely";
import { newPublicId } from "../auth/crypto.js";
import {
  callSnapshotPatch,
  isCargoNotReceived,
  vapiWebhookCallId,
  vapiWebhookMessage,
  vapiWebhookPatch,
  vapiWebhookType,
  type VapiCallPatch,
} from "./vapi-rules.js";

export type VapiQueueRecord = Selectable<VapiCallQueueTable> & { shipment_public_id: string | null };
export type VapiCallRecord = Selectable<VapiCallsTable> & { shipment_public_id: string | null };

export interface CargoNotReceivedRow {
  shipment_public_id: string;
  tracking_number: string | null;
  recipient_phone: string;
  recipient_name: string;
  provider: string;
  last_event_text: string;
  last_event_at: Date | null;
  status: string;
  created_at: Date;
  queued: boolean;
  queue_status: string | null;
  attempt_count: number;
  called_last_24h: boolean;
}

export interface QueueAddItem {
  shipment_public_id?: string | undefined;
  customer_phone: string;
  customer_name?: string | undefined;
  cargo_provider?: string | undefined;
  tracking_number?: string | undefined;
  last_event_text?: string | undefined;
}

export interface CreateCallInput {
  queueId: number | null;
  shipmentId: number | null;
  customerPhone: string;
  customerName: string | null;
  cargoProvider: string | null;
  trackingNumber: string | null;
  lastEventText: string | null;
  isTest: boolean;
  idempotencyKey: string;
  requestId: string;
  actorUserId: number | null;
}

const openCallStatuses = ["basladi", "cevaplandi"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export class VapiRepository {
  constructor(private readonly db: AppDatabase) {}

  async providerReadiness(): Promise<{ account_configured: boolean }> {
    const row = await this.db
      .selectFrom("integration_accounts")
      .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("integration_providers.key", "=", "vapi")
      .where("integration_accounts.status", "=", "active")
      .executeTakeFirst();
    return { account_configured: Number(row?.count ?? 0) > 0 };
  }

  async listCargoNotReceived(input: { provider: "ptt" | "surat" | null; limit: number; offset: number; now: Date }) {
    const staleDate = new Date(input.now.getTime() - 30 * 24 * 60 * 60 * 1000);
    let query = this.db
      .selectFrom("shipments")
      .select([
        "shipments.id",
        "shipments.public_id",
        "shipments.tracking_number",
        "shipments.barcode_number",
        "shipments.recipient_phone",
        "shipments.recipient_name",
        "shipments.provider",
        "shipments.last_event_text",
        "shipments.status",
        "shipments.created_at",
        "shipments.updated_at",
        (eb) =>
          eb
            .selectFrom("shipment_tracking_events")
            .select((inner) => inner.fn.max("shipment_tracking_events.occurred_at").as("occurred_at"))
            .whereRef("shipment_tracking_events.shipment_id", "=", "shipments.id")
            .as("last_event_at"),
      ])
      .where("shipments.status", "not in", ["delivered", "returned", "cancelled"])
      .where("shipments.created_at", ">=", staleDate)
      .where("shipments.last_event_text", "is not", null)
      .where("shipments.recipient_phone", "is not", null);
    if (input.provider) query = query.where("shipments.provider", "=", input.provider);
    const rows = await query.orderBy("shipments.updated_at", "desc").limit(2000).execute();
    const matching = rows.filter((row) => row.recipient_phone && isCargoNotReceived(row.last_event_text));
    const ids = matching.map((row) => row.id);
    const queueMap = new Map<number, { status: string; attempt_count: number }>();
    const calledSet = new Set<number>();
    if (ids.length > 0) {
      const queueRows = await this.db
        .selectFrom("vapi_call_queue")
        .select(["shipment_id", "status", "attempt_count"])
        .where("shipment_id", "in", ids)
        .where("status", "in", ["bekliyor", "araniyor"])
        .execute();
      for (const row of queueRows) if (row.shipment_id !== null) queueMap.set(row.shipment_id, row);
      const since = new Date(input.now.getTime() - 24 * 60 * 60 * 1000);
      const callRows = await this.db
        .selectFrom("vapi_calls")
        .select(["shipment_id"])
        .where("shipment_id", "in", ids)
        .where("started_at", ">=", since)
        .execute();
      for (const row of callRows) if (row.shipment_id !== null) calledSet.add(row.shipment_id);
    }
    const all: CargoNotReceivedRow[] = matching.map((row) => {
      const queued = queueMap.get(row.id);
      const lastEventAt = row.last_event_at as Date | string | null;
      return {
        shipment_public_id: row.public_id,
        tracking_number: row.tracking_number ?? row.barcode_number,
        recipient_phone: row.recipient_phone ?? "",
        recipient_name: row.recipient_name,
        provider: row.provider,
        last_event_text: row.last_event_text ?? "",
        last_event_at: lastEventAt ? new Date(lastEventAt) : row.updated_at,
        status: row.status,
        created_at: row.created_at,
        queued: Boolean(queued),
        queue_status: queued?.status ?? null,
        attempt_count: queued?.attempt_count ?? 0,
        called_last_24h: calledSet.has(row.id),
      };
    });
    return { rows: all.slice(input.offset, input.offset + input.limit), total: all.length };
  }

  /** Legacy kuyruga-ekle: inserts `bekliyor` rows; an open row for the same shipment+phone is skipped (atlanan). */
  async addToQueue(input: { items: QueueAddItem[]; maxAttempts: number; idempotencyKey: string; actorUserId: number | null }) {
    return this.db.transaction().execute(async (trx) => {
      let added = 0;
      let skipped = 0;
      let replayed = 0;
      for (const [index, item] of input.items.entries()) {
        const key = `${input.idempotencyKey}#${item.shipment_public_id ?? index}`;
        const existingKey = await trx.selectFrom("vapi_call_queue").select("id").where("idempotency_key", "=", key).executeTakeFirst();
        if (existingKey) {
          replayed += 1;
          added += 1;
          continue;
        }
        const shipment = item.shipment_public_id
          ? await trx.selectFrom("shipments").select("id").where("public_id", "=", item.shipment_public_id).executeTakeFirst()
          : undefined;
        const shipmentId = shipment?.id ?? null;
        if (shipmentId !== null) {
          const open = await trx
            .selectFrom("vapi_call_queue")
            .select("id")
            .where("shipment_id", "=", shipmentId)
            .where("customer_phone", "=", item.customer_phone)
            .where("status", "in", ["bekliyor", "araniyor"])
            .executeTakeFirst();
          if (open) {
            skipped += 1;
            continue;
          }
        }
        await trx
          .insertInto("vapi_call_queue")
          .values({
            public_id: newPublicId("vcq"),
            shipment_id: shipmentId,
            customer_phone: item.customer_phone,
            customer_name: item.customer_name ?? null,
            cargo_provider: item.cargo_provider ?? null,
            tracking_number: item.tracking_number ?? null,
            last_event_text: item.last_event_text ?? null,
            status: "bekliyor",
            priority: 0,
            attempt_count: 0,
            max_attempts: input.maxAttempts,
            last_called_at: null,
            idempotency_key: key,
            actor_user_id: input.actorUserId,
          })
          .execute();
        added += 1;
      }
      return { added, skipped, replayed };
    });
  }

  private queueQuery() {
    return this.db
      .selectFrom("vapi_call_queue")
      .leftJoin("shipments", "shipments.id", "vapi_call_queue.shipment_id")
      .selectAll("vapi_call_queue")
      .select("shipments.public_id as shipment_public_id");
  }

  async listQueue(input: { status: string | null; limit: number; offset: number }) {
    let rows = this.queueQuery();
    let count = this.db.selectFrom("vapi_call_queue").select((eb) => eb.fn.countAll<string>().as("count"));
    if (input.status) {
      rows = rows.where("vapi_call_queue.status", "=", input.status);
      count = count.where("status", "=", input.status);
    }
    const [data, total] = await Promise.all([
      rows
        .orderBy("vapi_call_queue.priority", "desc")
        .orderBy("vapi_call_queue.created_at", "asc")
        .limit(input.limit)
        .offset(input.offset)
        .execute(),
      count.executeTakeFirst(),
    ]);
    return { rows: data as VapiQueueRecord[], total: Number(total?.count ?? 0) };
  }

  async listWaitingQueue(limit: number) {
    return (await this.queueQuery()
      .where("vapi_call_queue.status", "=", "bekliyor")
      .orderBy("vapi_call_queue.priority", "desc")
      .orderBy("vapi_call_queue.created_at", "asc")
      .limit(limit)
      .execute()) as VapiQueueRecord[];
  }

  async getQueueItem(publicId: string) {
    return ((await this.queueQuery().where("vapi_call_queue.public_id", "=", publicId).executeTakeFirst()) ?? null) as VapiQueueRecord | null;
  }

  async deleteQueueItem(publicId: string): Promise<boolean> {
    const result = await this.db.deleteFrom("vapi_call_queue").where("public_id", "=", publicId).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async setQueueStatus(queueId: number, status: string) {
    await this.db.updateTable("vapi_call_queue").set({ status, updated_at: new Date() }).where("id", "=", queueId).execute();
  }

  async markQueueCalling(queueId: number, now: Date) {
    await this.db
      .updateTable("vapi_call_queue")
      .set((eb) => ({ status: "araniyor", attempt_count: eb("attempt_count", "+", 1), last_called_at: now, updated_at: now }))
      .where("id", "=", queueId)
      .execute();
  }

  async findShipmentId(shipmentPublicId: string | undefined): Promise<number | null> {
    if (!shipmentPublicId) return null;
    const row = await this.db.selectFrom("shipments").select("id").where("public_id", "=", shipmentPublicId).executeTakeFirst();
    return row?.id ?? null;
  }

  async findCallByIdempotencyKey(key: string) {
    return ((await this.callQuery().where("vapi_calls.idempotency_key", "=", key).executeTakeFirst()) ?? null) as VapiCallRecord | null;
  }

  async createCall(input: CreateCallInput) {
    const inserted = await this.db
      .insertInto("vapi_calls")
      .values({
        public_id: newPublicId("vcl"),
        queue_id: input.queueId,
        shipment_id: input.shipmentId,
        vapi_call_id: null,
        customer_phone: input.customerPhone,
        customer_name: input.customerName,
        cargo_provider: input.cargoProvider,
        tracking_number: input.trackingNumber,
        last_event_text: input.lastEventText,
        status: "basladi",
        summary: null,
        transcript: null,
        duration_seconds: null,
        cost: null,
        ended_reason: null,
        error_message: null,
        is_test: input.isTest,
        idempotency_key: input.idempotencyKey,
        request_id: input.requestId,
        job_id: null,
        queued: false,
        ended_at: null,
        actor_user_id: input.actorUserId,
      })
      .returning("public_id")
      .executeTakeFirstOrThrow();
    return inserted.public_id;
  }

  async markCallQueued(publicId: string, jobId: string | null) {
    await this.db
      .updateTable("vapi_calls")
      .set({ job_id: jobId, queued: jobId !== null, updated_at: new Date() })
      .where("public_id", "=", publicId)
      .execute();
  }

  private callQuery() {
    return this.db
      .selectFrom("vapi_calls")
      .leftJoin("shipments", "shipments.id", "vapi_calls.shipment_id")
      .selectAll("vapi_calls")
      .select("shipments.public_id as shipment_public_id");
  }

  async getCall(publicId: string) {
    return ((await this.callQuery().where("vapi_calls.public_id", "=", publicId).executeTakeFirst()) ?? null) as VapiCallRecord | null;
  }

  async listCalls(input: { status: string | null; search: string | null; limit: number; offset: number }) {
    let rows = this.callQuery();
    let count = this.db.selectFrom("vapi_calls").select((eb) => eb.fn.countAll<string>().as("count"));
    if (input.status) {
      rows = rows.where("vapi_calls.status", "=", input.status);
      count = count.where("vapi_calls.status", "=", input.status);
    }
    if (input.search) {
      const pattern = `%${input.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      rows = rows.where((eb) =>
        eb.or([
          eb("vapi_calls.customer_name", "ilike", pattern),
          eb("vapi_calls.customer_phone", "ilike", pattern),
          eb("vapi_calls.tracking_number", "ilike", pattern),
        ]),
      );
      count = count.where((eb) =>
        eb.or([
          eb("vapi_calls.customer_name", "ilike", pattern),
          eb("vapi_calls.customer_phone", "ilike", pattern),
          eb("vapi_calls.tracking_number", "ilike", pattern),
        ]),
      );
    }
    const [data, total] = await Promise.all([
      rows.orderBy("vapi_calls.started_at", "desc").limit(input.limit).offset(input.offset).execute(),
      count.executeTakeFirst(),
    ]);
    return { rows: data as VapiCallRecord[], total: Number(total?.count ?? 0) };
  }

  async statisticsInput(now: Date) {
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [calls, queue] = await Promise.all([
      this.db.selectFrom("vapi_calls").select(["status", "duration_seconds", "cost"]).where("started_at", ">=", since).execute(),
      this.db
        .selectFrom("vapi_call_queue")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("status", "=", "bekliyor")
        .executeTakeFirst(),
    ]);
    return { calls, queueWaiting: Number(queue?.count ?? 0) };
  }

  async listWebhookEvents(input: { callId: string | null; limit: number; offset: number }) {
    let rows = this.db
      .selectFrom("webhook_events")
      .innerJoin("integration_providers", "integration_providers.id", "webhook_events.provider_id")
      .select([
        "webhook_events.public_id",
        "webhook_events.event_type",
        "webhook_events.external_event_id",
        "webhook_events.status",
        "webhook_events.received_at",
        "webhook_events.raw_payload",
      ])
      .where("integration_providers.key", "=", "vapi");
    let count = this.db
      .selectFrom("webhook_events")
      .innerJoin("integration_providers", "integration_providers.id", "webhook_events.provider_id")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("integration_providers.key", "=", "vapi");
    if (input.callId) {
      const pattern = `%${input.callId}%`;
      rows = rows.where(sql<string>`webhook_events.raw_payload::text`, "like", pattern);
      count = count.where(sql<string>`webhook_events.raw_payload::text`, "like", pattern);
    }
    const [data, total] = await Promise.all([
      rows.orderBy("webhook_events.received_at", "desc").limit(input.limit).offset(input.offset).execute(),
      count.executeTakeFirst(),
    ]);
    return { rows: data, total: Number(total?.count ?? 0) };
  }

  async getWebhookEvent(publicId: string) {
    return (
      (await this.db
        .selectFrom("webhook_events")
        .innerJoin("integration_providers", "integration_providers.id", "webhook_events.provider_id")
        .select([
          "webhook_events.public_id",
          "webhook_events.event_type",
          "webhook_events.external_event_id",
          "webhook_events.status",
          "webhook_events.received_at",
          "webhook_events.raw_payload",
        ])
        .where("integration_providers.key", "=", "vapi")
        .where("webhook_events.public_id", "=", publicId)
        .executeTakeFirst()) ?? null
    );
  }

  private async applyPatch(call: { id: number; queue_id: number | null; shipment_id: number | null; customer_phone: string }, patch: VapiCallPatch, queueStatus: string | null) {
    const values: Record<string, unknown> = { updated_at: new Date() };
    if (patch.status) values.status = patch.status;
    if (patch.ended_at) values.ended_at = patch.ended_at;
    if (patch.summary) values.summary = patch.summary;
    if (patch.transcript) values.transcript = JSON.stringify(patch.transcript);
    if (patch.duration_seconds !== undefined) values.duration_seconds = patch.duration_seconds;
    if (patch.cost !== undefined) values.cost = patch.cost;
    if (patch.ended_reason) values.ended_reason = patch.ended_reason;
    await this.db.updateTable("vapi_calls").set(values).where("id", "=", call.id).execute();
    if (queueStatus) {
      // Legacy: the kuyruk row of the same kargo + telefon goes back to `bekliyor` when unanswered, else `tamamlandi`.
      if (call.queue_id !== null) {
        await this.setQueueStatus(call.queue_id, queueStatus);
      } else if (call.shipment_id !== null) {
        await this.db
          .updateTable("vapi_call_queue")
          .set({ status: queueStatus, updated_at: new Date() })
          .where("shipment_id", "=", call.shipment_id)
          .where("customer_phone", "=", call.customer_phone)
          .execute();
      }
    }
  }

  /**
   * Reads worker/ingestion results back into the call log (the API never calls VAPI itself):
   * - `vapi.call.create` attempts by request id → vapi_call_id or `hata`
   * - frozen `vapi` `call.webhook` events (legacy /api/vapi/webhook semantics)
   * - `vapi.call.get` backfill snapshots (legacy /api/vapi/aramalar/:id)
   */
  async reconcileOpenCalls(filter: { publicId?: string } = {}) {
    let query = this.db
      .selectFrom("vapi_calls")
      .select(["id", "public_id", "queue_id", "shipment_id", "customer_phone", "vapi_call_id", "request_id", "status", "transcript"])
      .where((eb) => eb.or([eb("status", "in", openCallStatuses), eb("transcript", "is", null)]))
      .where("is_test", "=", false)
      .where("status", "!=", "hata");
    if (filter.publicId) query = query.where("public_id", "=", filter.publicId);
    else query = query.where("started_at", ">=", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const calls = await query.limit(200).execute();
    for (const call of calls) {
      let vapiCallId = call.vapi_call_id;
      if (!vapiCallId) {
        const attempt = await this.db
          .selectFrom("provider_attempts")
          .select(["status", "response_metadata", "error_message"])
          .where("request_id", "=", call.request_id)
          .where("operation", "=", "call.create")
          .orderBy("started_at", "desc")
          .executeTakeFirst();
        if (!attempt) continue;
        const callId = asRecord(attempt.response_metadata).vapi_call_id;
        if (attempt.status === "success" && typeof callId === "string") {
          vapiCallId = callId;
          await this.db.updateTable("vapi_calls").set({ vapi_call_id: callId, updated_at: new Date() }).where("id", "=", call.id).execute();
        } else if (attempt.status === "terminal_failure") {
          await this.db
            .updateTable("vapi_calls")
            .set({ status: "hata", error_message: attempt.error_message ?? "Arama başlatılamadı", ended_at: new Date(), updated_at: new Date() })
            .where("id", "=", call.id)
            .execute();
          if (call.queue_id !== null) await this.setQueueStatus(call.queue_id, "bekliyor");
          continue;
        } else {
          continue;
        }
      }
      if (!openCallStatuses.includes(call.status) && call.transcript !== null) continue;

      const events = await this.db
        .selectFrom("webhook_events")
        .innerJoin("integration_providers", "integration_providers.id", "webhook_events.provider_id")
        .select(["webhook_events.raw_payload", "webhook_events.received_at"])
        .where("integration_providers.key", "=", "vapi")
        .where(sql<string>`webhook_events.raw_payload::text`, "like", `%${vapiCallId}%`)
        .orderBy("webhook_events.received_at", "asc")
        .execute();
      for (const event of events) {
        const body = asRecord(event.raw_payload).body;
        if (vapiWebhookCallId(body) !== vapiCallId) continue;
        const result = vapiWebhookPatch(body, new Date(event.received_at));
        if (!result) continue;
        await this.applyPatch(call, result.patch, result.ended ? (result.unanswered ? "bekliyor" : "tamamlandi") : null);
      }

      const snapshotAttempt = await this.db
        .selectFrom("provider_attempts")
        .select(["response_metadata"])
        .where("operation", "=", "call.get")
        .where("status", "=", "success")
        .where("request_id", "like", `req_vapi_call_get_${call.public_id}%`)
        .orderBy("started_at", "desc")
        .executeTakeFirst();
      const snapshot = snapshotAttempt ? asRecord(asRecord(snapshotAttempt.response_metadata).call_snapshot) : null;
      const current = await this.db.selectFrom("vapi_calls").select(["status", "transcript"]).where("id", "=", call.id).executeTakeFirst();
      if (snapshot && current && (current.transcript === null || current.status === "basladi")) {
        const patch = callSnapshotPatch(snapshot);
        if (patch) await this.applyPatch(call, patch, null);
      }
    }
  }
}

export function serializeVapiQueueItem(row: VapiQueueRecord) {
  return {
    id: row.public_id,
    public_id: row.public_id,
    kargo_id: row.shipment_public_id,
    musteri_telefon: row.customer_phone,
    musteri_adi: row.customer_name,
    kargo_firmasi: row.cargo_provider,
    takip_no: row.tracking_number,
    son_hareket: row.last_event_text,
    durum: row.status,
    oncelik: row.priority,
    deneme_sayisi: row.attempt_count,
    max_deneme: row.max_attempts,
    son_arama_zamani: row.last_called_at ? new Date(row.last_called_at).toISOString() : null,
    olusturma_tarihi: new Date(row.created_at).toISOString(),
  };
}

function serializeTranscript(value: unknown): unknown {
  const transcript = typeof value === "string" ? safeParse(value) : value;
  if (transcript == null) return null;
  const record = asRecord(transcript);
  // Legacy modal renders arrays as chat bubbles and strings as plain text.
  if (Array.isArray(record.messages)) return record.messages;
  if (typeof record.text === "string") return record.text;
  return transcript;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function serializeVapiCall(row: VapiCallRecord) {
  return {
    id: row.public_id,
    public_id: row.public_id,
    vapi_call_id: row.vapi_call_id,
    kargo_id: row.shipment_public_id,
    musteri_telefon: row.customer_phone,
    musteri_adi: row.customer_name,
    kargo_firmasi: row.cargo_provider,
    takip_no: row.tracking_number,
    son_hareket: row.last_event_text,
    durum: row.status,
    arama_ozeti: row.summary,
    transkript: serializeTranscript(row.transcript),
    sure_sn: row.duration_seconds,
    maliyet: row.cost,
    bitis_nedeni: row.ended_reason,
    hata_mesaji: row.error_message,
    test_aramasi: row.is_test,
    request_id: row.request_id,
    job_id: row.job_id,
    queued: row.queued,
    baslangic: new Date(row.started_at).toISOString(),
    bitis: row.ended_at ? new Date(row.ended_at).toISOString() : null,
  };
}

export function serializeVapiWebhookEvent(row: { public_id: string; event_type: string; external_event_id: string | null; status: string; received_at: Date | string; raw_payload: unknown }, includePayload = false) {
  const body = asRecord(row.raw_payload).body;
  const message = vapiWebhookMessage(body);
  return {
    public_id: row.public_id,
    event_type: vapiWebhookType(body) ?? row.event_type,
    external_event_id: row.external_event_id,
    status: row.status,
    received_at: new Date(row.received_at).toISOString(),
    vapi_call_id: vapiWebhookCallId(body),
    call_status: typeof message.status === "string" ? message.status : null,
    ended_reason: typeof message.endedReason === "string" ? message.endedReason : null,
    ...(includePayload ? { payload: body ?? null } : {}),
  };
}
