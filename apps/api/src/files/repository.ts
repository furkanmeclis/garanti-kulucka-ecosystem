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
        created_by_user_id: input.createdByUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
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

  async listOrphanCandidates(limit = 20): Promise<FileRecord[]> {
    const safeLimit = Math.max(1, Math.min(100, limit));
    return this.db
      .selectFrom("files")
      .leftJoin("message_attachments", "message_attachments.file_id", "files.id")
      .selectAll("files")
      .where("message_attachments.id", "is", null)
      .orderBy("files.created_at", "asc")
      .limit(safeLimit)
      .execute();
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
    created_at: file.created_at,
    updated_at: file.updated_at,
  };
}
