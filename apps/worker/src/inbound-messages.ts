import { randomUUID } from "node:crypto";
import { sql, type AppDatabase } from "@garanti-kulucka/database";

/**
 * Inbound Meta webhooks → conversations / messages / comments (legacy server.js webhook handlers).
 *
 * The API stores every webhook in `webhook_events` (signature checked there) and queues
 * `provider.webhook.received` with the event public id; this processor turns the stored payload into rows.
 * Idempotent: messages and comments are keyed by their Meta ids, so a redelivered or retried event never
 * duplicates a message or bumps the unread counter twice. Outbound echoes and delivery/read receipts are skipped.
 */
export type InboundChannel = "whatsapp" | "instagram" | "messenger";

export interface InboundMessage {
  channel: InboundChannel;
  /** WhatsApp: the customer's wa_id; Instagram/Messenger: the sender's scoped id (legacy external_thread_id). */
  threadId: string;
  externalMessageId: string;
  senderName: string | null;
  senderPhone: string | null;
  text: string | null;
  sentAt: Date;
  raw: Record<string, unknown>;
}

export interface InboundComment {
  platform: "instagram" | "facebook";
  externalCommentId: string;
  mediaId: string | null;
  postId: string | null;
  username: string | null;
  text: string | null;
  receivedAt: Date;
}

export interface ParsedInboundWebhook {
  messages: InboundMessage[];
  comments: InboundComment[];
  /** Echoes of our own replies, statuses, reads, deliveries and unknown entries. */
  skipped: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Meta timestamps are seconds (WhatsApp, comments) or milliseconds (Messenger/Instagram messaging). */
function timestamp(value: unknown): Date {
  const numeric = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

const mediaLabels: Record<string, string> = {
  image: "[Görsel]",
  video: "[Video]",
  audio: "[Ses]",
  document: "[Belge]",
  file: "[Dosya]",
  sticker: "[Çıkartma]",
  location: "[Konum]",
  contacts: "[Kişi]",
};

function whatsappText(message: Record<string, unknown>): string | null {
  const type = text(message.type) ?? "text";
  if (type === "text") return text(record(message.text).body);
  if (type === "button") return text(record(message.button).text);
  if (type === "interactive") {
    const interactive = record(message.interactive);
    return text(record(interactive.button_reply).title) ?? text(record(interactive.list_reply).title);
  }
  const caption = text(record(message[type]).caption);
  const label = mediaLabels[type] ?? `[${type}]`;
  return caption ? `${label} ${caption}` : label;
}

function messagingText(message: Record<string, unknown>): string | null {
  const body = text(message.text);
  if (body) return body;
  const attachments = list(message.attachments).map(record);
  if (attachments.length === 0) return null;
  return attachments.map((attachment) => mediaLabels[text(attachment.type) ?? "file"] ?? "[Dosya]").join(" ");
}

export function parseInboundWebhook(body: unknown): ParsedInboundWebhook {
  const root = record(body);
  const object = text(root.object);
  const result: ParsedInboundWebhook = { messages: [], comments: [], skipped: 0 };

  for (const entry of list(root.entry).map(record)) {
    if (object === "whatsapp_business_account") {
      for (const change of list(entry.changes).map(record)) {
        const value = record(change.value);
        const ownNumber = (text(record(value.metadata).display_phone_number) ?? "").replace(/\D/g, "");
        const names = new Map(list(value.contacts).map(record).map((contact) => [text(contact.wa_id) ?? "", text(record(contact.profile).name)]));
        result.skipped += list(value.statuses).length;
        for (const message of list(value.messages).map(record)) {
          const from = text(message.from);
          const id = text(message.id);
          if (!from || !id || (ownNumber && from.replace(/\D/g, "") === ownNumber)) {
            result.skipped += 1;
            continue;
          }
          result.messages.push({
            channel: "whatsapp",
            threadId: from,
            externalMessageId: id,
            senderName: names.get(from) ?? null,
            senderPhone: from,
            text: whatsappText(message),
            sentAt: timestamp(message.timestamp),
            raw: message,
          });
        }
      }
      continue;
    }

    if (object === "instagram" || object === "page") {
      const channel: InboundChannel = object === "instagram" ? "instagram" : "messenger";
      for (const event of list(entry.messaging).map(record)) {
        const message = record(event.message);
        const id = text(message.mid);
        const sender = text(record(event.sender).id);
        // Our own replies come back as echoes; reads, deliveries and reactions carry no new customer message.
        if (!id || !sender || message.is_echo === true || message.is_deleted === true) {
          result.skipped += 1;
          continue;
        }
        result.messages.push({
          channel,
          threadId: sender,
          externalMessageId: id,
          senderName: null,
          senderPhone: null,
          text: messagingText(message),
          sentAt: timestamp(event.timestamp),
          raw: event,
        });
      }
      for (const change of list(entry.changes).map(record)) {
        const value = record(change.value);
        const field = text(change.field);
        const commentId = text(value.id) ?? text(value.comment_id);
        const isComment = field === "comments" || (field === "feed" && text(value.item) === "comment" && text(value.verb) === "add");
        if (!isComment || !commentId) {
          result.skipped += 1;
          continue;
        }
        const from = record(value.from);
        result.comments.push({
          platform: object === "instagram" ? "instagram" : "facebook",
          externalCommentId: commentId,
          mediaId: text(record(value.media).id),
          postId: text(value.post_id),
          username: text(from.username) ?? text(from.name),
          text: text(value.text) ?? text(value.message),
          receivedAt: timestamp(value.created_time ?? entry.time),
        });
      }
      continue;
    }

    result.skipped += 1;
  }
  return result;
}

export interface StoredInboundEvent {
  id: number;
  publicId: string;
  providerKey: string;
  accountId: number | null;
  status: string;
  payloadHash: string;
  body: unknown;
}

export interface InboundMessageStore {
  loadEvent: (eventPublicId: string) => Promise<StoredInboundEvent | null>;
  /** Returns true when the message is new (and the unread counter was bumped). */
  storeMessage: (input: { accountId: number | null; message: InboundMessage }) => Promise<boolean>;
  storeComment: (input: { accountId: number | null; comment: InboundComment }) => Promise<boolean>;
  markEvent: (eventId: number, status: "processed" | "ignored") => Promise<void>;
}

export interface InboundWebhookResult {
  queue: "provider-webhooks";
  status: "processed" | "ignored" | "already_processed";
  webhook_event_public_id: string;
  messages_created: number;
  messages_duplicate: number;
  comments_created: number;
  skipped: number;
}

const inboundProviders = new Set(["meta", "whatsapp", "instagram", "messenger"]);

export async function processInboundWebhook(store: InboundMessageStore, eventPublicId: string): Promise<InboundWebhookResult> {
  const event = await store.loadEvent(eventPublicId);
  if (!event) throw new Error(`Webhook event not found: ${eventPublicId}`);
  const base = { queue: "provider-webhooks" as const, webhook_event_public_id: eventPublicId, messages_created: 0, messages_duplicate: 0, comments_created: 0, skipped: 0 };
  if (event.status === "processed" || event.status === "ignored") return { ...base, status: "already_processed" };
  if (!inboundProviders.has(event.providerKey)) {
    await store.markEvent(event.id, "ignored");
    return { ...base, status: "ignored" };
  }

  const parsed = parseInboundWebhook(event.body);
  let created = 0;
  let duplicates = 0;
  let comments = 0;
  // Meta can batch several messages of one thread: oldest first keeps last_message_* on the newest.
  for (const message of [...parsed.messages].sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime())) {
    if (await store.storeMessage({ accountId: event.accountId, message })) created += 1;
    else duplicates += 1;
  }
  for (const comment of parsed.comments) {
    if (await store.storeComment({ accountId: event.accountId, comment })) comments += 1;
  }
  const status = parsed.messages.length + parsed.comments.length > 0 ? "processed" : "ignored";
  await store.markEvent(event.id, status);
  return { ...base, status, messages_created: created, messages_duplicate: duplicates, comments_created: comments, skipped: parsed.skipped };
}

function newPublicId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export class DatabaseInboundMessageStore implements InboundMessageStore {
  constructor(private readonly db: AppDatabase) {}

  async loadEvent(eventPublicId: string): Promise<StoredInboundEvent | null> {
    const row = await this.db
      .selectFrom("webhook_events")
      .innerJoin("integration_providers", "integration_providers.id", "webhook_events.provider_id")
      .select([
        "webhook_events.id",
        "webhook_events.public_id",
        "webhook_events.account_id",
        "webhook_events.status",
        "webhook_events.payload_hash",
        "webhook_events.raw_payload",
        "integration_providers.key as provider_key",
      ])
      .where("webhook_events.public_id", "=", eventPublicId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: Number(row.id),
      publicId: row.public_id,
      providerKey: row.provider_key,
      accountId: row.account_id === null ? null : Number(row.account_id),
      status: row.status,
      payloadHash: row.payload_hash,
      body: record(row.raw_payload).body,
    };
  }

  private async findOrCreateCustomer(db: AppDatabase, message: InboundMessage): Promise<number | null> {
    // Only WhatsApp tells us who the customer is (phone + profile name); IG/Messenger stay anonymous threads.
    if (message.channel !== "whatsapp" || !message.senderPhone) return null;
    const tail = message.senderPhone.replace(/\D/g, "").slice(-10);
    if (tail.length === 10) {
      const existing = await db
        .selectFrom("customers")
        .select("id")
        .where(sql<string>`right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10)`, "=", tail)
        .orderBy("updated_at", "desc")
        .executeTakeFirst();
      if (existing) return Number(existing.id);
    }
    const created = await db
      .insertInto("customers")
      .values({ public_id: newPublicId("cus"), full_name: message.senderName ?? `WhatsApp ${tail.slice(-4)}`, phone: message.senderPhone })
      .returning("id")
      .executeTakeFirstOrThrow();
    return Number(created.id);
  }

  private async lockConversation(db: AppDatabase, accountId: number | null, message: InboundMessage) {
    const find = () =>
      db
        .selectFrom("conversations")
        .select(["id", "customer_id", "last_message_at"])
        .where("external_thread_id", "=", message.threadId)
        .$if(accountId !== null, (builder) => builder.where("integration_account_id", "=", accountId as number))
        .$if(accountId === null, (builder) => builder.where("integration_account_id", "is", null).where("channel", "=", message.channel))
        .forUpdate()
        .executeTakeFirst();
    const existing = await find();
    if (existing) return existing;
    const customerId = await this.findOrCreateCustomer(db, message);
    await db
      .insertInto("conversations")
      .values({
        public_id: newPublicId("cnv"),
        customer_id: customerId,
        channel: message.channel,
        external_thread_id: message.threadId,
        integration_account_id: accountId,
        assigned_user_id: null,
        status: "open",
        is_in_pool: false,
        human_agent_enabled: false,
        unread_count: 0,
        last_message_text: null,
        last_message_sender_type: null,
        last_message_at: null,
        notes: null,
      })
      .onConflict((conflict) => conflict.doNothing())
      .execute();
    const created = await find();
    if (!created) throw new Error(`Conversation could not be created for ${message.channel}:${message.threadId}`);
    return created;
  }

  async storeMessage(input: { accountId: number | null; message: InboundMessage }): Promise<boolean> {
    const { message } = input;
    return this.db.transaction().execute(async (transaction) => {
      const db = transaction as unknown as AppDatabase;
      const conversation = await this.lockConversation(db, input.accountId, message);
      const inserted = await db
        .insertInto("messages")
        .values({
          public_id: newPublicId("msg"),
          conversation_id: conversation.id,
          sender_type: "customer",
          sender_name: message.senderName,
          body: message.text,
          external_message_id: message.externalMessageId,
          is_read: false,
          sent_at: message.sentAt,
          raw_payload: message.raw,
        })
        .onConflict((conflict) => conflict.doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!inserted) return false;
      const lastAt = conversation.last_message_at ? new Date(conversation.last_message_at as Date | string).getTime() : 0;
      const newest = message.sentAt.getTime() >= lastAt;
      await db
        .updateTable("conversations")
        .set({
          unread_count: sql<number>`unread_count + 1`,
          status: "open",
          updated_at: new Date(),
          ...(newest ? { last_message_text: message.text, last_message_sender_type: "customer", last_message_at: message.sentAt } : {}),
        })
        .where("id", "=", conversation.id)
        .execute();
      return true;
    });
  }

  async storeComment(input: { accountId: number | null; comment: InboundComment }): Promise<boolean> {
    const { comment } = input;
    const inserted = await this.db
      .insertInto("social_comments")
      .values({
        public_id: newPublicId("scm"),
        integration_account_id: input.accountId,
        platform: comment.platform,
        external_comment_id: comment.externalCommentId,
        media_id: comment.mediaId,
        post_id: comment.postId,
        username: comment.username,
        text: comment.text,
        status: "pending",
        received_at: comment.receivedAt,
      })
      .onConflict((conflict) => conflict.columns(["platform", "external_comment_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    return Boolean(inserted);
  }

  async markEvent(eventId: number, status: "processed" | "ignored"): Promise<void> {
    await this.db.updateTable("webhook_events").set({ status, processed_at: new Date(), updated_at: new Date() }).where("id", "=", eventId).execute();
  }
}
