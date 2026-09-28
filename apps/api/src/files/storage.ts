import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertSafeObjectKey } from "./object-key.js";

export interface MediaStorageConfig {
  endpoint: string | null;
  region: string;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  bucket: string | null;
  uploadUrlExpiresSeconds: number;
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

function parseUploadUrlExpiresSeconds(input: string | undefined): number {
  const parsed = Number(input ?? 900);
  return Number.isFinite(parsed) ? parsed : 900;
}

export function loadMediaStorageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MediaStorageConfig {
  return {
    endpoint: env.S3_ENDPOINT ?? null,
    region: env.S3_REGION ?? "garage",
    accessKeyId: env.S3_ACCESS_KEY_ID ?? null,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? null,
    bucket: env.S3_BUCKET_MEDIA ?? null,
    uploadUrlExpiresSeconds: parseUploadUrlExpiresSeconds(env.S3_UPLOAD_URL_EXPIRES_SECONDS),
  };
}

export function createMediaS3Client(config: MediaStorageConfig): S3Client {
  const clientConfig: S3ClientConfig = {
    region: config.region,
    forcePathStyle: true,
  };

  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
  }

  if (config.accessKeyId && config.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
  }

  return new S3Client(clientConfig);
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

  async createUploadInstruction(input: UploadInstructionInput): Promise<UploadInstruction> {
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
    const objectKey = assertSafeObjectKey(input.objectKey);
    const expiresIn = Math.max(60, Math.min(3600, this.config.uploadUrlExpiresSeconds));
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: input.mimeType ?? undefined,
      ContentLength: input.byteSize ?? undefined,
      ChecksumSHA256: input.checksum ?? undefined,
    });

    return {
      method: "PUT",
      bucket: this.bucket,
      object_key: objectKey,
      headers,
      presigned_url: await getSignedUrl(this.client, command, { expiresIn }),
      expires_at: expiresAt,
    };
  }
}

export function createMediaStorageFromEnv(env: NodeJS.ProcessEnv = process.env): MediaStorageService {
  return new MediaStorageService(loadMediaStorageConfigFromEnv(env));
}
