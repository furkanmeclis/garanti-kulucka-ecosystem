import { describe, expect, it } from "vitest";
import { verifyShortcutMediaMappings } from "../src/communication-verify.js";
import type { MigrationVerificationSnapshot, VerificationLegacyIdMapEntry } from "../src/verify.js";

const map = (target_table: string, mapping_role: string, target_id: string): VerificationLegacyIdMapEntry => ({
  run_id: "fixture", source_system: "legacy_postgres", source_table: "public.kisayollar", source_id: "fixture-source",
  target_table, mapping_role, target_id,
});
function snapshot(): MigrationVerificationSnapshot {
  return { runId: "fixture", sourceManifest: null, targetPublicIds: {} as MigrationVerificationSnapshot["targetPublicIds"],
    customers: [], customerExternalIdentities: [], conversations: [], messages: [], orders: [], orderItems: [], shipments: [],
    legacyIdMaps: [map("message_shortcuts", "primary", "msc_fixture"), map("files", "media:0", "fil_fixture"),
      map("message_shortcut_attachments", "attachment:0", "msa_fixture")],
    shortcutAttachments: [{ public_id: "msa_fixture", shortcut_public_id: "msc_fixture", file_public_id: "fil_fixture",
      byte_size: "5", checksum: `sha256:${"a".repeat(64)}`, upload_status: "available" }] };
}
describe("shortcut media verification", () => {
  it("accepts a complete primary/file/attachment chain", () => {
    expect(verifyShortcutMediaMappings(snapshot())).toMatchObject({ status: "passed", actual: 0 });
  });
  it.each(["missing_attachment", "missing_file_map", "wrong_file", "wrong_shortcut", "pending_file", "missing_checksum", "zero_size"])("rejects %s", (scenario) => {
    const value = snapshot();
    if (scenario === "missing_attachment") value.shortcutAttachments!.splice(0);
    if (scenario === "missing_file_map") value.legacyIdMaps!.splice(1, 1);
    if (scenario === "wrong_file") value.shortcutAttachments![0]!.file_public_id = "fil_wrong";
    if (scenario === "wrong_shortcut") value.shortcutAttachments![0]!.shortcut_public_id = "msc_wrong";
    if (scenario === "pending_file") value.shortcutAttachments![0]!.upload_status = "pending";
    if (scenario === "missing_checksum") value.shortcutAttachments![0]!.checksum = null;
    if (scenario === "zero_size") value.shortcutAttachments![0]!.byte_size = 0;
    expect(verifyShortcutMediaMappings(value).status).toBe("failed");
  });
});
