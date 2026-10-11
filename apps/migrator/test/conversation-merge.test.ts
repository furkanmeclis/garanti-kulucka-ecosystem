import { describe, expect, it } from "vitest";
import { legacyConversationMergeCandidate, type VerifiedConversationAccount } from "../src/conversation-mapping.js";
import { buildConversationMergePlan, conversationMergeKey } from "../src/conversation-merge.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import type { LegacyRecord } from "../src/types.js";

const accounts: VerifiedConversationAccount[] = [
  { publicId: "iac_whatsapp_main", providerKey: "whatsapp", status: "active", externalAccountId: null },
  { publicId: "iac_instagram_a", providerKey: "instagram", status: "active", externalAccountId: "ig-a" },
  { publicId: "iac_instagram_b", providerKey: "instagram", status: "active", externalAccountId: "ig-b" },
];
const customerA = "0a32ce63-4c3b-4fd4-917d-726d540a7216";
const customerB = "1b43df74-5d4c-4fe5-a28e-837e651b8327";

function conversation(id: string, overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id,
    musteri_id: customerA,
    kanal: "whatsapp",
    kanal_konusma_id: "thread-1",
    atanan_kullanici_id: null,
    durum: "acik",
    son_mesaj_tarihi: "2024-03-04T05:06:07Z",
    okunmamis_sayisi: 1,
    olusturma_tarihi: "2024-03-04T05:00:00Z",
    guncelleme_tarihi: null,
    son_mesaj_text: "Merhaba",
    son_mesaj_gonderici: "musteri",
    ig_account_id: null,
    human_agent: false,
    ...overrides,
  };
  return {
    sourceSystem: "legacy_postgres",
    sourceTable: "public.konusmalar",
    sourceId: id,
    payload,
    checksum: calculateSourcePayloadChecksum(payload),
  };
}

function plan(records: LegacyRecord[]) {
  return buildConversationMergePlan(records.map((record) => legacyConversationMergeCandidate(record, accounts)));
}

const ids = [
  "a0000000-0000-4000-8000-000000000001",
  "a0000000-0000-4000-8000-000000000002",
  "a0000000-0000-4000-8000-000000000003",
  "a0000000-0000-4000-8000-000000000004",
  "a0000000-0000-4000-8000-000000000005",
] as const;

describe("conversation merge plan", () => {
  it("collapses rows sharing an account and external thread into the most recently active winner", () => {
    const result = plan([
      conversation(ids[0], { son_mesaj_tarihi: "2024-03-05T00:00:00Z", okunmamis_sayisi: 2 }),
      conversation(ids[1], { son_mesaj_tarihi: "2024-03-07T00:00:00Z", okunmamis_sayisi: 3 }),
      conversation(ids[2], { son_mesaj_tarihi: null, okunmamis_sayisi: null }),
      conversation(ids[3], { kanal_konusma_id: "thread-2" }),
    ]);

    const winner = legacyConversationMergeCandidate(conversation(ids[1]), accounts);
    expect(result.groupBySourceId.get(ids[0])).toEqual({
      winnerSourceId: ids[1],
      winnerPublicId: winner.publicId,
      memberSourceIds: [ids[0], ids[1], ids[2]],
      channel: "whatsapp",
      unreadCount: 5,
    });
    expect([...result.winnerPublicIdByMergedSourceId]).toEqual([
      [ids[0], winner.publicId],
      [ids[2], winner.publicId],
    ]);
    expect(result.groupBySourceId.has(ids[3])).toBe(false);
    expect(result.summary).toEqual({
      groups: 1,
      memberRows: 3,
      mergedAwayRows: 2,
      largestGroup: 3,
      groupsWithMultipleCustomers: 0,
      byChannel: { whatsapp: { groups: 1, memberRows: 3, mergedAwayRows: 2 } },
    });
  });

  it("breaks activity ties by update time, then creation time, then the greatest legacy id", () => {
    const byUpdate = plan([
      conversation(ids[0], { guncelleme_tarihi: "2024-03-06T00:00:00Z" }),
      conversation(ids[1], { guncelleme_tarihi: "2024-03-05T00:00:00Z" }),
    ]);
    expect(byUpdate.groupBySourceId.get(ids[0])?.winnerSourceId).toBe(ids[0]);

    const byCreation = plan([
      conversation(ids[0], { olusturma_tarihi: "2024-03-01T00:00:00Z" }),
      conversation(ids[1], { olusturma_tarihi: "2024-03-02T00:00:00Z" }),
    ]);
    expect(byCreation.groupBySourceId.get(ids[0])?.winnerSourceId).toBe(ids[1]);

    const byId = plan([conversation(ids[1]), conversation(ids[0])]);
    expect(byId.groupBySourceId.get(ids[0])?.winnerSourceId).toBe(ids[1]);
  });

  it("keys instagram threads by account and accountless threads by channel, like the target unique indexes", () => {
    const result = plan([
      conversation(ids[0], { kanal: "instagram", ig_account_id: "ig-a" }),
      conversation(ids[1], { kanal: "instagram", ig_account_id: "ig-b" }),
      conversation(ids[2], { kanal: "panel", musteri_id: customerB }),
      conversation(ids[3], { kanal: "panel" }),
      conversation(ids[4], { kanal_konusma_id: null }),
    ]);

    expect(result.summary).toMatchObject({
      groups: 1,
      memberRows: 2,
      groupsWithMultipleCustomers: 1,
      byChannel: { manual: { groups: 1, memberRows: 2, mergedAwayRows: 1 } },
    });
    expect(conversationMergeKey({ channel: "whatsapp", integrationAccountPublicId: "iac_x", externalThreadId: null }))
      .toBeNull();
  });

  it("rejects a legacy conversation offered twice", () => {
    expect(() => plan([conversation(ids[0]), conversation(ids[0])])).toThrow(
      `Conversation merge plan received legacy conversation ${ids[0]} twice`,
    );
  });
});
