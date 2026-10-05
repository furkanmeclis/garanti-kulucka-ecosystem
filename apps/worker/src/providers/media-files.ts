import { GetObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type { AppDatabase } from "@garanti-kulucka/database";

export interface ProviderMediaFile {
  file_public_id: string;
  bytes: Uint8Array;
  mime_type: string;
  file_name: string | null;
  byte_size: number;
}

export interface ProviderMediaFileResolver {
  resolve(filePublicId: string): Promise<ProviderMediaFile>;
}

export class ProviderMediaFileError extends Error {
  readonly code = "media_file_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "ProviderMediaFileError";
  }
}

// WhatsApp Cloud API rejects media above 100 MB (documents); never buffer more than that.
export const providerMediaMaxBytes = 100 * 1024 * 1024;

export function createWorkerMediaS3Client(env: NodeJS.ProcessEnv = process.env): S3Client {
  const clientConfig: S3ClientConfig = {
    region: env.S3_REGION ?? "garage",
    forcePathStyle: true,
  };
  if (env.S3_ENDPOINT) {
    clientConfig.endpoint = env.S3_ENDPOINT;
  }
  if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    };
  }
  return new S3Client(clientConfig);
}

/**
 * Resolves a canonical `files.public_id` to its bytes in Garage/S3 so provider adapters can
 * upload media to third parties (WhatsApp /{phone_number_id}/media). Only available, non-infected
 * files are served.
 */
export class S3ProviderMediaFileResolver implements ProviderMediaFileResolver {
  constructor(
    private readonly db: AppDatabase,
    private readonly client: S3Client = createWorkerMediaS3Client(),
  ) {}

  async resolve(filePublicId: string): Promise<ProviderMediaFile> {
    const file = await this.db
      .selectFrom("files")
      .select(["public_id", "bucket", "object_key", "original_name", "mime_type", "byte_size", "upload_status", "scan_status"])
      .where("public_id", "=", filePublicId)
      .executeTakeFirst();
    if (!file) throw new ProviderMediaFileError(`Media file not found: ${filePublicId}`);
    if (file.upload_status !== "available") {
      throw new ProviderMediaFileError(`Media file is not available: ${filePublicId}`);
    }
    if (file.scan_status === "infected") {
      throw new ProviderMediaFileError(`Media file failed malware scan: ${filePublicId}`);
    }
    if (typeof file.byte_size === "number" && file.byte_size > providerMediaMaxBytes) {
      throw new ProviderMediaFileError(`Media file exceeds provider size limit: ${filePublicId}`);
    }

    const object = await this.client.send(new GetObjectCommand({ Bucket: file.bucket, Key: file.object_key }));
    if (!object.Body) throw new ProviderMediaFileError(`Media object body is empty: ${filePublicId}`);
    const bytes = await object.Body.transformToByteArray();
    if (bytes.byteLength > providerMediaMaxBytes) {
      throw new ProviderMediaFileError(`Media file exceeds provider size limit: ${filePublicId}`);
    }

    return {
      file_public_id: file.public_id,
      bytes,
      mime_type: file.mime_type ?? object.ContentType ?? "application/octet-stream",
      file_name: file.original_name,
      byte_size: bytes.byteLength,
    };
  }
}
