import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import { FilesRepository, serializeFile } from "../files/repository.js";
import { createMediaStorageFromEnv } from "../files/storage.js";
import {
  initialScanStatus,
  isValidSha256Checksum,
  loadStoragePolicies,
  scanStatusAllowsDownload,
} from "../files/policy.js";
import {
  logOrphanCleanup,
  orphanCleanupRequestId,
} from "../files/cleanup-observability.js";

const createUploadSchema = z.object({
  original_name: z.string().min(1).max(255).nullable().default(null),
  mime_type: z.string().min(1).max(255),
  byte_size: z.number().int().min(1),
  checksum: z.string().min(44).max(44),
});

const createMultipartUploadSchema = createUploadSchema.extend({
  part_count: z.number().int().min(1).max(10_000),
});

const multipartPartSchema = z.object({
  part_number: z.number().int().min(1).max(10_000),
  checksum: z.string().min(44).max(44).nullable().default(null),
});

const completeMultipartUploadSchema = z.object({
  upload_id: z.string().min(1).max(1024),
  parts: z.array(z.object({
    part_number: z.number().int().min(1).max(10_000),
    etag: z.string().min(1).max(512),
    checksum: z.string().min(44).max(44).nullable().optional(),
  })).min(1).max(10_000),
});

const abortMultipartUploadSchema = z.object({
  upload_id: z.string().min(1).max(1024),
});

const orphanCleanupDryRunSchema = z.object({
  reason: z.string().min(1).max(255).nullable().default("admin_orphan_lifecycle_review"),
});

const orphanCleanupApplySchema = orphanCleanupDryRunSchema.extend({
  confirmation: z.literal("delete_orphan_object"),
});

async function readOptionalJsonBody(context: { req: { header: (name: string) => string | undefined; json: () => Promise<unknown> } }) {
  const contentLength = context.req.header("content-length");
  if (contentLength === "0") {
    return {};
  }

  try {
    return await context.req.json();
  } catch {
    if (contentLength === undefined) {
      return {};
    }
    throw new Error("invalid_json");
  }
}

function storageDeleteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STORAGE_ORPHAN_DELETE_ENABLED === "true";
}

function validateUploadPolicy(input: {
  mimeType: string;
  byteSize: number;
  checksum: string;
  allowedContentTypes: string[];
  maxUploadBytes: number;
  requireSha256Checksum: boolean;
}): { code: string; message: string } | null {
  if (!input.allowedContentTypes.includes(input.mimeType)) {
    return { code: "content_type_not_allowed", message: "File content type is not allowed" };
  }

  if (input.byteSize > input.maxUploadBytes) {
    return { code: "file_too_large", message: "File exceeds the configured upload size limit" };
  }

  if (input.requireSha256Checksum && !isValidSha256Checksum(input.checksum)) {
    return { code: "checksum_required", message: "A base64 SHA-256 checksum is required" };
  }

  return null;
}

export function createFileRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);

  routes.post("/uploads", async (context) => {
    const payload = createUploadSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid file upload payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const storage = createMediaStorageFromEnv();
    const policies = await loadStoragePolicies({ db, settingsCache: context.get("settingsCache") });
    const policyError = validateUploadPolicy({
      mimeType: payload.data.mime_type,
      byteSize: payload.data.byte_size,
      checksum: payload.data.checksum,
      ...policies.upload,
    });
    if (policyError) {
      return context.json({ error: policyError }, 400);
    }
    const file = await new FilesRepository(db).createMediaFile({
      bucket: storage.bucket,
      originalName: payload.data.original_name,
      mimeType: payload.data.mime_type,
      byteSize: payload.data.byte_size,
      checksum: payload.data.checksum,
      scanStatus: initialScanStatus(policies.malwareScan),
      createdByUserId: context.get("actorUserId"),
    });

    return context.json(
      {
        file: serializeFile(file),
        upload: await storage.createUploadInstruction({
          objectKey: file.object_key,
          mimeType: file.mime_type,
          byteSize: file.byte_size,
          checksum: file.checksum,
        }),
      },
      201,
    );
  });

  routes.post("/multipart-uploads", async (context) => {
    const payload = createMultipartUploadSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid multipart upload payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const policies = await loadStoragePolicies({ db, settingsCache: context.get("settingsCache") });
    const policyError = validateUploadPolicy({
      mimeType: payload.data.mime_type,
      byteSize: payload.data.byte_size,
      checksum: payload.data.checksum,
      ...policies.upload,
    });
    if (policyError) {
      return context.json({ error: policyError }, 400);
    }

    const storage = createMediaStorageFromEnv();
    const repository = new FilesRepository(db);
    const pending = await repository.createMediaFile({
      bucket: storage.bucket,
      originalName: payload.data.original_name,
      mimeType: payload.data.mime_type,
      byteSize: payload.data.byte_size,
      checksum: payload.data.checksum,
      uploadStatus: "pending",
      uploadType: "multipart",
      scanStatus: initialScanStatus(policies.malwareScan),
      createdByUserId: context.get("actorUserId"),
    });
    const multipart = await storage.createMultipartUploadInstruction({
      objectKey: pending.object_key,
      mimeType: payload.data.mime_type,
      checksum: payload.data.checksum,
    });
    const file = await repository.attachMultipartUploadId(pending.public_id, multipart.upload_id);

    return context.json({ file: serializeFile(file), multipart }, 201);
  });

  routes.post("/:file_public_id/multipart-uploads/parts", async (context) => {
    const payload = multipartPartSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid multipart part payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const file = await new FilesRepository(db).findByPublicId(context.req.param("file_public_id"));
    if (!file || file.upload_type !== "multipart" || file.upload_status !== "pending" || !file.multipart_upload_id) {
      return context.json({ error: { code: "not_found", message: "Pending multipart upload was not found" } }, 404);
    }

    if (payload.data.checksum !== null && !isValidSha256Checksum(payload.data.checksum)) {
      return context.json({ error: { code: "invalid_checksum", message: "Part checksum must be base64 SHA-256" } }, 400);
    }

    const storage = createMediaStorageFromEnv();
    return context.json({
      part: await storage.createMultipartPartInstruction({
        objectKey: file.object_key,
        uploadId: file.multipart_upload_id,
        partNumber: payload.data.part_number,
        checksum: payload.data.checksum,
      }),
    });
  });

  routes.post("/:file_public_id/multipart-uploads/complete", async (context) => {
    const payload = completeMultipartUploadSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid multipart complete payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const repository = new FilesRepository(db);
    const file = await repository.findByPublicId(context.req.param("file_public_id"));
    if (!file || file.upload_type !== "multipart" || file.upload_status !== "pending" || file.multipart_upload_id !== payload.data.upload_id) {
      return context.json({ error: { code: "not_found", message: "Pending multipart upload was not found" } }, 404);
    }

    const storage = createMediaStorageFromEnv();
    await storage.completeMultipartUpload({
      objectKey: file.object_key,
      uploadId: payload.data.upload_id,
      parts: payload.data.parts.map((part) => ({
        partNumber: part.part_number,
        etag: part.etag,
        checksumSHA256: part.checksum ?? null,
      })),
    });
    const available = await repository.markMultipartComplete(file.public_id, payload.data.upload_id);
    if (!available) {
      return context.json({ error: { code: "upload_state_conflict", message: "Multipart upload state changed before completion" } }, 409);
    }

    return context.json({ file: serializeFile(available) });
  });

  routes.post("/:file_public_id/multipart-uploads/abort", async (context) => {
    const payload = abortMultipartUploadSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid multipart abort payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const repository = new FilesRepository(db);
    const file = await repository.findByPublicId(context.req.param("file_public_id"));
    if (!file || file.upload_type !== "multipart" || file.upload_status !== "pending" || file.multipart_upload_id !== payload.data.upload_id) {
      return context.json({ error: { code: "not_found", message: "Pending multipart upload was not found" } }, 404);
    }

    const storage = createMediaStorageFromEnv();
    await storage.abortMultipartUpload(file.object_key, payload.data.upload_id);
    const abandoned = await repository.markMultipartAbandoned(file.public_id, payload.data.upload_id);
    if (!abandoned) {
      return context.json({ error: { code: "upload_state_conflict", message: "Multipart upload state changed before abort" } }, 409);
    }

    return context.json({ file: serializeFile(abandoned) });
  });

  routes.get("/orphans", requireAdmin, async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const parsedLimit = Number(context.req.query("limit") ?? 20);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 20;
    const repository = new FilesRepository(db);
    const [files, totalCount] = await Promise.all([
      repository.listOrphanCandidates(limit),
      repository.countOrphanCandidates(),
    ]);
    return context.json({ data: files.map(serializeFile), summary: { total_count: totalCount } });
  });

  routes.post("/:file_public_id/orphan-cleanup-dry-run", requireAdmin, async (context) => {
    let body: unknown;
    try {
      body = await readOptionalJsonBody(context);
    } catch {
      return context.json({ error: { code: "invalid_request", message: "Invalid orphan cleanup dry-run payload" } }, 400);
    }

    const payload = orphanCleanupDryRunSchema.safeParse(body);
    if (!payload.success) {
      logOrphanCleanup({
        context,
        mode: "dry_run",
        filePublicId: context.req.param("file_public_id") ?? "",
        resultCode: "invalid_request",
        level: "warn",
      });
      return context.json({ error: { code: "invalid_request", message: "Invalid orphan cleanup dry-run payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const filePublicId = context.req.param("file_public_id");
    if (!filePublicId) {
      logOrphanCleanup({
        context,
        mode: "dry_run",
        filePublicId: filePublicId ?? "",
        resultCode: "invalid_request",
        level: "warn",
      });
      return context.json({ error: { code: "invalid_request", message: "File public id is required" } }, 400);
    }

    const file = await new FilesRepository(db).findOrphanCandidateByPublicId(filePublicId);
    if (!file) {
      logOrphanCleanup({
        context,
        mode: "dry_run",
        filePublicId,
        resultCode: "not_found",
        level: "warn",
      });
      return context.json({ error: { code: "not_found", message: "Orphan file candidate was not found" } }, 404);
    }

    logOrphanCleanup({
      context,
      mode: "dry_run",
      filePublicId,
      file,
      resultCode: "dry_run_ready",
    });

    return context.json({
      mode: "dry_run",
      request_id: orphanCleanupRequestId(file.public_id),
      deletion_performed: false,
      eligible_for_cleanup: true,
      reason: payload.data.reason,
      file: serializeFile(file),
      storage_action: {
        provider: "garage",
        bucket: file.bucket,
        object_key: file.object_key,
        operation: "delete_object",
      },
    });
  });

  routes.post("/:file_public_id/orphan-cleanup", requireAdmin, async (context) => {
    let body: unknown;
    try {
      body = await readOptionalJsonBody(context);
    } catch {
      return context.json({ error: { code: "invalid_request", message: "Invalid orphan cleanup payload" } }, 400);
    }

    const payload = orphanCleanupApplySchema.safeParse(body);
    if (!payload.success) {
      logOrphanCleanup({
        context,
        mode: "apply",
        filePublicId: context.req.param("file_public_id") ?? "",
        resultCode: "invalid_request",
        level: "warn",
      });
      return context.json({ error: { code: "invalid_request", message: "Invalid orphan cleanup payload" } }, 400);
    }

    if (!storageDeleteEnabled()) {
      logOrphanCleanup({
        context,
        mode: "apply",
        filePublicId: context.req.param("file_public_id") ?? "",
        resultCode: "storage_operation_disabled",
        level: "warn",
      });
      return context.json(
        {
          error: {
            code: "storage_operation_disabled",
            message: "Orphan cleanup delete is disabled. Run dry-run and enable STORAGE_ORPHAN_DELETE_ENABLED for controlled production apply.",
          },
        },
        409,
      );
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const filePublicId = context.req.param("file_public_id");
    if (!filePublicId) {
      logOrphanCleanup({
        context,
        mode: "apply",
        filePublicId: filePublicId ?? "",
        resultCode: "invalid_request",
        level: "warn",
      });
      return context.json({ error: { code: "invalid_request", message: "File public id is required" } }, 400);
    }

    const file = await new FilesRepository(db).findOrphanCandidateByPublicId(filePublicId);
    if (!file) {
      logOrphanCleanup({
        context,
        mode: "apply",
        filePublicId,
        resultCode: "not_found",
        level: "warn",
      });
      return context.json({ error: { code: "not_found", message: "Orphan file candidate was not found" } }, 404);
    }

    const storage = createMediaStorageFromEnv();
    if (file.bucket !== storage.bucket) {
      logOrphanCleanup({
        context,
        mode: "apply",
        filePublicId,
        file,
        resultCode: "storage_bucket_mismatch",
        level: "warn",
      });
      return context.json(
        {
          error: {
            code: "storage_bucket_mismatch",
            message: "File bucket does not match configured media storage bucket",
          },
        },
        409,
      );
    }

    let storageAction;
    try {
      storageAction = await storage.deleteObject(file.object_key);
    } catch (error) {
      logOrphanCleanup({
        context,
        mode: "apply",
        filePublicId,
        file,
        resultCode: "storage_delete_failed",
        level: "error",
        error,
      });
      throw error;
    }

    logOrphanCleanup({
      context,
      mode: "apply",
      filePublicId,
      file,
      resultCode: "deleted",
    });

    return context.json({
      mode: "apply",
      request_id: orphanCleanupRequestId(file.public_id),
      deletion_performed: true,
      eligible_for_cleanup: true,
      reason: payload.data.reason,
      file: serializeFile(file),
      storage_action: storageAction,
    });
  });

  routes.get("/:file_public_id/download", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const file = await new FilesRepository(db).findByPublicId(context.req.param("file_public_id"));
    if (!file) {
      return context.json({ error: { code: "not_found", message: "File was not found" } }, 404);
    }
    if (file.upload_status !== "available") {
      return context.json({ error: { code: "file_not_available", message: "File upload is not available for download" } }, 409);
    }
    const policies = await loadStoragePolicies({ db, settingsCache: context.get("settingsCache") });
    if (!scanStatusAllowsDownload(file.scan_status, policies.malwareScan)) {
      return context.json({ error: { code: "file_scan_blocked", message: "File is not cleared for download" } }, 423);
    }

    const storage = createMediaStorageFromEnv();
    return context.json({
      file: serializeFile(file),
      download: await storage.createDownloadInstruction(file.object_key),
    });
  });

  routes.get("/:file_public_id", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const file = await new FilesRepository(db).findByPublicId(context.req.param("file_public_id"));
    if (!file) {
      return context.json({ error: { code: "not_found", message: "File was not found" } }, 404);
    }

    return context.json(serializeFile(file));
  });

  return routes;
}
