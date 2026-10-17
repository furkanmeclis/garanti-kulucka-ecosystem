import { describe, expect, it, vi } from "vitest";
import { createMigrationPlan } from "../src/plan.js";
import { validateCommunicationBatches } from "../src/communication-dry-run.js";
import { communicationTableMappings } from "../src/communication-catalog.js";
import { validateLegacyTableColumns } from "../src/mapping-catalog.js";
import { transformLegacyCommunication } from "../src/communication-mapping.js";
import { communicationFixture, inlineShortcutMedia, remoteShortcutMedia } from "./communication-fixtures.js";
import type { LegacySource } from "../src/types.js";

describe("legacy shortcut/SMS/VAPI contracts", () => {
  it("preserves inactive shortcut, order, type, text and timestamps", () => {
    const row = communicationFixture("message_shortcuts", { medyalar: [inlineShortcutMedia, remoteShortcutMedia] });
    const draft = transformLegacyCommunication(row, "message_shortcuts");
    expect(draft.record.payload).toMatchObject({ code: "ss", message: "Legacy text", is_active: false, sort_order: 7, type: "default" });
    expect(draft.createdAt).toContain("123456");
    expect(draft.media.map((m) => m.inlineBytes)).toEqual([5, 0]);
    expect(transformLegacyCommunication(row, "message_shortcuts")).toEqual(draft);
  });
  it.each(["sms_messages", "vapi_calls"] as const)("maps observed %s status, fails closed on unknown values", (entity) => {
    expect(transformLegacyCommunication(communicationFixture(entity), entity).record.payload.status)
      .toBe(entity === "sms_messages" ? "sent" : "basladi");
    expect(() => transformLegacyCommunication(communicationFixture(entity, { durum: "unknown-sensitive-value" }), entity))
      .toThrow("field durum has an unsupported value");
    expect(() => transformLegacyCommunication(communicationFixture(entity, { durum: null }), entity)).toThrow("unsupported value");
  });
  it("preserves VAPI JSON transcript, duration and decimal cost without float conversion", () => {
    const transcript = [{ role: "user", message: "fixture" }];
    expect(transformLegacyCommunication(communicationFixture("vapi_calls", { transkript: transcript, sure_sn: 42, maliyet: "0.1234" }), "vapi_calls").record.payload)
      .toMatchObject({ transcript, duration_seconds: 42, cost: "0.1234", queued: false });
  });
  it.each(communicationTableMappings)("rejects column drift for $sourceTable", (mapping) => {
    const columns = mapping.columns.map((c, i) => ({ ...c, ordinalPosition: i + 1 }));
    expect(() => validateLegacyTableColumns(mapping.sourceTable, columns, mapping)).not.toThrow();
    expect(() => validateLegacyTableColumns(mapping.sourceTable, columns.slice(1), mapping)).toThrow();
    expect(() => validateLegacyTableColumns(mapping.sourceTable, [...columns, { name: "unknown", dataType: "text", udtName: "text", nullable: true, ordinalPosition: 100 }], mapping)).toThrow();
  });
  it("rejects missing/unknown fields, checksum drift and invalid source ids", () => {
    for (const overrides of [{ extra: "hidden" }, { id: "invalid" }]) {
      expect(() => transformLegacyCommunication(communicationFixture("sms_messages", overrides), "sms_messages")).toThrow();
    }
    const row = communicationFixture("sms_messages");
    expect(() => transformLegacyCommunication({ ...row, checksum: "sha256:invalid" }, "sms_messages")).toThrow("checksum mismatch");
  });
  it.each([
    { ...inlineShortcutMedia, base64: "invalid!!" },
    { ...inlineShortcutMedia, previewUrl: remoteShortcutMedia.previewUrl },
    { ...remoteShortcutMedia, previewUrl: "http://127.0.0.1/private" },
    { ...remoteShortcutMedia, previewUrl: "https://evil.example/storage/v1/object/public/shortcuts/guide.pdf" },
    { ...remoteShortcutMedia, storage_path: "different.pdf" },
    { ...inlineShortcutMedia, extra: true },
  ])("rejects malformed media without exposing content", (media) => {
    expect(() => transformLegacyCommunication(communicationFixture("message_shortcuts", { medyalar: [media] }), "message_shortcuts")).toThrow("Invalid legacy communication row");
  });
  it("dry-run counts bytes and URLs and optional shipment misses without network", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    try {
      const rows = [communicationFixture("message_shortcuts", { medyalar: [inlineShortcutMedia, remoteShortcutMedia] })];
      const source: LegacySource = { count: async () => rows.length, readBatch: async () => rows, describeTables: async () => [] };
      const plan = await createMigrationPlan({ source, mode: "dry-run", batchSize: 10, entities: ["message_shortcuts"] });
      expect(await validateCommunicationBatches(source, plan, new Map())).toMatchObject({ message_shortcuts: {
        sourceRows: 1, transformedRows: 1, inactiveRows: 1, mediaItems: 2, inlineMediaItems: 1, inlineMediaBytes: 5, remoteMediaUrls: 1,
      } });
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it.each(Object.entries({ cevaplandi: "answered", hata: "failed", cevapsiz: "missed", mesgul: "busy", iptal: "cancelled" }))(
    "maps call status %s explicitly to %s and preserves raw history", (durum, status) => {
      const row = communicationFixture("call_logs", { durum, sure_sn: 42, notlar: "Fixture note", bitis: "2024-01-02T03:04:47Z" });
      expect(transformLegacyCommunication(row, "call_logs").record.payload).toMatchObject({
        provider: "netgsm", source: "legacy", direction: "outbound", status, talk_seconds: 42,
        initiated_at: "2024-01-02T03:04:05.000000Z", ended_at: "2024-01-02T03:04:47.000000Z", raw_payload: row.payload, events: [],
      });
    });
  it.each([{ yon: "incoming-private-value" }, { durum: "unknown-private-value" }, { yon: null }, { durum: null },
    { sure_sn: -1 }, { sure_sn: 1.5 }, { baslangic: null }, { notlar: 42 }, { kullanici_id: "invalid" }, { siparis_id: "invalid" }])(
    "fails call logs closed on invalid enum or field %j", (overrides) => {
      expect(() => transformLegacyCommunication(communicationFixture("call_logs", overrides), "call_logs"))
        .toThrow("Invalid legacy communication row");
    });
  it("counts optional call user/order/customer resolution without writes", async () => {
    const userId = "c1000000-0000-4000-8000-000000000001";
    const orderId = "c1000000-0000-4000-8000-000000000002";
    const rows = [communicationFixture("call_logs", { kullanici_id: userId, siparis_id: orderId })];
    const source: LegacySource = { count: async () => 1, readBatch: async () => rows, describeTables: async () => [] };
    const plan = await createMigrationPlan({ source, mode: "dry-run", batchSize: 1, entities: ["call_logs"] });
    expect((await validateCommunicationBatches(source, plan, new Map())).call_logs).toMatchObject({
      sourceRows: 1, transformedRows: 1, unresolvedUsers: 1, unresolvedOrders: 1, unresolvedCustomers: 1,
    });
    expect((await validateCommunicationBatches(source, plan, new Map(), { userPublicIds: new Map([[userId, "usr_fixture"]]),
      orderPublicIds: new Map([[orderId, "ord_fixture"]]), customerPublicIdsByPhone: new Map([["5551112233", ["cus_fixture"]]]) })).call_logs)
      .toMatchObject({ linkedUsers: 1, linkedOrders: 1, linkedCustomers: 1, unresolvedUsers: 0, unresolvedOrders: 0, unresolvedCustomers: 0 });
  });

});
