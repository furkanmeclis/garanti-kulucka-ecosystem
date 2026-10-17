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
});
