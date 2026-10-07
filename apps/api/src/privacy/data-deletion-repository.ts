import type { AppDatabase, DataDeletionRequestsTable, Selectable } from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";

export type DataDeletionRequestRecord = Selectable<DataDeletionRequestsTable>;
export const dataDeletionStatuses = ["pending", "in_progress", "completed", "rejected"] as const;
export type DataDeletionStatus = (typeof dataDeletionStatuses)[number];

export interface DataDeletionRequestInput {
  source: "form" | "facebook";
  fullName: string | null;
  email: string | null;
  phone: string | null;
  instagramUsername: string | null;
  messengerPsid: string | null;
  description: string | null;
  requestedAt: Date;
}

/** Legacy `DEL-<base36 time>` reference, with a random suffix so concurrent requests never collide. */
export function deletionReference(now = Date.now()) {
  return `DEL-${now.toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** Public KVKK / Meta data deletion requests (legacy `veri_silme_talepleri`). */
export class DataDeletionRepository {
  constructor(private readonly db: AppDatabase) {}

  async create(input: DataDeletionRequestInput) {
    return this.db
      .insertInto("data_deletion_requests")
      .values({
        public_id: newPublicId("ddr"),
        reference: deletionReference(),
        source: input.source,
        full_name: input.fullName,
        email: input.email,
        phone: input.phone,
        instagram_username: input.instagramUsername,
        messenger_psid: input.messengerPsid,
        description: input.description,
        requested_at: input.requestedAt,
        resolution_note: null,
        resolved_at: null,
        resolved_by_user_id: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async list(input: { status?: DataDeletionStatus; limit: number; offset: number }) {
    let query = this.db.selectFrom("data_deletion_requests");
    if (input.status) query = query.where("status", "=", input.status);
    const [rows, total] = await Promise.all([
      query.selectAll().orderBy("requested_at", "desc").orderBy("id", "desc").limit(input.limit).offset(input.offset).execute(),
      query.select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirstOrThrow(),
    ]);
    return { rows, total: Number(total.count) };
  }

  async findByReference(reference: string) {
    return (await this.db.selectFrom("data_deletion_requests").selectAll().where("reference", "=", reference).executeTakeFirst()) ?? null;
  }

  async updateStatus(publicId: string, input: { status: DataDeletionStatus; note: string | null; actorUserId: number | null }) {
    return this.db.transaction().execute(async (transaction) => {
      const current = await transaction.selectFrom("data_deletion_requests").selectAll().where("public_id", "=", publicId).forUpdate().executeTakeFirst();
      if (!current) return null;
      const closed = input.status === "completed" || input.status === "rejected";
      const updated = await transaction
        .updateTable("data_deletion_requests")
        .set({
          status: input.status,
          resolution_note: input.note,
          resolved_at: closed ? new Date() : null,
          resolved_by_user_id: closed ? input.actorUserId : null,
          updated_at: new Date(),
        })
        .where("id", "=", current.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("audit_logs")
        .values({
          actor_user_id: input.actorUserId,
          action: "update",
          entity_type: "data_deletion_requests",
          entity_id: publicId,
          old_value: { status: current.status },
          new_value: { status: input.status },
          ip_address: null,
          user_agent: null,
        })
        .execute();
      return updated;
    });
  }
}

export function serializeDataDeletionRequest(row: DataDeletionRequestRecord) {
  return {
    public_id: row.public_id,
    reference: row.reference,
    source: row.source,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    instagram_username: row.instagram_username,
    messenger_psid: row.messenger_psid,
    description: row.description,
    status: row.status,
    resolution_note: row.resolution_note,
    requested_at: new Date(row.requested_at).toISOString(),
    resolved_at: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
  };
}
