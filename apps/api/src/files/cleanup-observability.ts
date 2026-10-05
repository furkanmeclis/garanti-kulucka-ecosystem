import type { Context } from "hono";
import type { AppBindings } from "../http/types.js";
import type { FileRecord } from "./repository.js";

const sensitiveQueryParameterPattern =
  /([?&](?:X-Amz-[^=]*Signature|X-Amz-Credential|X-Amz-Security-Token|signature|token|access_token|secret|key|password)=)[^&\s]*/gi;

export type OrphanCleanupMode = "dry_run" | "apply";

export interface OrphanCleanupLogInput {
  context: Context<AppBindings>;
  mode: OrphanCleanupMode;
  filePublicId: string;
  file?: Pick<FileRecord, "public_id" | "bucket" | "object_key"> | null;
  resultCode: string;
  level?: "info" | "warn" | "error";
  error?: unknown;
}

export function orphanCleanupRequestId(filePublicId: string): string {
  return `orphan_cleanup_${filePublicId}`;
}

export function redactLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(sensitiveQueryParameterPattern, "$1[redacted]");
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogValue(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.map(redactLogValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, redactLogValue(nestedValue)]),
    );
  }

  return value;
}

export function logOrphanCleanup(input: OrphanCleanupLogInput): void {
  const auth = input.context.get("auth");
  const filePublicId = input.file?.public_id ?? input.filePublicId;
  const payload: Record<string, unknown> = {
    event: "storage.orphan_cleanup",
    mode: input.mode,
    request_id: input.context.get("requestId"),
    actor_id: auth?.user_public_id ?? null,
    file_public_id: filePublicId,
    bucket: input.file?.bucket ?? null,
    object_key: input.file?.object_key ?? null,
    cleanup_request_id: orphanCleanupRequestId(filePublicId),
    result_code: input.resultCode,
  };

  if (input.error !== undefined) {
    payload.error = redactLogValue(input.error);
  }

  input.context.get("logger")[input.level ?? "info"](
    redactLogValue(payload) as Record<string, unknown>,
    "Storage orphan cleanup decision",
  );
}
