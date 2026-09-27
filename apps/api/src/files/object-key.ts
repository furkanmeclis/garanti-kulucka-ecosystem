import { extname } from "node:path/posix";

const unsafeObjectKeyPattern = /(^|\/)\.{1,2}(\/|$)|[\\\u0000-\u001f\u007f]/u;

export interface BuildMediaObjectKeyInput {
  publicId: string;
  originalName: string | null;
  now?: Date;
}

export function assertSafeObjectKey(objectKey: string): string {
  if (!objectKey || objectKey.length > 512 || objectKey.startsWith("/") || objectKey.endsWith("/")) {
    throw new Error("Object key must be a non-empty relative path");
  }

  if (unsafeObjectKeyPattern.test(objectKey) || objectKey.includes("//")) {
    throw new Error("Object key contains unsafe path segments");
  }

  return objectKey;
}

function safeFileStem(originalName: string | null): string {
  if (!originalName) {
    return "upload";
  }

  const withoutPath = originalName.split(/[\\/]/u).at(-1) ?? "upload";
  const withoutExtension = withoutPath.slice(0, withoutPath.length - extname(withoutPath).length);
  const normalized = withoutExtension
    .normalize("NFKD")
    .replace(/[^\w.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();

  return normalized.slice(0, 80) || "upload";
}

function safeExtension(originalName: string | null): string {
  if (!originalName) {
    return "";
  }

  const extension = extname(originalName.split(/[\\/]/u).at(-1) ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9.]/gu, "");

  return extension.length <= 16 ? extension : "";
}

export function buildMediaObjectKey(input: BuildMediaObjectKeyInput): string {
  const now = input.now ?? new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const filename = `${safeFileStem(input.originalName)}${safeExtension(input.originalName)}`;

  return assertSafeObjectKey(`media/${year}/${month}/${day}/${input.publicId}/${filename}`);
}
