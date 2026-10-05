import { describe, expect, it, vi } from "vitest";
import {
  logOrphanCleanup,
  orphanCleanupRequestId,
  redactLogValue,
} from "../src/files/cleanup-observability.js";
import type { ApiLogger, AppBindings } from "../src/http/types.js";
import type { Context } from "hono";

function createMockContext(logger: ApiLogger): Context<AppBindings> {
  const values = new Map<string, unknown>([
    ["requestId", "req_observe_1"],
    ["auth", { user_public_id: "usr_admin" }],
    ["logger", logger],
  ]);

  return {
    get: (key: string) => values.get(key),
  } as Context<AppBindings>;
}

describe("orphan cleanup observability", () => {
  it("builds stable cleanup request ids", () => {
    expect(orphanCleanupRequestId("fil_orphan")).toBe("orphan_cleanup_fil_orphan");
  });

  it("logs structured correlation fields for dry-run and apply decisions", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const context = createMockContext(logger);

    logOrphanCleanup({
      context,
      mode: "apply",
      filePublicId: "fil_orphan",
      file: {
        public_id: "fil_orphan",
        bucket: "media",
        object_key: "media/2026/10/05/fil_orphan/proof.txt",
      },
      resultCode: "deleted",
    });
    logOrphanCleanup({
      context,
      mode: "dry_run",
      filePublicId: "fil_orphan",
      file: {
        public_id: "fil_orphan",
        bucket: "media",
        object_key: "media/2026/10/05/fil_orphan/proof.txt",
      },
      resultCode: "dry_run_ready",
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        event: "storage.orphan_cleanup",
        mode: "apply",
        request_id: "req_observe_1",
        actor_id: "usr_admin",
        file_public_id: "fil_orphan",
        bucket: "media",
        object_key: "media/2026/10/05/fil_orphan/proof.txt",
        cleanup_request_id: "orphan_cleanup_fil_orphan",
        result_code: "deleted",
      },
      "Storage orphan cleanup decision",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "dry_run",
        request_id: "req_observe_1",
        actor_id: "usr_admin",
        file_public_id: "fil_orphan",
        bucket: "media",
        object_key: "media/2026/10/05/fil_orphan/proof.txt",
        cleanup_request_id: "orphan_cleanup_fil_orphan",
        result_code: "dry_run_ready",
      }),
      "Storage orphan cleanup decision",
    );
  });

  it("redacts presigned query strings from logged error payloads", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const context = createMockContext(logger);
    const presignedUrl =
      "https://garage/media/object.txt?X-Amz-Credential=AKIA%2F20261005&X-Amz-Signature=abcdef&safe=value";

    logOrphanCleanup({
      context,
      mode: "apply",
      filePublicId: "fil_orphan",
      file: {
        public_id: "fil_orphan",
        bucket: "media",
        object_key: "media/2026/10/05/fil_orphan/proof.txt",
      },
      resultCode: "storage_delete_failed",
      level: "error",
      error: new Error(`Delete failed for ${presignedUrl}`),
    });

    const payload = logger.error.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(payload)).toContain("X-Amz-Credential=[redacted]");
    expect(JSON.stringify(payload)).toContain("X-Amz-Signature=[redacted]");
    expect(JSON.stringify(payload)).toContain("safe=value");
    expect(JSON.stringify(payload)).not.toContain("AKIA%2F20261005");
    expect(JSON.stringify(payload)).not.toContain("abcdef");
  });

  it("redacts secret query parameters recursively", () => {
    expect(
      redactLogValue({
        nested: [
          "https://garage/bucket/key?token=secret-token&X-Amz-Signature=sig",
        ],
      }),
    ).toEqual({
      nested: [
        "https://garage/bucket/key?token=[redacted]&X-Amz-Signature=[redacted]",
      ],
    });
  });
});
