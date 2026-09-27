import { S3Client } from "@aws-sdk/client-s3";
import { assertSafeObjectKey } from "./object-key.js";

export interface MediaStorageConfig {
  endpoint: string | null;
  region: string;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  bucket: string | null;
}

export interface UploadInstructionInput {
  objectKey: string;
  mimeType: string | null;
  byteSize: number | null;
  checksum: string | null;
}

export interface UploadInstruction {
  method: "PUT";
  bucket: string;
  object_key: string;
  headers: Record<string, string>;
  presigned_url: string | null;
  expires_at: string | null;
}

export function loadMediaStorageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MediaStorageConfig {
  return {
    endpoint: env.S3_ENDPOINT ?? null,
    region: env.S3_REGION ?? "garage",
    accessKeyId: env.S3_ACCESS_KEY_ID ?? null,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? null,
    bucket: env.S3_BUCKET_MEDIA ?? null,
  };
}

export function createMediaS3Client(config: MediaStorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint ?? undefined,
    region: config.region,
    forcePathStyle: true,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
        : undefined,
  });
}

export class MediaStorageService {
  readonly client: S3Client;

  constructor(private readonly config: MediaStorageConfig) {
    this.client = createMediaS3Client(config);
  }

  get bucket(): string {
    if (!this.config.bucket) {
      throw new Error("S3_BUCKET_MEDIA is required for media uploads");
    }

    return this.config.bucket;
  }

  createUploadInstruction(input: UploadInstructionInput): UploadInstruction {
    const headers: Record<string, string> = {};
    if (input.mimeType) {
      headers["content-type"] = input.mimeType;
    }
    if (input.byteSize !== null) {
      headers["content-length"] = String(input.byteSize);
    }
    if (input.checksum) {
      headers["x-amz-checksum-sha256"] = input.checksum;
    }

    return {
      method: "PUT",
      bucket: this.bucket,
      object_key: assertSafeObjectKey(input.objectKey),
      headers,
      presigned_url: null,
      expires_at: null,
    };
  }
}

export function createMediaStorageFromEnv(env: NodeJS.ProcessEnv = process.env): MediaStorageService {
  return new MediaStorageService(loadMediaStorageConfigFromEnv(env));
}
