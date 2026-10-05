import type { Context } from "hono";
import { createStructuredLog, redactValue } from "@garanti-kulucka/shared";
import type { AppBindings } from "../http/types.js";
import { getApiMetrics } from "../observability/metrics.js";
import type { FileRecord } from "./repository.js";

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
  return redactValue(value);
}

export function logOrphanCleanup(input: OrphanCleanupLogInput): void {
  const auth = input.context.get("auth");
  const filePublicId = input.file?.public_id ?? input.filePublicId;
  const contextPayload: Record<string, unknown> = {
    mode: input.mode,
    actor_id: auth?.user_public_id ?? null,
    file_public_id: filePublicId,
    bucket: input.file?.bucket ?? null,
    object_key: input.file?.object_key ?? null,
    cleanup_request_id: orphanCleanupRequestId(filePublicId),
    result_code: input.resultCode,
  };

  const metricLabels = { bucket: input.file?.bucket ?? "unknown", result_code: input.resultCode };
  if (input.mode === "apply") {
    getApiMetrics().storageOrphanApply.inc(metricLabels);
  }
  if ((input.level ?? "info") === "error") {
    getApiMetrics().storageOrphanErrors.inc(metricLabels);
  }

  if (input.error !== undefined) {
    contextPayload.error = redactLogValue(input.error);
  }

  input.context.get("logger")[input.level ?? "info"](
    createStructuredLog({
      level: input.level ?? "info",
      service: "api",
      event: "storage.orphan_cleanup",
      request_id: input.context.get("requestId"),
      msg: "Storage orphan cleanup decision",
      context: contextPayload,
    }),
    "Storage orphan cleanup decision",
  );
}
