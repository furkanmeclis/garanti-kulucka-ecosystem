import type { AppDatabase, FilesTable } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import { newPublicId } from "../auth/crypto.js";
import { buildMediaObjectKey } from "./object-key.js";

export type FileRecord = Selectable<FilesTable>;

export interface CreateFileInput {
  bucket: string;
  originalName: string | null;
  mimeType: string | null;
  byteSize: number | null;
  checksum: string | null;
  createdByUserId: number | null;
  uploadStatus?: "pending" | "available";
  scanStatus?: "pending" | "skipped";
  uploadType?: "singlepart" | "multipart";
  multipartUploadId?: string | null;
}

export class FilesRepository {
  constructor(private readonly db: AppDatabase) {}

  async createMediaFile(input: CreateFileInput): Promise<FileRecord> {
    const publicId = newPublicId("fil");
    const objectKey = buildMediaObjectKey({
      publicId,
      originalName: input.originalName,
    });

    return this.db
      .insertInto("files")
      .values({
        public_id: publicId,
        bucket: input.bucket,
        object_key: objectKey,
        original_name: input.originalName,
        mime_type: input.mimeType,
        byte_size: input.byteSize,
        checksum: input.checksum,
        upload_status: input.uploadStatus ?? "available",
        scan_status: input.scanStatus ?? "skipped",
        upload_type: input.uploadType ?? "singlepart",
        multipart_upload_id: input.multipartUploadId ?? null,
        completed_at: (input.uploadStatus ?? "available") === "available" ? new Date() : null,
        created_by_user_id: input.createdByUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async attachMultipartUploadId(publicId: string, uploadId: string): Promise<FileRecord> {
    return this.db
      .updateTable("files")
      .set({
        multipart_upload_id: uploadId,
        updated_at: new Date(),
      })
      .where("public_id", "=", publicId)
      .where("upload_type", "=", "multipart")
      .where("upload_status", "=", "pending")
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async markMultipartComplete(publicId: string, uploadId: string): Promise<FileRecord | null> {
    return (
      (await this.db
        .updateTable("files")
        .set({
          upload_status: "available",
          completed_at: new Date(),
          updated_at: new Date(),
        })
        .where("public_id", "=", publicId)
        .where("multipart_upload_id", "=", uploadId)
        .where("upload_type", "=", "multipart")
        .where("upload_status", "=", "pending")
        .returningAll()
        .executeTakeFirst()) ?? null
    );
  }

  async markMultipartAbandoned(publicId: string, uploadId: string): Promise<FileRecord | null> {
    return (
      (await this.db
        .updateTable("files")
        .set({
          upload_status: "abandoned",
          abandoned_at: new Date(),
          updated_at: new Date(),
        })
        .where("public_id", "=", publicId)
        .where("multipart_upload_id", "=", uploadId)
        .where("upload_type", "=", "multipart")
        .where("upload_status", "=", "pending")
        .returningAll()
        .executeTakeFirst()) ?? null
    );
  }

  async findByPublicId(publicId: string): Promise<FileRecord | null> {
    return (
      (await this.db
        .selectFrom("files")
        .selectAll()
        .where("public_id", "=", publicId)
        .executeTakeFirst()) ?? null
    );
  }

  async findOrphanCandidateByPublicId(publicId: string): Promise<FileRecord | null> {
    return (
      (await this.db
        .selectFrom("files")
        .leftJoin("message_attachments", "message_attachments.file_id", "files.id")
        .selectAll("files")
        .where("files.public_id", "=", publicId)
        .where("message_attachments.id", "is", null)
        .where((expression) =>
          expression.or([
            expression("files.upload_status", "=", "available"),
            expression("files.upload_status", "=", "abandoned"),
            expression.and([
              expression("files.upload_status", "=", "pending"),
              expression("files.created_at", "<", new Date(Date.now() - 24 * 60 * 60 * 1000)),
            ]),
          ]),
        )
        .executeTakeFirst()) ?? null
    );
  }

  async listOrphanCandidates(limit = 20): Promise<FileRecord[]> {
    const safeLimit = Math.max(1, Math.min(100, limit));
    return this.db
      .selectFrom("files")
      .leftJoin("message_attachments", "message_attachments.file_id", "files.id")
      .selectAll("files")
      .where("message_attachments.id", "is", null)
      .where((expression) =>
        expression.or([
          expression("files.upload_status", "=", "available"),
          expression("files.upload_status", "=", "abandoned"),
          expression.and([
            expression("files.upload_status", "=", "pending"),
            expression("files.created_at", "<", new Date(Date.now() - 24 * 60 * 60 * 1000)),
          ]),
        ]),
      )
      .orderBy("files.created_at", "asc")
      .limit(safeLimit)
      .execute();
  }

  async countOrphanCandidates(): Promise<number> {
    const row = await this.db
      .selectFrom("files")
      .leftJoin("message_attachments", "message_attachments.file_id", "files.id")
      .select((expression) => [expression.fn.countAll<number>().as("total_count")])
      .where("message_attachments.id", "is", null)
      .where((expression) =>
        expression.or([
          expression("files.upload_status", "=", "available"),
          expression("files.upload_status", "=", "abandoned"),
          expression.and([
            expression("files.upload_status", "=", "pending"),
            expression("files.created_at", "<", new Date(Date.now() - 24 * 60 * 60 * 1000)),
          ]),
        ]),
      )
      .executeTakeFirst();

    return Number(row?.total_count ?? 0);
  }
}

export function serializeFile(file: FileRecord) {
  return {
    public_id: file.public_id,
    bucket: file.bucket,
    object_key: file.object_key,
    original_name: file.original_name,
    mime_type: file.mime_type,
    byte_size: file.byte_size === null ? null : Number(file.byte_size),
    checksum: file.checksum,
    upload_status: file.upload_status,
    scan_status: file.scan_status,
    upload_type: file.upload_type,
    multipart_upload_id: file.multipart_upload_id,
    completed_at: file.completed_at,
    abandoned_at: file.abandoned_at,
    created_at: file.created_at,
    updated_at: file.updated_at,
  };
}
