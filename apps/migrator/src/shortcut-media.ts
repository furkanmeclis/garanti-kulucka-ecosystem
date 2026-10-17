import { createHash } from "node:crypto";
import { buildMediaObjectKey } from "./shortcut-object-key.js";
import { communicationPublicId, type ShortcutMedia } from "./communication-mapping.js";
import { decodeDataUrl, type MigratorMediaStorage } from "./media-storage.js";

const maxMediaBytes = 25 * 1024 * 1024;
export function shortcutDownloadUrl(previewUrl: string, baseUrl = process.env.MIGRATION_SHORTCUT_MEDIA_BASE_URL): URL {
  const source = new URL(previewUrl);
  if (!baseUrl) return source;
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash ||
    (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))) {
    throw new Error("MIGRATION_SHORTCUT_MEDIA_BASE_URL must be HTTPS (HTTP allowed only for loopback tests)");
  }
  return new URL(`${base.toString().replace(/\/$/, "")}${source.pathname}`);
}
export async function prepareShortcutMedia(input: {
  media: ShortcutMedia; sourceIdentity: string; index: number; createdAt: string | null; storage: MigratorMediaStorage;
}) {
  if (!input.storage.storeObject) throw new Error("Shortcut media requires MIGRATION_MEDIA_S3_* storage with object upload support");
  let bytes: Buffer;
  if (input.media.dataUrl) {
    bytes = decodeDataUrl(input.media.dataUrl).bytes;
  } else {
    // Redirects must never turn an approved public URL into a private-network request.
    let response: Response;
    try {
      response = await fetch(shortcutDownloadUrl(input.media.previewUrl!), { redirect: "error", signal: AbortSignal.timeout(30_000) });
    } catch { throw new Error("Shortcut media download failed"); }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("Shortcut media download returned an unsuccessful response"); }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxMediaBytes)) {
      await response.body.cancel(); throw new Error("Shortcut media download exceeds size limit");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maxMediaBytes) throw new Error("size limit");
        chunks.push(chunk);
      }
    } catch { throw new Error("Shortcut media download incomplete or exceeds size limit"); }
    if (declaredLength !== null && size !== Number(declaredLength)) throw new Error("Shortcut media download size mismatch");
    bytes = Buffer.concat(chunks);
  }
  if (bytes.length === 0 || bytes.length > maxMediaBytes) throw new Error("Shortcut media content size is invalid");
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const filePublicId = communicationPublicId("fil", `${input.sourceIdentity}:media:${input.index}:${checksum}`);
  const objectKey = buildMediaObjectKey({ publicId: filePublicId, originalName: input.media.fileName,
    now: new Date(input.createdAt ?? "1970-01-01T00:00:00.000Z") });
  let object;
  try {
    object = await input.storage.storeObject({ bytes, mimeType: input.media.mimeType, objectKey, checksum });
  } catch {
    throw new Error("Shortcut media object storage HEAD/upload failed");
  }
  if (object.checksum !== checksum || object.size !== bytes.length || object.objectKey !== objectKey || object.mimeType !== input.media.mimeType) {
    throw new Error("Shortcut storage response does not match uploaded content");
  }
  return { object, filePublicId };
}
