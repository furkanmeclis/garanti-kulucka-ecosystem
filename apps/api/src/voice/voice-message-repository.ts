import { sql, type AppDatabase, type Selectable } from "@garanti-kulucka/database";
import type { VoiceMessagesTable } from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";

export type VoiceMessageRecord = Selectable<VoiceMessagesTable>;

export interface ProviderAttemptOutcome {
  status: string;
  response_metadata: unknown;
  error_message: string | null;
}

export interface PhonebookEntry {
  kind: "customer" | "staff";
  public_id: string;
  name: string;
  phone: string | null;
  extension: string | null;
  role: string | null;
}

function searchPattern(search: string | undefined) {
  const trimmed = search?.trim();
  return trimmed ? `%${trimmed.replace(/[\\%_]/g, (match) => `\\${match}`)}%` : null;
}

/** Voice messages (legacy SesliMesajlarPage) and the phonebook (legacy RehberPage). */
export class VoiceMessageRepository {
  constructor(private readonly db: AppDatabase) {}

  async activeAccountPublicId(providerKey: string): Promise<string | null> {
    const row = await this.db
      .selectFrom("integration_accounts")
      .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
      .select("integration_accounts.public_id")
      .where("integration_providers.key", "=", providerKey)
      .where("integration_accounts.status", "=", "active")
      .orderBy("integration_accounts.id", "asc")
      .executeTakeFirst();
    return row?.public_id ?? null;
  }

  async findByIdempotencyKey(key: string) {
    return (await this.db.selectFrom("voice_messages").selectAll().where("idempotency_key", "=", key).executeTakeFirst()) ?? null;
  }

  async get(publicId: string) {
    return (await this.db.selectFrom("voice_messages").selectAll().where("public_id", "=", publicId).executeTakeFirst()) ?? null;
  }

  async create(input: { recipients: string[]; messageText: string | null; audioId: string | null; ringtime: number; requestId: string; idempotencyKey: string; actorUserId: number | null }) {
    return this.db
      .insertInto("voice_messages")
      .values({
        public_id: newPublicId("vms"),
        recipients: JSON.stringify(input.recipients),
        recipient_count: input.recipients.length,
        message_text: input.messageText,
        audio_id: input.audioId,
        ringtime: input.ringtime,
        bulk_id: null,
        error_message: null,
        request_id: input.requestId,
        job_id: null,
        report_request_id: null,
        report: null,
        report_checked_at: null,
        idempotency_key: input.idempotencyKey,
        created_by_user_id: input.actorUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(id: number, changes: Partial<Pick<VoiceMessageRecord, "status" | "bulk_id" | "error_message" | "job_id" | "report_request_id" | "report" | "report_checked_at">>) {
    const values: Record<string, unknown> = { ...changes, updated_at: new Date() };
    if (changes.report !== undefined && changes.report !== null) values.report = JSON.stringify(changes.report);
    return this.db.updateTable("voice_messages").set(values).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
  }

  async list(filter: { status?: string | undefined; search?: string | undefined; limit: number; offset: number }) {
    const pattern = searchPattern(filter.search);
    let query = this.db.selectFrom("voice_messages");
    if (filter.status) query = query.where("status", "=", filter.status);
    if (pattern) {
      query = query.where((eb) =>
        eb.or([eb("message_text", "ilike", pattern), eb("bulk_id", "ilike", pattern), eb(sql<string>`recipients::text`, "ilike", pattern)]),
      );
    }
    const [rows, totals] = await Promise.all([
      query.selectAll().orderBy("created_at", "desc").orderBy("id", "desc").limit(filter.limit).offset(filter.offset).execute(),
      query
        .select((eb) => [eb.fn.countAll<number>().as("total_count"), sql<number>`coalesce(sum(recipient_count), 0)`.as("recipient_total")])
        .executeTakeFirst(),
    ]);
    return { rows, total_count: Number(totals?.total_count ?? 0), recipient_total: Number(totals?.recipient_total ?? 0) };
  }

  async latestAttempt(requestId: string): Promise<ProviderAttemptOutcome | null> {
    const row = await this.db
      .selectFrom("provider_attempts")
      .select(["status", "response_metadata", "error_message"])
      .where("request_id", "=", requestId)
      .orderBy("started_at", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    return row ?? null;
  }

  /** Legacy RehberPage: NetGSM has no phonebook API, so the book is built from customers + staff SIP extensions. */
  async phonebook(filter: { search?: string | undefined; kind?: "customer" | "staff" | undefined; limit: number; offset: number }) {
    const pattern = searchPattern(filter.search);
    const customers = this.db
      .selectFrom("customers")
      .select([
        sql<string>`'customer'`.as("kind"),
        "public_id",
        "full_name as name",
        "phone",
        sql<string | null>`null::text`.as("extension"),
        sql<string | null>`null::text`.as("role"),
      ])
      .where("phone", "is not", null)
      .$if(Boolean(pattern), (qb) => qb.where((eb) => eb.or([eb("full_name", "ilike", pattern as string), eb("phone", "ilike", pattern as string)])));
    const staff = this.db
      .selectFrom("users")
      .innerJoin("roles", "roles.id", "users.role_id")
      .select([
        sql<string>`'staff'`.as("kind"),
        "users.public_id",
        sql<string>`trim(users.first_name || ' ' || users.last_name)`.as("name"),
        "users.phone",
        "users.sip_username as extension",
        "roles.name as role",
      ])
      .where("users.is_active", "=", true)
      .where((eb) => eb.or([eb("users.sip_username", "is not", null), eb("users.phone", "is not", null)]))
      .$if(Boolean(pattern), (qb) =>
        qb.where((eb) =>
          eb.or([
            eb(sql<string>`users.first_name || ' ' || users.last_name`, "ilike", pattern as string),
            eb("users.phone", "ilike", pattern as string),
            eb("users.sip_username", "ilike", pattern as string),
          ]),
        ),
      );
    // Both halves select the same columns; the cast gives Kysely one query type to wrap as a subquery.
    const union = (filter.kind === "customer" ? customers : filter.kind === "staff" ? staff : customers.unionAll(staff)) as typeof customers;
    const rows = await this.db
      .selectFrom(union.as("book"))
      .selectAll()
      .orderBy("kind", "desc")
      .orderBy("name", "asc")
      .limit(filter.limit)
      .offset(filter.offset)
      .execute();
    const count = await this.db.selectFrom(union.as("book")).select(sql<string>`count(*)`.as("total")).executeTakeFirst();
    return { rows: rows as PhonebookEntry[], total_count: Number(count?.total ?? 0) };
  }
}
