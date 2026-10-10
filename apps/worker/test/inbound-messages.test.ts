import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import {
  parseInboundWebhook,
  processInboundWebhook,
  type InboundComment,
  type InboundMessage,
  type InboundMessageStore,
  type StoredInboundEvent,
} from "../src/inbound-messages.js";

const fixture = (provider: string, name: string) =>
  JSON.parse(readFileSync(new URL(`../../../contracts/providers/${provider}/fixtures/inbound/${name}`, import.meta.url), "utf8")) as unknown;

/** In-memory store with the same idempotency rules as the database (message / comment ids are unique). */
function memoryStore(events: StoredInboundEvent[]) {
  const messages = new Map<string, InboundMessage>();
  const comments = new Map<string, InboundComment>();
  const unread = new Map<string, number>();
  const store: InboundMessageStore = {
    loadEvent: async (publicId) => events.find((event) => event.publicId === publicId) ?? null,
    storeMessage: async ({ message }) => {
      if (messages.has(message.externalMessageId)) return false;
      messages.set(message.externalMessageId, message);
      unread.set(message.threadId, (unread.get(message.threadId) ?? 0) + 1);
      return true;
    },
    storeComment: async ({ comment }) => {
      const key = `${comment.platform}:${comment.externalCommentId}`;
      if (comments.has(key)) return false;
      comments.set(key, comment);
      return true;
    },
    markEvent: async (id, status) => {
      const event = events.find((item) => item.id === id);
      if (event) event.status = status;
    },
  };
  return { store, messages, comments, unread };
}

function event(id: number, providerKey: string, body: unknown): StoredInboundEvent {
  return { id, publicId: `wev_${id}`, providerKey, accountId: null, status: "received", payloadHash: "hash", body };
}

describe("inbound Meta webhook parsing", () => {
  it("reads WhatsApp text and media, the profile name, and skips delivery statuses", () => {
    const parsed = parseInboundWebhook(fixture("whatsapp", "text_image_status.json"));
    expect(parsed.skipped).toBe(1);
    expect(parsed.messages).toMatchObject([
      { channel: "whatsapp", threadId: "905551112233", externalMessageId: "wamid.FIXTURE_TEXT_1", senderName: "Fixture Müşteri", senderPhone: "905551112233", text: "Merhaba, kuluçka makinesi fiyatı nedir?" },
      { externalMessageId: "wamid.FIXTURE_IMAGE_1", text: "[Görsel] Bu model" },
    ]);
    expect(parsed.messages[0]!.sentAt.toISOString()).toBe(new Date(1791648000 * 1000).toISOString());
  });

  it("reads Instagram DMs and comments but never our own echoes or read receipts", () => {
    const parsed = parseInboundWebhook(fixture("instagram", "dm_echo_comment.json"));
    expect(parsed.messages.map((message) => message.externalMessageId)).toEqual(["aWdfZAG1fixture_dm_1"]);
    expect(parsed.messages[0]).toMatchObject({ channel: "instagram", threadId: "IGSID_FIXTURE_CUSTOMER", text: "Kargom ne zaman gelir?" });
    expect(parsed.comments).toMatchObject([{ platform: "instagram", externalCommentId: "17900000000000001", username: "fixture.kullanici", text: "Fiyat nedir?", mediaId: "17800000000000001" }]);
    expect(parsed.skipped).toBe(2);
  });

  it("labels Messenger attachments and skips delivery events", () => {
    const parsed = parseInboundWebhook(fixture("messenger", "dm_attachment_delivery.json"));
    expect(parsed.messages).toMatchObject([{ channel: "messenger", threadId: "PSID_FIXTURE_CUSTOMER", externalMessageId: "m_fixture_messenger_1", text: "[Görsel]" }]);
    expect(parsed.skipped).toBe(1);
  });

  it("ignores unknown payload shapes", () => {
    expect(parseInboundWebhook({ object: "unknown", entry: [{}] })).toEqual({ messages: [], comments: [], skipped: 1 });
    expect(parseInboundWebhook("not json")).toEqual({ messages: [], comments: [], skipped: 0 });
  });
});

describe("inbound webhook processing", () => {
  it("stores messages and comments once, even when Meta redelivers the same payload as a new event", async () => {
    const events = [event(1, "instagram", fixture("instagram", "dm_echo_comment.json")), event(2, "instagram", fixture("instagram", "dm_echo_comment.json"))];
    const memory = memoryStore(events);
    await expect(processInboundWebhook(memory.store, "wev_1")).resolves.toMatchObject({ status: "processed", messages_created: 1, comments_created: 1, skipped: 2 });
    await expect(processInboundWebhook(memory.store, "wev_2")).resolves.toMatchObject({ status: "processed", messages_created: 0, messages_duplicate: 1, comments_created: 0 });
    // A retried job of an already processed event does nothing.
    await expect(processInboundWebhook(memory.store, "wev_1")).resolves.toMatchObject({ status: "already_processed" });
    expect(memory.unread.get("IGSID_FIXTURE_CUSTOMER")).toBe(1);
  });

  it("marks receipts-only and non-Meta events ignored and fails loudly for a missing event", async () => {
    const events = [event(1, "messenger", { object: "page", entry: [{ messaging: [{ sender: { id: "x" }, delivery: {} }] }] }), event(2, "netgsm", {})];
    const memory = memoryStore(events);
    await expect(processInboundWebhook(memory.store, "wev_1")).resolves.toMatchObject({ status: "ignored" });
    await expect(processInboundWebhook(memory.store, "wev_2")).resolves.toMatchObject({ status: "ignored" });
    expect(events.map((item) => item.status)).toEqual(["ignored", "ignored"]);
    await expect(processInboundWebhook(memory.store, "wev_missing")).rejects.toThrow("Webhook event not found");
  });

  it("routes the API's provider.webhook.received job to the inbound processor instead of dead-lettering it", async () => {
    const memory = memoryStore([event(7, "whatsapp", fixture("whatsapp", "text_image_status.json"))]);
    const registry = createWorkerProcessorRegistry({ inboundMessageStore: memory.store });
    const job = {
      id: "bull_webhook_7",
      name: "provider.webhook.received",
      data: {
        job_id: "job_webhook_7",
        queue: "provider-webhooks" as const,
        name: "provider.webhook.received",
        requested_at: new Date().toISOString(),
        payload: { webhook_event_public_id: "wev_7", provider: "whatsapp", account_public_id: null, payload_hash: "hash", event_type: "message", external_event_id: "wamid.FIXTURE_TEXT_1" },
      },
    };
    await expect(registry.dispatch("provider-webhooks", job)).resolves.toMatchObject({ status: "processed", messages_created: 2 });
    await expect(createWorkerProcessorRegistry().dispatch("provider-webhooks", job)).rejects.toThrow("requires a database-backed store");
  });
});
