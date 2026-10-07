import { randomUUID } from "node:crypto";
import type { AppDatabase } from "@garanti-kulucka/database";
import {
  cargoPipelineSettingKey,
  cargoPipelineSettingScope,
  fillCargoPipelineTemplate,
  isCargoDelivered,
  isCargoNotReceived,
  isWithinWorkingHours,
  jobEnvelopeSchema,
  normalizeCargoPipelineConfig,
  planOutboundDelivery,
  providerDeliveryJobPayloadSchema,
  type CargoPipelineConfig,
  type JobEnvelope,
} from "@garanti-kulucka/shared";

/**
 * Legacy kargoPipelineCron / kargoPipelineEnqueue / kargoPipelineKayitIsle (server.js): shipments whose last carrier
 * event says the parcel was not collected get a pipeline row, and due rows walk mesaj → sms → vapi inside the
 * configured working hours. Every outbound call is a provider-delivery job, so the provider live gates still decide
 * whether WhatsApp / NetGSM / VAPI are really called.
 */

export interface CargoPipelineItem {
  id: number;
  public_id: string;
  shipment_id: number | null;
  conversation_id: number | null;
  channel: string | null;
  phone: string | null;
  customer_name: string | null;
  tracking_number: string | null;
  cargo_provider: string | null;
  last_event_text: string | null;
  step: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
}

export interface CargoPipelineContext {
  shipment: { public_id: string; status: string; last_event_text: string | null } | null;
  conversation: { public_id: string; channel: string; external_thread_id: string | null; customer_phone: string | null } | null;
}

export interface VapiPolicy {
  enabled: boolean;
  start: string;
  end: string;
}

export type CargoPipelinePatch = Partial<{
  step: string;
  status: string;
  next_run_at: Date;
  attempt_count: number;
  error_message: string | null;
  last_event_text: string | null;
  vapi_call_id: number | null;
}>;

export interface OpenVapiPipelineItem {
  item: CargoPipelineItem;
  call_status: string;
}

export interface CargoPipelineStore {
  loadConfig: () => Promise<CargoPipelineConfig>;
  loadVapiPolicy: () => Promise<VapiPolicy>;
  enqueueCandidates: (config: CargoPipelineConfig, now: Date) => Promise<number>;
  claimDue: (now: Date, withinHours: boolean, limit: number) => Promise<CargoPipelineItem[]>;
  loadContext: (item: CargoPipelineItem) => Promise<CargoPipelineContext>;
  update: (id: number, patch: CargoPipelinePatch) => Promise<void>;
  recordConversationMessage: (conversationPublicId: string, body: string) => Promise<string>;
  recordSms: (input: { item: CargoPipelineItem; shipmentId: number | null; phone: string; message: string; idempotencyKey: string; requestId: string; jobId: string | null }) => Promise<void>;
  createVapiCall: (input: { item: CargoPipelineItem; phone: string; idempotencyKey: string; requestId: string }) => Promise<{ id: number; public_id: string }>;
  markVapiCallQueued: (callId: number, jobId: string | null) => Promise<void>;
  openVapiItems: () => Promise<OpenVapiPipelineItem[]>;
}

export type JobPublisher = (job: JobEnvelope) => Promise<string | null>;

const minute = 60 * 1000;
const deliveryChannels = new Set(["whatsapp", "instagram", "messenger", "facebook"]);

function after(now: Date, minutes: number) {
  return new Date(now.getTime() + Math.max(0, minutes) * minute);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

function digits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function templateMessage(config: CargoPipelineConfig, item: CargoPipelineItem) {
  return fillCargoPipelineTemplate(config.mesaj_sablonu, {
    customerName: item.customer_name,
    trackingNumber: item.tracking_number,
    lastEventText: item.last_event_text,
    cargoProvider: item.cargo_provider,
  });
}

function smsJob(item: CargoPipelineItem, phone: string, message: string, shipmentPublicId: string | null, now: Date) {
  const idempotencyKey = `cargo_pipeline_${item.public_id}_sms_${item.attempt_count}`;
  const suffix = slug(idempotencyKey);
  const requestId = `req_${suffix}`;
  const payload = providerDeliveryJobPayloadSchema.parse({
    envelope: {
      request_id: requestId,
      provider: "netgsm",
      operation: "sms.send",
      direction: "outbound",
      channel: "sms",
      occurred_at: now.toISOString(),
      payload: {
        recipient_phone: phone,
        message,
        idempotency_key: idempotencyKey,
        ...(shipmentPublicId ? { shipment_public_id: shipmentPublicId } : {}),
        automatic: true,
      },
      legacy_contract: { source: "server.js kargoPipelineSmsGonder", legacy_event: "kargo_pipeline_sms" },
    },
  });
  const job = jobEnvelopeSchema.parse({
    job_id: `job_${suffix}`,
    queue: "provider-delivery",
    name: "netgsm.sms.send",
    payload,
    requested_at: now.toISOString(),
    request_id: requestId,
  });
  return { job, idempotencyKey, requestId };
}

function vapiJob(item: CargoPipelineItem, callPublicId: string, phone: string, idempotencyKey: string, requestId: string, now: Date) {
  const payload = providerDeliveryJobPayloadSchema.parse({
    envelope: {
      request_id: requestId,
      provider: "vapi",
      operation: "call.create",
      direction: "outbound",
      channel: "voice",
      occurred_at: now.toISOString(),
      payload: {
        call_public_id: callPublicId,
        customer_phone: phone,
        customer_name: item.customer_name ?? "",
        cargo_provider: item.cargo_provider ?? "",
        tracking_number: item.tracking_number ?? "",
        last_event_text: item.last_event_text ?? "",
        idempotency_key: idempotencyKey,
      },
      legacy_contract: { source: "server.js kargoPipelineVapiEkle", legacy_event: "kargo_pipeline_vapi" },
    },
  });
  return jobEnvelopeSchema.parse({
    job_id: `job_${slug(idempotencyKey)}`,
    queue: "provider-delivery",
    name: "vapi.call.create",
    payload,
    requested_at: now.toISOString(),
    request_id: requestId,
  });
}

export interface ProcessDeps {
  store: CargoPipelineStore;
  publish: JobPublisher;
  config: CargoPipelineConfig;
  vapiPolicy: VapiPolicy;
  now: Date;
}

/** Legacy kargoPipelineKayitIsle for one claimed row (status already `isleniyor`). */
export async function processCargoPipelineItem(item: CargoPipelineItem, deps: ProcessDeps): Promise<CargoPipelinePatch> {
  const { store, publish, config, vapiPolicy, now } = deps;
  const context = await store.loadContext(item);
  const patch: CargoPipelinePatch = {};

  if (context.shipment) {
    if (isCargoDelivered(context.shipment.status, context.shipment.last_event_text ?? item.last_event_text)) {
      return { step: "teslim", status: "teslim", error_message: null };
    }
    if (context.shipment.last_event_text && context.shipment.last_event_text !== item.last_event_text) {
      patch.last_event_text = context.shipment.last_event_text;
      item = { ...item, last_event_text: context.shipment.last_event_text };
    }
  }

  if (item.attempt_count >= item.max_attempts) {
    return { ...patch, status: "hata", error_message: "Maksimum deneme sayısına ulaşıldı" };
  }

  if (item.step === "mesaj") {
    let reason: string | null = "konusma_yok";
    if (context.conversation && deliveryChannels.has(context.conversation.channel)) {
      const body = templateMessage(config, item);
      const messagePublicId = await store.recordConversationMessage(context.conversation.public_id, body);
      const plan = planOutboundDelivery({
        target: context.conversation,
        messagePublicId,
        body,
        attachments: [],
        requestId: undefined,
        occurredAt: now.toISOString(),
        idempotencyPrefix: "cargo_pipeline",
        legacyContract: { source: "server.js kargoPipelineKanalMesajiGonder", legacy_event: "kargo_pipeline_mesaj" },
      });
      if ("reason" in plan) {
        reason = plan.reason;
      } else {
        for (const job of plan.jobs) await publish(job);
        reason = null;
      }
    }
    return reason === null
      ? { ...patch, step: "sms", status: "bekliyor", next_run_at: after(now, config.sms_gecikme_dk), error_message: null }
      : { ...patch, step: "sms", status: "bekliyor", next_run_at: now, error_message: `Mesaj atlandı: ${reason}` };
  }

  const phone = digits(item.phone ?? context.conversation?.customer_phone);

  if (item.step === "sms") {
    if (phone.length < 10) return { ...patch, step: "tamamlandi", status: "tamamlandi", error_message: "SMS atlandı: telefon yok" };
    const message = templateMessage(config, item);
    const { job, idempotencyKey, requestId } = smsJob(item, phone, message, context.shipment?.public_id ?? null, now);
    try {
      const jobId = await publish(job);
      await store.recordSms({ item, shipmentId: item.shipment_id, phone, message, idempotencyKey, requestId, jobId });
    } catch (error) {
      return {
        ...patch,
        status: "bekliyor",
        next_run_at: after(now, 30),
        attempt_count: item.attempt_count + 1,
        error_message: error instanceof Error ? error.message : "SMS gönderilemedi",
      };
    }
    return { ...patch, step: "vapi", status: "bekliyor", next_run_at: after(now, config.vapi_gecikme_dk), error_message: null };
  }

  if (item.step === "vapi") {
    if (phone.length < 10) return { ...patch, step: "tamamlandi", status: "tamamlandi", error_message: "VAPI atlandı: telefon yok" };
    if (!vapiPolicy.enabled) return { ...patch, step: "tamamlandi", status: "tamamlandi", error_message: "VAPI atlandı: otomatik arama kapalı" };
    if (!isWithinWorkingHours(vapiPolicy.start, vapiPolicy.end, now)) {
      return { ...patch, status: "bekliyor", next_run_at: after(now, 30), error_message: "VAPI arama saatleri dışında — ertelendi" };
    }
    const idempotencyKey = `cargo_pipeline_${item.public_id}_vapi_${item.attempt_count}`;
    const requestId = `req_vapi_call_${slug(idempotencyKey)}`;
    try {
      const call = await store.createVapiCall({ item, phone, idempotencyKey, requestId });
      const jobId = await publish(vapiJob(item, call.public_id, phone, idempotencyKey, requestId, now));
      await store.markVapiCallQueued(call.id, jobId);
      return { ...patch, status: "isleniyor", vapi_call_id: call.id, error_message: null };
    } catch (error) {
      return {
        ...patch,
        status: "bekliyor",
        next_run_at: after(now, 60),
        attempt_count: item.attempt_count + 1,
        error_message: error instanceof Error ? error.message : "VAPI eklenemedi",
      };
    }
  }

  return { ...patch, step: "tamamlandi", status: "tamamlandi" };
}

/** Legacy kargoPipelineVapiSonucGuncelle: answered → done, unanswered → retry until max attempts. */
export function vapiFollowUpPatch(entry: OpenVapiPipelineItem, config: CargoPipelineConfig, now: Date): CargoPipelinePatch | null {
  if (entry.call_status === "tamamlandi") return { step: "tamamlandi", status: "tamamlandi", error_message: null };
  if (entry.call_status !== "cevapsiz" && entry.call_status !== "hata" && entry.call_status !== "iptal") return null;
  const attempts = entry.item.attempt_count + 1;
  if (attempts >= entry.item.max_attempts) {
    return { status: "hata", attempt_count: attempts, vapi_call_id: null, error_message: "VAPI: maksimum deneme sayısına ulaşıldı (cevapsız)" };
  }
  return {
    status: "bekliyor",
    attempt_count: attempts,
    vapi_call_id: null,
    next_run_at: after(now, config.vapi_gecikme_dk || 60),
    error_message: "VAPI cevapsız — yeniden denenecek",
  };
}

export interface CargoPipelineTickResult {
  active: boolean;
  enqueued: number;
  processed: number;
  followed_up: number;
}

/** One legacy kargoPipelineCron pass. */
export async function runCargoPipelineTick(input: { store: CargoPipelineStore; publish: JobPublisher; now?: Date; batchSize?: number }): Promise<CargoPipelineTickResult> {
  const now = input.now ?? new Date();
  const config = await input.store.loadConfig();
  const result: CargoPipelineTickResult = { active: config.aktif, enqueued: 0, processed: 0, followed_up: 0 };

  for (const entry of await input.store.openVapiItems()) {
    const patch = vapiFollowUpPatch(entry, config, now);
    if (patch) {
      await input.store.update(entry.item.id, patch);
      result.followed_up += 1;
    }
  }

  // `run_now` rows are claimed even while the pipeline is off or outside working hours (legacy zorla).
  const withinHours = config.aktif && isWithinWorkingHours(config.baslangic_saati, config.bitis_saati, now);
  if (config.aktif) result.enqueued = await input.store.enqueueCandidates(config, now);
  const due = await input.store.claimDue(now, withinHours, input.batchSize ?? 5);
  if (due.length === 0) return result;
  const vapiPolicy = await input.store.loadVapiPolicy();
  for (const item of due) {
    try {
      const patch = await processCargoPipelineItem(item, { store: input.store, publish: input.publish, config, vapiPolicy, now });
      await input.store.update(item.id, patch);
    } catch (error) {
      await input.store.update(item.id, { status: "hata", error_message: error instanceof Error ? error.message : String(error) });
    }
    result.processed += 1;
  }
  return result;
}

export function cargoPipelineIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.CARGO_PIPELINE_INTERVAL_MS ?? "60000", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60000;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clock(value: unknown, fallback: string) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

const openShipmentExclusions = ["delivered", "cancelled", "returned"];
const itemColumns = [
  "id",
  "public_id",
  "shipment_id",
  "conversation_id",
  "channel",
  "phone",
  "customer_name",
  "tracking_number",
  "cargo_provider",
  "last_event_text",
  "step",
  "status",
  "attempt_count",
  "max_attempts",
] as const;

export class DatabaseCargoPipelineStore implements CargoPipelineStore {
  constructor(private readonly db: AppDatabase, private readonly lookbackDays = 14) {}

  private async setting(scope: string, key: string) {
    const row = await this.db.selectFrom("settings").select(["value"]).where("scope", "=", scope).where("key", "=", key).where("is_secret", "=", false).executeTakeFirst();
    return row?.value ?? null;
  }

  async loadConfig() {
    return normalizeCargoPipelineConfig(await this.setting(cargoPipelineSettingScope, cargoPipelineSettingKey));
  }

  async loadVapiPolicy(): Promise<VapiPolicy> {
    const record = asRecord(await this.setting("vapi", "call_policy"));
    return { enabled: record.enabled === true, start: clock(record.arama_baslangic_saati, "09:00"), end: clock(record.arama_bitis_saati, "18:00") };
  }

  async enqueueCandidates(config: CargoPipelineConfig, now: Date) {
    const candidates = await this.db
      .selectFrom("shipments")
      .leftJoin("orders", "orders.id", "shipments.order_id")
      .leftJoin("conversations", "conversations.id", "orders.conversation_id")
      .leftJoin("customers", "customers.id", "shipments.customer_id")
      .select([
        "shipments.id as shipment_id",
        "shipments.order_id as order_id",
        "shipments.status as status",
        "shipments.last_event_text as last_event_text",
        "shipments.tracking_number as tracking_number",
        "shipments.provider as provider",
        "shipments.recipient_name as recipient_name",
        "shipments.recipient_phone as recipient_phone",
        "customers.phone as customer_phone",
        "conversations.id as conversation_id",
        "conversations.channel as channel",
      ])
      .where("shipments.last_event_text", "is not", null)
      .where("shipments.status", "not in", openShipmentExclusions)
      .where("shipments.updated_at", ">=", new Date(now.getTime() - this.lookbackDays * 24 * 60 * minute))
      .where((eb) => eb.not(eb.exists(eb.selectFrom("cargo_pipeline_items").select("cargo_pipeline_items.id").whereRef("cargo_pipeline_items.shipment_id", "=", "shipments.id"))))
      .orderBy("shipments.updated_at", "desc")
      .limit(200)
      .execute();
    const rows = candidates.filter((row) => isCargoNotReceived(row.last_event_text) && !isCargoDelivered(row.status, row.last_event_text));
    if (rows.length === 0) return 0;
    const inserted = await this.db
      .insertInto("cargo_pipeline_items")
      .values(
        rows.map((row) => ({
          public_id: `cpl_${randomUUID().replaceAll("-", "")}`,
          shipment_id: row.shipment_id,
          order_id: row.order_id,
          conversation_id: row.conversation_id,
          channel: row.channel,
          phone: row.recipient_phone ?? row.customer_phone,
          customer_name: row.recipient_name,
          tracking_number: row.tracking_number,
          cargo_provider: row.provider,
          last_event_text: row.last_event_text,
          step: "mesaj",
          status: "bekliyor",
          next_run_at: after(now, config.mesaj_gecikme_dk),
          force_run: false,
          attempt_count: 0,
          max_attempts: config.max_deneme,
        })),
      )
      .onConflict((oc) => oc.column("shipment_id").doNothing())
      .returning("id")
      .execute();
    return inserted.length;
  }

  async claimDue(now: Date, withinHours: boolean, limit: number) {
    return this.db.transaction().execute(async (trx) => {
      const ids = await trx
        .selectFrom("cargo_pipeline_items")
        .select("id")
        .where("status", "=", "bekliyor")
        .where("next_run_at", "<=", now)
        .$if(!withinHours, (qb) => qb.where("force_run", "=", true))
        .orderBy("next_run_at", "asc")
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();
      if (ids.length === 0) return [];
      return trx
        .updateTable("cargo_pipeline_items")
        .set({ status: "isleniyor", force_run: false, updated_at: now })
        .where("id", "in", ids.map((row) => row.id))
        .returning([...itemColumns])
        .execute();
    });
  }

  async loadContext(item: CargoPipelineItem): Promise<CargoPipelineContext> {
    const [shipment, conversation] = await Promise.all([
      item.shipment_id === null
        ? Promise.resolve(undefined)
        : this.db.selectFrom("shipments").select(["public_id", "status", "last_event_text"]).where("id", "=", item.shipment_id).executeTakeFirst(),
      item.conversation_id === null
        ? Promise.resolve(undefined)
        : this.db
            .selectFrom("conversations")
            .leftJoin("customers", "customers.id", "conversations.customer_id")
            .select(["conversations.public_id as public_id", "conversations.channel as channel", "conversations.external_thread_id as external_thread_id", "customers.phone as customer_phone"])
            .where("conversations.id", "=", item.conversation_id)
            .executeTakeFirst(),
    ]);
    return {
      shipment: shipment ?? null,
      conversation: conversation ? { ...conversation, customer_phone: conversation.customer_phone ?? item.phone } : null,
    };
  }

  async update(id: number, patch: CargoPipelinePatch) {
    await this.db.updateTable("cargo_pipeline_items").set({ ...patch, updated_at: new Date() }).where("id", "=", id).execute();
  }

  async recordConversationMessage(conversationPublicId: string, body: string) {
    return this.db.transaction().execute(async (trx) => {
      const conversation = await trx.selectFrom("conversations").select("id").where("public_id", "=", conversationPublicId).executeTakeFirstOrThrow();
      const now = new Date();
      const message = await trx
        .insertInto("messages")
        .values({
          public_id: `msg_${randomUUID().replaceAll("-", "")}`,
          conversation_id: conversation.id,
          sender_type: "system",
          sender_name: "Garanti Kuluçka",
          body,
          external_message_id: null,
          is_read: true,
          sent_at: now,
          raw_payload: { source: "cargo_pipeline" },
        })
        .returning("public_id")
        .executeTakeFirstOrThrow();
      await trx
        .updateTable("conversations")
        .set({ last_message_text: body, last_message_sender_type: "system", last_message_at: now, updated_at: now })
        .where("id", "=", conversation.id)
        .execute();
      return message.public_id;
    });
  }

  async recordSms(input: { item: CargoPipelineItem; shipmentId: number | null; phone: string; message: string; idempotencyKey: string; requestId: string; jobId: string | null }) {
    await this.db
      .insertInto("sms_messages")
      .values({
        public_id: `sms_${randomUUID().replaceAll("-", "")}`,
        recipient_phone: input.phone,
        customer_name: input.item.customer_name,
        message: input.message,
        is_automatic: true,
        status: "queued",
        shipment_id: input.shipmentId,
        tracking_number: input.item.tracking_number,
        template_id: null,
        idempotency_key: input.idempotencyKey,
        request_id: input.requestId,
        job_id: input.jobId,
        queued: input.jobId !== null,
        actor_user_id: null,
      })
      .onConflict((oc) => oc.column("idempotency_key").doNothing())
      .execute();
  }

  async createVapiCall(input: { item: CargoPipelineItem; phone: string; idempotencyKey: string; requestId: string }) {
    const existing = await this.db.selectFrom("vapi_calls").select(["id", "public_id"]).where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
    if (existing) return existing;
    return this.db
      .insertInto("vapi_calls")
      .values({
        public_id: `vcl_${randomUUID().replaceAll("-", "")}`,
        queue_id: null,
        shipment_id: input.item.shipment_id,
        vapi_call_id: null,
        customer_phone: input.phone,
        customer_name: input.item.customer_name,
        cargo_provider: input.item.cargo_provider,
        tracking_number: input.item.tracking_number,
        last_event_text: input.item.last_event_text,
        status: "basladi",
        summary: null,
        transcript: null,
        duration_seconds: null,
        cost: null,
        ended_reason: null,
        error_message: null,
        is_test: false,
        idempotency_key: input.idempotencyKey,
        request_id: input.requestId,
        job_id: null,
        queued: false,
        ended_at: null,
        actor_user_id: null,
      })
      .returning(["id", "public_id"])
      .executeTakeFirstOrThrow();
  }

  async markVapiCallQueued(callId: number, jobId: string | null) {
    await this.db.updateTable("vapi_calls").set({ job_id: jobId, queued: jobId !== null, updated_at: new Date() }).where("id", "=", callId).execute();
  }

  async openVapiItems() {
    const rows = await this.db
      .selectFrom("cargo_pipeline_items")
      .innerJoin("vapi_calls", "vapi_calls.id", "cargo_pipeline_items.vapi_call_id")
      .select([...itemColumns.map((column) => `cargo_pipeline_items.${column}` as const), "vapi_calls.status as call_status"])
      .where("cargo_pipeline_items.step", "=", "vapi")
      .where("cargo_pipeline_items.status", "=", "isleniyor")
      .limit(100)
      .execute();
    return rows.map(({ call_status, ...item }) => ({ item, call_status }));
  }
}

