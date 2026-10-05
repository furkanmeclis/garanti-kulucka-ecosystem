import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import { FilesRepository, serializeFile } from "../files/repository.js";
import { createMediaStorageFromEnv } from "../files/storage.js";

const createUploadSchema = z.object({
  original_name: z.string().min(1).max(255).nullable().default(null),
  mime_type: z.string().min(1).max(255).nullable().default(null),
  byte_size: z.number().int().min(0).max(50 * 1024 * 1024).nullable().default(null),
  checksum: z.string().min(16).max(128).nullable().default(null),
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
    const file = await new FilesRepository(db).createMediaFile({
      bucket: storage.bucket,
      originalName: payload.data.original_name,
      mimeType: payload.data.mime_type,
      byteSize: payload.data.byte_size,
      checksum: payload.data.checksum,
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
      return context.json({ error: { code: "invalid_request", message: "Invalid orphan cleanup dry-run payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const filePublicId = context.req.param("file_public_id");
    if (!filePublicId) {
      return context.json({ error: { code: "invalid_request", message: "File public id is required" } }, 400);
    }

    const file = await new FilesRepository(db).findOrphanCandidateByPublicId(filePublicId);
    if (!file) {
      return context.json({ error: { code: "not_found", message: "Orphan file candidate was not found" } }, 404);
    }

    return context.json({
      mode: "dry_run",
      request_id: `orphan_cleanup_${file.public_id}`,
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
      return context.json({ error: { code: "invalid_request", message: "Invalid orphan cleanup payload" } }, 400);
    }

    if (!storageDeleteEnabled()) {
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
      return context.json({ error: { code: "invalid_request", message: "File public id is required" } }, 400);
    }

    const file = await new FilesRepository(db).findOrphanCandidateByPublicId(filePublicId);
    if (!file) {
      return context.json({ error: { code: "not_found", message: "Orphan file candidate was not found" } }, 404);
    }

    const storage = createMediaStorageFromEnv();
    if (file.bucket !== storage.bucket) {
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

    return context.json({
      mode: "apply",
      request_id: `orphan_cleanup_${file.public_id}`,
      deletion_performed: true,
      eligible_for_cleanup: true,
      reason: payload.data.reason,
      file: serializeFile(file),
      storage_action: await storage.deleteObject(file.object_key),
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
