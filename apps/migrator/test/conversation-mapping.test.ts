import { describe, expect, it } from "vitest";
import {
  transformLegacyConversation,
  transformLegacyMessage,
  type ConversationTransformContext,
  type MessageTransformContext,
  type VerifiedConversationAccount,
} from "../src/conversation-mapping.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import type { LegacyRecord } from "../src/types.js";

const conversationId = "6F1C2B3A-4D5E-4F60-8172-93A4B5C6D7E8";
const messageId = "1A2B3C4D-5E6F-4A7B-8C9D-0E1F2A3B4C5D";
const customerId = "0a32ce63-4c3b-4fd4-917d-726d540a7216";
const userId = "b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e";
const customerPublicId = "cus_0123456789abcdef01234567";
const conversationPublicId = "conv_89abcdef0123456789abcdef";
const secretBody = "Kargom nerede? Telefonum +90 555 000 00 01";

const accounts: VerifiedConversationAccount[] = [
  { publicId: "iac_whatsapp_main", providerKey: "whatsapp", status: "active", externalAccountId: null },
  { publicId: "iac_messenger_main", providerKey: "messenger", status: "active", externalAccountId: "fb-page-1" },
  { publicId: "iac_instagram_a", providerKey: "instagram", status: "active", externalAccountId: "ig-17841" },
  { publicId: "iac_instagram_b", providerKey: "instagram", status: "active", externalAccountId: "ig-99999" },
  { publicId: "iac_instagram_old", providerKey: "instagram", status: "inactive", externalAccountId: "ig-00001" },
];

function conversationContext(overrides: Partial<ConversationTransformContext> = {}): ConversationTransformContext {
  return {
    customerPublicIds: new Map([[customerId, customerPublicId]]),
    userPublicIds: new Map([[userId, "usr_agent_1"]]),
    accounts,
    ...overrides,
  };
}

const messageContext: MessageTransformContext = {
  conversationPublicIds: new Map([[conversationId.toLowerCase(), conversationPublicId]]),
};

function record(sourceTable: string, id: string, payload: Record<string, unknown>): LegacyRecord {
  return {
    sourceSystem: "legacy_supabase",
    sourceTable,
    sourceId: id.toLowerCase(),
    checksum: calculateSourcePayloadChecksum(payload),
    payload,
  };
}

function conversation(overrides: Record<string, unknown> = {}): LegacyRecord {
  return record("public.konusmalar", conversationId, {
    id: conversationId,
    musteri_id: customerId.toUpperCase(),
    kanal: "whatsapp",
    kanal_konusma_id: "wa-thread-1",
    atanan_kullanici_id: userId,
    durum: "acik",
    son_mesaj_tarihi: "2024-03-04T05:06:07.1234+03:00",
    okunmamis_sayisi: 3,
    olusturma_tarihi: new Date("2024-01-02T03:04:05.678Z"),
    guncelleme_tarihi: null,
    son_mesaj_text: "Merhaba",
    son_mesaj_gonderici: "musteri",
    ig_account_id: null,
    human_agent: true,
    ...overrides,
  });
}

function message(overrides: Record<string, unknown> = {}): LegacyRecord {
  return record("public.mesajlar", messageId, {
    id: messageId,
    konusma_id: conversationId,
    gonderici_tipi: "musteri",
    gonderici_id: null,
    icerik: secretBody,
    medya_url: null,
    medya_tipi: null,
    kanal_mesaj_id: "wamid.1",
    okundu: null,
    olusturma_tarihi: "2024-03-04 05:06:07+00",
    ...overrides,
  });
}

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected operation to throw");
}

describe("transformLegacyConversation", () => {
  it("maps a resolved whatsapp conversation with UTC six-digit timestamps", () => {
    const result = transformLegacyConversation(conversation(), conversationContext());

    expect(result.sourcePayloadChecksum).toBe(conversation().checksum);
    expect(result.reconciliation).toEqual([]);
    expect(result.conversation).toEqual({
      kind: "legacy_conversation_draft",
      targetTable: "conversations",
      publicId: expect.stringMatching(/^conv_[0-9a-f]{24}$/),
      mappingRole: "primary",
      customerPublicId,
      assignedUserPublicId: "usr_agent_1",
      integrationAccountPublicId: "iac_whatsapp_main",
      channel: "whatsapp",
      external_thread_id: "wa-thread-1",
      status: "open",
      is_in_pool: false,
      human_agent_enabled: true,
      unread_count: 3,
      last_message_text: "Merhaba",
      last_message_sender_type: "customer",
      last_message_at: "2024-03-04T02:06:07.123400Z",
      legacyTimestamps: { createdAt: "2024-01-02T03:04:05.678000Z", updatedAt: null },
    });
    expect(transformLegacyConversation(conversation(), conversationContext()).conversation.publicId)
      .toBe(result.conversation.publicId);
  });

  it.each([
    ["whatsapp", "whatsapp"],
    ["messenger", "messenger"],
    ["instagram", "instagram"],
    ["panel", "manual"],
  ])("maps kanal %s to channel %s", (kanal, channel) => {
    const igAccountId = kanal === "instagram" ? "ig-17841" : null;
    expect(transformLegacyConversation(conversation({ kanal, ig_account_id: igAccountId }), conversationContext())
      .conversation.channel).toBe(channel);
  });

  it("maps every legacy value into the canonical channel and sender sets", () => {
    const canonicalChannels = ["whatsapp", "instagram", "messenger", "phone", "manual"];
    const canonicalSenders = ["customer", "user", "ai", "system"];
    for (const kanal of ["whatsapp", "messenger", "instagram", "panel"]) {
      for (const sender of ["musteri", "calisan", "ai"]) {
        const { conversation: draft } = transformLegacyConversation(conversation({
          kanal,
          ig_account_id: kanal === "instagram" ? "ig-17841" : null,
          son_mesaj_gonderici: sender,
        }), conversationContext());
        expect(canonicalChannels).toContain(draft.channel);
        expect(canonicalSenders).toContain(draft.last_message_sender_type);
      }
    }
    for (const sender of ["musteri", "calisan", "ai"]) {
      const { message: draft } = transformLegacyMessage(message({ gonderici_tipi: sender }), messageContext);
      expect(canonicalSenders).toContain(draft.sender_type);
    }
  });

  it.each([
    [null, "open"],
    ["acik", "open"],
    ["beklemede", "pending"],
    ["kapali", "closed"],
  ])("maps durum %s to status %s", (durum, status) => {
    expect(transformLegacyConversation(conversation({ durum }), conversationContext()).conversation.status)
      .toBe(status);
  });

  it.each([
    [null, null],
    ["musteri", "customer"],
    ["calisan", "user"],
    ["ai", "ai"],
  ])("maps son_mesaj_gonderici %s to %s", (sender, mapped) => {
    const result = transformLegacyConversation(conversation({ son_mesaj_gonderici: sender }), conversationContext());
    expect(result.conversation.last_message_sender_type).toBe(mapped);
  });

  it.each([
    ["kanal", "telegram"],
    ["kanal", "WhatsApp"],
    ["durum", "open"],
    ["durum", " acik"],
    ["kanal", "manual"],
    ["kanal", "phone"],
    ["son_mesaj_gonderici", "system"],
    ["son_mesaj_gonderici", "user"],
    ["son_mesaj_gonderici", "staff"],
  ])("fails closed on unknown %s value %s", (field, value) => {
    expect(() => transformLegacyConversation(conversation({ [field]: value }), conversationContext()))
      .toThrow(`Invalid legacy conversation row: field ${field} has an unsupported value`);
  });

  it.each([null, "", "   "])("fails when musteri_id is %j", (musteriId) => {
    expect(() => transformLegacyConversation(conversation({ musteri_id: musteriId }), conversationContext()))
      .toThrow("Invalid legacy conversation row: field musteri_id is required");
  });

  it("fails when musteri_id is absent from the payload or unresolved", () => {
    const { musteri_id: _omitted, ...payload } = conversation().payload;
    expect(() => transformLegacyConversation(record("public.konusmalar", conversationId, payload), conversationContext()))
      .toThrow("Invalid legacy conversation row: payload is missing required fields [musteri_id]");
    expect(() => transformLegacyConversation(conversation(), conversationContext({ customerPublicIds: new Map() })))
      .toThrow("Invalid legacy conversation row: field musteri_id does not resolve to a migrated customer");
  });

  it("puts an unassigned conversation in the pool without reconciliation", () => {
    const result = transformLegacyConversation(conversation({ atanan_kullanici_id: null }), conversationContext());
    expect(result.conversation).toMatchObject({ assignedUserPublicId: null, is_in_pool: true });
    expect(result.reconciliation).toEqual([]);
  });

  it("keeps a row with an unresolved assignee and records reconciliation", () => {
    const result = transformLegacyConversation(
      conversation({ atanan_kullanici_id: userId.toUpperCase() }),
      conversationContext({ userPublicIds: new Map() }),
    );
    expect(result.conversation).toMatchObject({ assignedUserPublicId: null, is_in_pool: false });
    expect(result.reconciliation).toEqual([{ code: "unresolved_assigned_user", legacyUserId: userId }]);
  });

  it("resolves an instagram conversation to the single active account with the matching external id", () => {
    const result = transformLegacyConversation(
      conversation({ kanal: "instagram", ig_account_id: "ig-99999" }),
      conversationContext(),
    );
    expect(result.conversation).toMatchObject({
      channel: "instagram",
      integrationAccountPublicId: "iac_instagram_b",
    });
  });

  it.each([
    ["no account matches", "ig-unknown"],
    ["only an inactive account matches", "ig-00001"],
    ["ig_account_id is null", null],
  ])("fails an instagram conversation when %s", (_case, igAccountId) => {
    const error = captureError(() => transformLegacyConversation(
      conversation({ kanal: "instagram", ig_account_id: igAccountId }),
      conversationContext(),
    ));
    expect(error.message).toBe(
      "Invalid legacy conversation row: no active instagram integration account matches the conversation",
    );
    if (igAccountId) expect(error.message).not.toContain(igAccountId);
  });

  it("fails an instagram conversation when several active accounts match", () => {
    const duplicated: VerifiedConversationAccount[] = [
      ...accounts,
      { publicId: "iac_instagram_c", providerKey: "instagram", status: "active", externalAccountId: "ig-17841" },
    ];
    expect(() => transformLegacyConversation(
      conversation({ kanal: "instagram", ig_account_id: "ig-17841" }),
      conversationContext({ accounts: duplicated }),
    )).toThrow("Invalid legacy conversation row: several active instagram integration accounts match the conversation");
  });

  it.each(["whatsapp", "messenger", "panel"])("rejects ig_account_id on a %s conversation", (kanal) => {
    const error = captureError(() => transformLegacyConversation(
      conversation({ kanal, ig_account_id: "ig-17841" }),
      conversationContext(),
    ));
    expect(error.message).toBe(
      "Invalid legacy conversation row: field ig_account_id is only allowed for instagram conversations",
    );
    expect(error.message).not.toContain("ig-17841");
  });

  it("stores a panel conversation as manual with no integration account even without any accounts", () => {
    const result = transformLegacyConversation(conversation({ kanal: "panel" }), conversationContext({ accounts: [] }));
    expect(result.conversation).toMatchObject({ channel: "manual", integrationAccountPublicId: null });
  });

  it.each([
    ["whatsapp", "no active whatsapp integration account was supplied in MIGRATION_CONVERSATION_ACCOUNTS_FILE", []],
    ["messenger", "no active messenger integration account was supplied in MIGRATION_CONVERSATION_ACCOUNTS_FILE", [
      { publicId: "iac_messenger_old", providerKey: "messenger", status: "inactive", externalAccountId: null },
    ]],
    ["whatsapp", "several active whatsapp integration accounts match the conversation", [
      { publicId: "iac_wa_1", providerKey: "whatsapp", status: "active", externalAccountId: null },
      { publicId: "iac_wa_2", providerKey: "whatsapp", status: "active", externalAccountId: null },
    ]],
  ] as const)("requires exactly one active %s account (%s)", (kanal, reason, snapshot) => {
    expect(() => transformLegacyConversation(conversation({ kanal }), conversationContext({ accounts: snapshot })))
      .toThrow(`Invalid legacy conversation row: ${reason}`);
  });

  it.each([
    ["whatsapp", null],
    ["messenger", null],
    ["instagram", "ig-17841"],
  ] as const)("names the accounts file when no active %s account is supplied", (kanal, igAccountId) => {
    const error = captureError(() => transformLegacyConversation(
      conversation({
        kanal,
        ig_account_id: igAccountId,
        kanal_konusma_id: "thread-ext-4242",
        son_mesaj_text: secretBody,
      }),
      conversationContext({ accounts: [] }),
    ));
    expect(error.message).toBe(
      `Invalid legacy conversation row: no active ${kanal} integration account was supplied in MIGRATION_CONVERSATION_ACCOUNTS_FILE`,
    );
    expect(error.message).not.toContain(secretBody);
    expect(error.message).not.toContain("thread-ext-4242");
    expect(error.message).not.toContain("ig-17841");
  });

  it("defaults null human_agent and okunmamis_sayisi", () => {
    const result = transformLegacyConversation(
      conversation({ human_agent: null, okunmamis_sayisi: null }),
      conversationContext(),
    );
    expect(result.conversation).toMatchObject({ human_agent_enabled: false, unread_count: 0 });
  });

  it.each([-1, 1.5, "3"])("rejects okunmamis_sayisi %j", (count) => {
    expect(() => transformLegacyConversation(conversation({ okunmamis_sayisi: count }), conversationContext()))
      .toThrow("Invalid legacy conversation row: field okunmamis_sayisi must be a non-negative integer or null");
  });

  it("rejects an invalid timestamp with the conversation row error", () => {
    expect(() => transformLegacyConversation(conversation({ son_mesaj_tarihi: "2024-02-30T00:00:00Z" }), conversationContext()))
      .toThrow("Invalid legacy conversation row: field son_mesaj_tarihi must be a valid timestamp or null");
  });

  it("fails closed on unknown payload fields", () => {
    expect(() => transformLegacyConversation(conversation({ extra: 1 }), conversationContext()))
      .toThrow("Invalid legacy conversation row: payload contains unknown fields");
  });

  it("fails when the source payload checksum does not match", () => {
    const tampered = { ...conversation(), payload: { ...conversation().payload, okunmamis_sayisi: 4 } };
    expect(() => transformLegacyConversation(tampered, conversationContext()))
      .toThrow("Invalid legacy conversation row: source payload checksum does not match payload");
  });

  it("rejects an account snapshot with an illegal provider", () => {
    const snapshot = [{ publicId: "iac_x", providerKey: "woocommerce", status: "active", externalAccountId: null }];
    expect(() => transformLegacyConversation(
      conversation(),
      conversationContext({ accounts: snapshot as unknown as VerifiedConversationAccount[] }),
    )).toThrow("Invalid conversation account snapshot: account at index 0 has an unknown provider");
  });
});

describe("transformLegacyMessage", () => {
  it("maps a message without media to a null raw payload", () => {
    const result = transformLegacyMessage(message(), messageContext);

    expect(result.sourcePayloadChecksum).toBe(message().checksum);
    expect(result.message).toEqual({
      kind: "legacy_message_draft",
      targetTable: "messages",
      publicId: expect.stringMatching(/^msg_[0-9a-f]{24}$/),
      mappingRole: "primary",
      conversationPublicId,
      sender_type: "customer",
      body: secretBody,
      external_message_id: "wamid.1",
      is_read: false,
      sentAt: "2024-03-04T05:06:07.000000Z",
      rawPayload: null,
    });
  });

  it.each([
    ["musteri", "customer"],
    ["calisan", "user"],
    ["ai", "ai"],
  ])("maps gonderici_tipi %s to %s", (sender, mapped) => {
    expect(transformLegacyMessage(message({ gonderici_tipi: sender }), messageContext).message.sender_type)
      .toBe(mapped);
  });

  it.each([null, "system", "user", "staff"])("rejects gonderici_tipi %j", (sender) => {
    expect(() => transformLegacyMessage(message({ gonderici_tipi: sender }), messageContext))
      .toThrow("Invalid legacy message row: field gonderici_tipi has an unsupported value");
  });

  it("preserves media fields and sender id in rawPayload without attachment rows", () => {
    const result = transformLegacyMessage(message({
      medya_url: "https://cdn.example.test/a.jpg",
      medya_tipi: "image",
      gonderici_id: userId.toUpperCase(),
      okundu: true,
    }), messageContext);

    expect(result.message.rawPayload).toEqual({
      media_url: "https://cdn.example.test/a.jpg",
      media_type: "image",
      medya_url: "https://cdn.example.test/a.jpg",
      medya_tipi: "image",
      gonderici_id: userId,
    });
    expect(result.message.is_read).toBe(true);
    expect(result).not.toHaveProperty("attachments");
    expect(transformLegacyMessage(message({ medya_tipi: "audio" }), messageContext).message.rawPayload)
      .toEqual({ media_type: "audio", medya_tipi: "audio" });
  });

  it("keeps an empty body and rejects a null body", () => {
    expect(transformLegacyMessage(message({ icerik: "" }), messageContext).message.body).toBe("");
    expect(() => transformLegacyMessage(message({ icerik: null }), messageContext))
      .toThrow("Invalid legacy message row: field icerik must be a string");
  });

  it("requires a resolvable konusma_id", () => {
    expect(() => transformLegacyMessage(message({ konusma_id: null }), messageContext))
      .toThrow("Invalid legacy message row: field konusma_id is required");
    expect(() => transformLegacyMessage(message(), { conversationPublicIds: new Map() }))
      .toThrow("Invalid legacy message row: field konusma_id does not resolve to a migrated conversation");
  });

  it("requires olusturma_tarihi as sentAt", () => {
    expect(() => transformLegacyMessage(message({ olusturma_tarihi: null }), messageContext))
      .toThrow("Invalid legacy message row: field olusturma_tarihi is required");
  });

  it("fails when the source payload checksum does not match", () => {
    const tampered = { ...message(), payload: { ...message().payload, icerik: "changed" } };
    expect(() => transformLegacyMessage(tampered, messageContext))
      .toThrow("Invalid legacy message row: source payload checksum does not match payload");
  });

  it("does not echo the message body in row errors", () => {
    const errors = [
      captureError(() => transformLegacyMessage(message({ gonderici_tipi: secretBody }), messageContext)),
      captureError(() => transformLegacyMessage(message({ okundu: secretBody }), messageContext)),
      captureError(() => transformLegacyMessage(message({ olusturma_tarihi: secretBody }), messageContext)),
      captureError(() => transformLegacyMessage(message({ konusma_id: secretBody }), messageContext)),
      captureError(() => transformLegacyMessage(
        { ...message(), payload: { ...message().payload, icerik: `${secretBody}!` } },
        messageContext,
      )),
    ];
    for (const error of errors) {
      expect(error.message).toMatch(/^Invalid legacy message row: /);
      expect(error.message).not.toContain(secretBody);
      expect(error.message).not.toContain("555");
    }
  });

  it("accepts media_url as preferred live media and still fails closed on unknown extras", () => {
    const result = transformLegacyMessage(message({
      media_url: "https://cdn.example.test/live.jpg",
      medya_url: "https://cdn.example.test/old.jpg",
    }), messageContext);
    expect(result.message.rawPayload).toMatchObject({ media_url: "https://cdn.example.test/live.jpg" });
    expect(result.warnings).toEqual([{ code: "media_field_conflict", fields: ["media_url", "medya_url"] }]);
    expect(() => transformLegacyMessage(message({ unexpected_media: "https://cdn.example.test/a.jpg" }), messageContext))
      .toThrow("Invalid legacy message row: payload contains unknown fields");
  });
});
