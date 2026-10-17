import type { Client } from "pg";
import type { VerificationCheck } from "./types.js";
import type { MigrationVerificationSnapshot } from "./verify.js";

export interface VerificationShortcutAttachment {
  public_id: string;
  shortcut_public_id: string | null;
  file_public_id: string | null;
  byte_size: string | number | null;
  checksum: string | null;
  upload_status: string | null;
}
export async function selectCommunicationVerification(client: Client,
  ids: MigrationVerificationSnapshot["targetPublicIds"]): Promise<{
    shortcutAttachments: VerificationShortcutAttachment[];
    communicationChecks: VerificationCheck[];
  }> {
  const shortcutAttachments = ids.message_shortcut_attachments.length > 0
    ? (await client.query<VerificationShortcutAttachment>(`
      select a.public_id, s.public_id as shortcut_public_id, f.public_id as file_public_id,
             f.byte_size, f.checksum, f.upload_status
      from message_shortcut_attachments a
      left join message_shortcuts s on s.id = a.shortcut_id
      left join files f on f.id = a.file_id
      where a.public_id = any($1::text[])`, [ids.message_shortcut_attachments])).rows : [];
  const communicationChecks: VerificationCheck[] = [];
  for (const table of ["sms_messages", "vapi_calls"] as const) {
    if (ids[table].length === 0) continue;
    const result = await client.query<{ invalid_count: number }>(`
      select count(*)::int as invalid_count from ${table} h
      left join shipments s on s.id = h.shipment_id
      where h.public_id = any($1::text[]) and (h.queued or (h.shipment_id is not null and s.id is null))`, [ids[table]]);
    const invalid = result.rows[0]?.invalid_count;
    if (!Number.isSafeInteger(invalid) || invalid! < 0) throw new Error("Invalid communication verification count");
    communicationChecks.push({ name: `referential_integrity.${table}`, status: invalid === 0 ? "passed" : "failed", expected: 0, actual: invalid! });
  }
  if (ids.call_logs.length > 0) {
    const result = await client.query<{ invalid_count: number }>(`
      select count(*)::int as invalid_count from call_logs h
      left join users u on u.id = h.user_id
      left join customers c on c.id = h.customer_id
      left join orders o on o.id = h.order_id
      where h.public_id = any($1::text[]) and
        (h.source <> 'legacy' or h.raw_payload->>'id' is null or
         (h.user_id is not null and u.id is null) or (h.customer_id is not null and c.id is null) or
         (h.order_id is not null and o.id is null))`, [ids.call_logs]);
    const invalid = result.rows[0]?.invalid_count;
    if (!Number.isSafeInteger(invalid) || invalid! < 0) throw new Error("Invalid call log verification count");
    communicationChecks.push({ name: "referential_integrity.call_logs", status: invalid === 0 ? "passed" : "failed", expected: 0, actual: invalid! });
  }
  return { shortcutAttachments, communicationChecks };
}
export function verifyShortcutMediaMappings(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const maps = (snapshot.legacyIdMaps ?? []).filter((m) => m.run_id === snapshot.runId && m.source_table === "public.kisayollar");
  const attachments = new Map((snapshot.shortcutAttachments ?? []).map((a) => [a.public_id, a]));
  let invalid = 0;
  for (const map of maps.filter((m) => m.target_table === "message_shortcut_attachments")) {
    const index = /^attachment:(\d+)$/.exec(map.mapping_role)?.[1];
    const sameSource = maps.filter((m) => m.source_system === map.source_system && m.source_id === map.source_id);
    const file = sameSource.find((m) => m.target_table === "files" && m.mapping_role === `media:${index}`);
    const shortcut = sameSource.find((m) => m.target_table === "message_shortcuts" && m.mapping_role === "primary");
    const attached = attachments.get(map.target_id);
    if (index === undefined || !file || !shortcut || !attached || attached.file_public_id !== file.target_id
      || attached.shortcut_public_id !== shortcut.target_id || attached.upload_status !== "available"
      || !attached.checksum || !/^sha256:[0-9a-f]{64}$/.test(attached.checksum) || !(Number(attached.byte_size) > 0)) invalid++;
  }
  for (const map of maps.filter((m) => m.target_table === "files")) {
    const index = /^media:(\d+)$/.exec(map.mapping_role)?.[1];
    if (index === undefined || !maps.some((m) => m.source_system === map.source_system && m.source_id === map.source_id
      && m.target_table === "message_shortcut_attachments" && m.mapping_role === `attachment:${index}`)) invalid++;
  }
  return { name: "referential_integrity.shortcut_media", status: invalid === 0 ? "passed" : "failed", expected: 0, actual: invalid };
}
