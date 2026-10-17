const mimeByExtension: Readonly<Record<string, string>> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime",
  webm: "video/webm", "3gp": "video/3gpp", ogg: "audio/ogg", opus: "audio/opus",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", amr: "audio/amr",
  wav: "audio/wav", pdf: "application/pdf",
};

/** Inspect without decoding/retaining the binary payload. Nothing here performs network I/O. */
export function omittedMessageMedia(url: string | null, type: string | null) {
  if (url === null || !isOmittedMediaUrl(url)) return null;
  const inline = /^data:/i.test(url);
  const comma = url.indexOf(",");
  const header = inline && comma >= 0 ? url.slice(5, comma) : null;
  const mime = (header?.split(";")[0] || (type?.includes("/") ? type : mimeFromExtension(url)))?.toLowerCase() ?? null;
  const byteSize = header === null ? null : /;base64$/i.test(header)
    ? Buffer.byteLength(url.slice(comma + 1).replace(/\s/g, ""), "base64")
    : Buffer.byteLength(decodeURIComponent(url.slice(comma + 1)), "utf8");
  const kind = type?.toLowerCase() ?? mime?.split("/")[0] ?? "file";
  const label = /image|görsel|resim|photo/.test(kind) ? "Görsel"
    : /video/.test(kind) ? "Video" : /audio|voice|ses/.test(kind) ? "Ses kaydı" : "Belge";
  return {
    migrated: false as const,
    source: inline ? "inline" as const : "legacy_object" as const,
    kind,
    mime_type: mime,
    byte_size: byteSize,
    note: `📎 ${label} (eski sistemden taşınmadı)`,
  };
}

export function isOmittedMediaUrl(url: string): boolean {
  return /^(data:|s3:\/\/)/i.test(url);
}

function mimeFromExtension(url: string): string | null {
  const extension = url.split(".").pop()?.toLowerCase();
  return mimeByExtension[extension ?? ""] ?? null;
}
