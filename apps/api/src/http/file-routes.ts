import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { FilesRepository, serializeFile } from "../files/repository.js";
import { createMediaStorageFromEnv } from "../files/storage.js";

const createUploadSchema = z.object({
  original_name: z.string().min(1).max(255).nullable().default(null),
  mime_type: z.string().min(1).max(255).nullable().default(null),
  byte_size: z.number().int().min(0).max(50 * 1024 * 1024).nullable().default(null),
  checksum: z.string().min(16).max(128).nullable().default(null),
});

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
