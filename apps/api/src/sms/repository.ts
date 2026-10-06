import type { AppDatabase, Database } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import { newPublicId } from "../auth/crypto.js";

export type SmsTemplateRecord = Selectable<Database["sms_templates"]>;
export type SmsMessageRecord = Selectable<Database["sms_messages"]>;
export type SmsHistoryType = "all" | "manual" | "automatic";
export type SmsDeliveryStatus = "queued" | "sent" | "failed";

/** Shipment statuses the legacy automatic SMS sweep skipped (`durum=in.(olusturuldu,hazirlaniyor,kargoya_verildi,dagitimda)`). */
const closedShipmentStatuses = ["delivered", "teslim_edildi", "cancelled", "iptal", "returned", "iade"] as const;

export interface SmsHistoryRow extends SmsMessageRecord {
  attempt_status: string | null;
  attempt_error_message: string | null;
}

export interface ListSmsHistoryFilter {
  type: SmsHistoryType;
  query?: string;
  limit: number;
  offset: number;
}

export interface RecordSmsMessageInput {
  recipientPhone: string;
  customerName: string | null;
  message: string;
  shipmentPublicId: string | null;
  trackingNumber: string | null;
  templatePublicId: string | null;
  idempotencyKey: string;
  requestId: string;
  jobId: string | null;
  queued: boolean;
  actorUserId: number | null;
}

export interface TrackableShipment {
  public_id: string;
  provider: string;
  tracking_number: string | null;
  barcode_number: string | null;
  recipient_name: string;
}

export class SmsTemplateNotFoundError extends Error {
  constructor() {
    super("SMS template was not found");
    this.name = "SmsTemplateNotFoundError";
  }
}

export class SmsSystemTemplateDeleteError extends Error {
  constructor() {
    super("Sistem şablonları silinemez");
    this.name = "SmsSystemTemplateDeleteError";
  }
}

export class SmsRepository {
  constructor(private readonly db: AppDatabase) {}

  async listTemplates(): Promise<SmsTemplateRecord[]> {
    return this.db.selectFrom("sms_templates").selectAll().orderBy("sort_order", "asc").orderBy("created_at", "asc").orderBy("id", "asc").execute();
  }

  async createTemplate(input: { title: string; body: string; sortOrder: number; actorUserId: number | null }): Promise<SmsTemplateRecord> {
    return this.db
      .insertInto("sms_templates")
      .values({
        public_id: newPublicId("smt"),
        title: input.title,
        body: input.body,
        sort_order: input.sortOrder,
        is_active: true,
        is_system: false,
        created_by_user_id: input.actorUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateTemplate(
    publicId: string,
    input: { title?: string; body?: string; isActive?: boolean; sortOrder?: number },
  ): Promise<SmsTemplateRecord> {
    const updated = await this.db
      .updateTable("sms_templates")
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
        updated_at: new Date(),
      })
      .where("public_id", "=", publicId)
      .returningAll()
      .executeTakeFirst();
    if (!updated) {
      throw new SmsTemplateNotFoundError();
    }
    return updated;
  }

  async deleteTemplate(publicId: string): Promise<void> {
    const existing = await this.db.selectFrom("sms_templates").select(["id", "is_system"]).where("public_id", "=", publicId).executeTakeFirst();
    if (!existing) {
      throw new SmsTemplateNotFoundError();
    }
    if (existing.is_system) {
      throw new SmsSystemTemplateDeleteError();
    }
    await this.db.deleteFrom("sms_templates").where("id", "=", existing.id).execute();
  }

  /**
   * SMS history (legacy `sms_gonderimler`). Delivery state is read from the worker-written
   * `provider_attempts` row that carries the same request id; the API never polls NetGSM itself.
   */
  async listHistory(filter: ListSmsHistoryFilter): Promise<{ rows: SmsHistoryRow[]; total: number }> {
    const query = filter.query?.trim();
    const base = this.db
      .selectFrom("sms_messages")
      .$if(filter.type !== "all", (builder) => builder.where("sms_messages.is_automatic", "=", filter.type === "automatic"))
      .$if(Boolean(query), (builder) =>
        builder.where((eb) =>
          eb.or([
            eb("sms_messages.recipient_phone", "ilike", `%${query}%`),
            eb("sms_messages.customer_name", "ilike", `%${query}%`),
            eb("sms_messages.tracking_number", "ilike", `%${query}%`),
          ]),
        ),
      );

    const [rows, count] = await Promise.all([
      base
        .selectAll("sms_messages")
        .select((eb) => [
          eb
            .selectFrom("provider_attempts")
            .select("provider_attempts.status")
            .whereRef("provider_attempts.request_id", "=", "sms_messages.request_id")
            .orderBy("provider_attempts.started_at", "desc")
            .limit(1)
            .as("attempt_status"),
          eb
            .selectFrom("provider_attempts")
            .select("provider_attempts.error_message")
            .whereRef("provider_attempts.request_id", "=", "sms_messages.request_id")
            .orderBy("provider_attempts.started_at", "desc")
            .limit(1)
            .as("attempt_error_message"),
        ])
        .orderBy("sms_messages.created_at", "desc")
        .orderBy("sms_messages.id", "desc")
        .limit(filter.limit)
        .offset(filter.offset)
        .execute(),
      base.select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirst(),
    ]);

    return { rows: rows as SmsHistoryRow[], total: Number(count?.count ?? 0) };
  }

  async findMessagesByIdempotencyKeys(keys: string[]): Promise<SmsMessageRecord[]> {
    if (keys.length === 0) return [];
    return this.db.selectFrom("sms_messages").selectAll().where("idempotency_key", "in", keys).execute();
  }

  async recordMessage(input: RecordSmsMessageInput): Promise<SmsMessageRecord> {
    const [shipment, template] = await Promise.all([
      input.shipmentPublicId
        ? this.db.selectFrom("shipments").select(["id"]).where("public_id", "=", input.shipmentPublicId).executeTakeFirst()
        : Promise.resolve(undefined),
      input.templatePublicId
        ? this.db.selectFrom("sms_templates").select(["id"]).where("public_id", "=", input.templatePublicId).executeTakeFirst()
        : Promise.resolve(undefined),
    ]);
    const inserted = await this.db
      .insertInto("sms_messages")
      .values({
        public_id: newPublicId("sms"),
        recipient_phone: input.recipientPhone,
        customer_name: input.customerName,
        message: input.message,
        is_automatic: false,
        status: "queued",
        shipment_id: shipment?.id ?? null,
        tracking_number: input.trackingNumber,
        template_id: template?.id ?? null,
        idempotency_key: input.idempotencyKey,
        request_id: input.requestId,
        job_id: input.jobId,
        queued: input.queued,
        actor_user_id: input.actorUserId,
      })
      .onConflict((oc) => oc.column("idempotency_key").doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) {
      return inserted;
    }
    return this.db.selectFrom("sms_messages").selectAll().where("idempotency_key", "=", input.idempotencyKey).executeTakeFirstOrThrow();
  }

  /** Legacy cron sweep scope: open shipments of the provider created in the last 30 days with a tracking number. */
  async listTrackableShipments(provider: "ptt" | "surat", since: Date): Promise<TrackableShipment[]> {
    return this.db
      .selectFrom("shipments")
      .select(["public_id", "provider", "tracking_number", "barcode_number", "recipient_name"])
      .where("provider", "=", provider)
      .where("tracking_number", "is not", null)
      .where("status", "not in", [...closedShipmentStatuses])
      .where("created_at", ">=", since)
      .orderBy("created_at", "desc")
      .limit(500)
      .execute();
  }
}

export function smsDeliveryStatus(row: Pick<SmsHistoryRow, "status" | "attempt_status">): SmsDeliveryStatus {
  if (row.attempt_status === "success") return "sent";
  if (row.attempt_status === "terminal_failure") return "failed";
  if (row.status === "sent" || row.status === "failed") return row.status;
  return "queued";
}

export function serializeSmsTemplate(template: SmsTemplateRecord) {
  return {
    public_id: template.public_id,
    title: template.title,
    body: template.body,
    sort_order: template.sort_order,
    is_active: template.is_active,
    is_system: template.is_system,
    created_at: new Date(template.created_at).toISOString(),
    updated_at: new Date(template.updated_at).toISOString(),
  };
}

export function serializeSmsMessage(row: SmsMessageRecord & Partial<Pick<SmsHistoryRow, "attempt_status" | "attempt_error_message">>) {
  const status = smsDeliveryStatus({ status: row.status, attempt_status: row.attempt_status ?? null });
  return {
    public_id: row.public_id,
    recipient_phone: row.recipient_phone,
    customer_name: row.customer_name,
    tracking_number: row.tracking_number,
    message: row.message,
    is_automatic: row.is_automatic,
    status,
    error_message: row.attempt_error_message ?? row.error_message,
    provider_bulk_id: row.provider_bulk_id,
    request_id: row.request_id,
    job_id: row.job_id,
    queued: row.queued,
    created_at: new Date(row.created_at).toISOString(),
  };
}
