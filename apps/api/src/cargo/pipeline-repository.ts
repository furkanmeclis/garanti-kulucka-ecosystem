import type { AppDatabase } from "@garanti-kulucka/database";
import { nextCargoPipelineStep, type CargoPipelineAction } from "@garanti-kulucka/shared";

export interface CargoPipelineListFilter {
  status: string | null;
  step: string | null;
  page: number;
  pageSize: number;
}

export interface CargoPipelineRow {
  public_id: string;
  shipment_public_id: string | null;
  order_public_id: string | null;
  conversation_public_id: string | null;
  vapi_call_public_id: string | null;
  channel: string | null;
  phone: string | null;
  customer_name: string | null;
  tracking_number: string | null;
  cargo_provider: string | null;
  last_event_text: string | null;
  step: string;
  status: string;
  next_run_at: Date | string;
  force_run: boolean;
  attempt_count: number;
  max_attempts: number;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class CargoPipelineRepository {
  constructor(private readonly db: AppDatabase) {}

  private baseQuery() {
    return this.db
      .selectFrom("cargo_pipeline_items")
      .leftJoin("shipments", "shipments.id", "cargo_pipeline_items.shipment_id")
      .leftJoin("orders", "orders.id", "cargo_pipeline_items.order_id")
      .leftJoin("conversations", "conversations.id", "cargo_pipeline_items.conversation_id")
      .leftJoin("vapi_calls", "vapi_calls.id", "cargo_pipeline_items.vapi_call_id");
  }

  private selectRow() {
    return this.baseQuery().select([
      "cargo_pipeline_items.public_id as public_id",
      "shipments.public_id as shipment_public_id",
      "orders.public_id as order_public_id",
      "conversations.public_id as conversation_public_id",
      "vapi_calls.public_id as vapi_call_public_id",
      "cargo_pipeline_items.channel as channel",
      "cargo_pipeline_items.phone as phone",
      "cargo_pipeline_items.customer_name as customer_name",
      "cargo_pipeline_items.tracking_number as tracking_number",
      "cargo_pipeline_items.cargo_provider as cargo_provider",
      "cargo_pipeline_items.last_event_text as last_event_text",
      "cargo_pipeline_items.step as step",
      "cargo_pipeline_items.status as status",
      "cargo_pipeline_items.next_run_at as next_run_at",
      "cargo_pipeline_items.force_run as force_run",
      "cargo_pipeline_items.attempt_count as attempt_count",
      "cargo_pipeline_items.max_attempts as max_attempts",
      "cargo_pipeline_items.error_message as error_message",
      "cargo_pipeline_items.created_at as created_at",
      "cargo_pipeline_items.updated_at as updated_at",
    ]);
  }

  async list(filter: CargoPipelineListFilter): Promise<{ rows: CargoPipelineRow[]; total: number }> {
    let rowsQuery = this.selectRow();
    let countQuery = this.db.selectFrom("cargo_pipeline_items").select((eb) => eb.fn.countAll<string>().as("count"));
    if (filter.status) {
      rowsQuery = rowsQuery.where("cargo_pipeline_items.status", "=", filter.status);
      countQuery = countQuery.where("cargo_pipeline_items.status", "=", filter.status);
    }
    if (filter.step) {
      rowsQuery = rowsQuery.where("cargo_pipeline_items.step", "=", filter.step);
      countQuery = countQuery.where("cargo_pipeline_items.step", "=", filter.step);
    }
    const [rows, count] = await Promise.all([
      rowsQuery
        .orderBy("cargo_pipeline_items.created_at", "desc")
        .orderBy("cargo_pipeline_items.id", "desc")
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize)
        .execute(),
      countQuery.executeTakeFirst(),
    ]);
    return { rows, total: Number(count?.count ?? 0) };
  }

  async get(publicId: string): Promise<CargoPipelineRow | null> {
    return (await this.selectRow().where("cargo_pipeline_items.public_id", "=", publicId).executeTakeFirst()) ?? null;
  }

  /** Legacy POST /api/kargo-pipeline/:id/aksiyon. */
  async applyAction(publicId: string, action: CargoPipelineAction, now: Date): Promise<CargoPipelineRow | null> {
    const current = await this.db.selectFrom("cargo_pipeline_items").select(["id", "step"]).where("public_id", "=", publicId).executeTakeFirst();
    if (!current) return null;
    const patch =
      action === "run_now"
        ? { status: "bekliyor", next_run_at: now, force_run: true }
        : action === "skip"
          ? (() => {
              const step = nextCargoPipelineStep(current.step);
              return { step, status: step === "tamamlandi" ? "tamamlandi" : "bekliyor", next_run_at: now, vapi_call_id: null };
            })()
          : action === "cancel"
            ? { status: "iptal", force_run: false }
            : { step: "tamamlandi", status: "tamamlandi", force_run: false };
    await this.db.updateTable("cargo_pipeline_items").set({ ...patch, updated_at: now }).where("id", "=", current.id).execute();
    return this.get(publicId);
  }

  async delete(publicId: string): Promise<boolean> {
    const result = await this.db.deleteFrom("cargo_pipeline_items").where("public_id", "=", publicId).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0) > 0;
  }
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

export function serializeCargoPipelineItem(row: CargoPipelineRow) {
  return {
    public_id: row.public_id,
    shipment_public_id: row.shipment_public_id,
    order_public_id: row.order_public_id,
    conversation_public_id: row.conversation_public_id,
    vapi_call_public_id: row.vapi_call_public_id,
    channel: row.channel,
    phone: row.phone,
    customer_name: row.customer_name,
    tracking_number: row.tracking_number,
    cargo_provider: row.cargo_provider,
    last_event_text: row.last_event_text,
    step: row.step,
    status: row.status,
    next_run_at: iso(row.next_run_at),
    force_run: row.force_run,
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    error_message: row.error_message,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}
