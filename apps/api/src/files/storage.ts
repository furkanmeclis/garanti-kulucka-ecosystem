import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
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

export interface MultipartUploadInstructionInput {
  objectKey: string;
  mimeType: string;
  checksum: string;
}

export interface MultipartUploadInstruction {
  method: "POST";
  bucket: string;
  object_key: string;
  upload_id: string;
}

export interface MultipartPartInstructionInput {
  objectKey: string;
  uploadId: string;
  partNumber: number;
  checksum: string | null;
}

export interface MultipartPartInstruction {
  method: "PUT";
  bucket: string;
  object_key: string;
  upload_id: string;
  part_number: number;
  headers: Record<string, string>;
  presigned_url: string | null;
  expires_at: string | null;
}

export interface CompleteMultipartUploadInput {
  objectKey: string;
  uploadId: string;
  parts: Array<{
    partNumber: number;
    etag: string;
    checksumSHA256?: string | null;
  }>;
}

export interface DownloadInstruction {
  method: "GET";
  bucket: string;
  object_key: string;
  headers: Record<string, string>;
  presigned_url: string | null;
  expires_at: string | null;
}

export interface DeleteObjectResult {
  provider: "garage";
  bucket: string;
  object_key: string;
  operation: "delete_object";
  deletion_performed: true;
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

  async createMultipartUploadInstruction(
    input: MultipartUploadInstructionInput,
  ): Promise<MultipartUploadInstruction> {
    const objectKey = assertSafeObjectKey(input.objectKey);
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: input.mimeType,
      ChecksumAlgorithm: "SHA256",
    });
    const response = await this.client.send(command);

    if (!response.UploadId) {
      throw new Error("Garage did not return a multipart upload id");
    }

    return {
      method: "POST",
      bucket: this.bucket,
      object_key: objectKey,
      upload_id: response.UploadId,
    };
  }

  async createMultipartPartInstruction(
    input: MultipartPartInstructionInput,
  ): Promise<MultipartPartInstruction> {
    const objectKey = assertSafeObjectKey(input.objectKey);
    const expiresIn = Math.max(60, Math.min(3600, this.config.uploadUrlExpiresSeconds));
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const headers: Record<string, string> = {};
    if (input.checksum) {
      headers["x-amz-checksum-sha256"] = input.checksum;
    }
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: objectKey,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
      ChecksumSHA256: input.checksum ?? undefined,
    });

    return {
      method: "PUT",
      bucket: this.bucket,
      object_key: objectKey,
      upload_id: input.uploadId,
      part_number: input.partNumber,
      headers,
      presigned_url: await getSignedUrl(this.client, command, { expiresIn }),
      expires_at: expiresAt,
    };
  }

  async completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<void> {
    const objectKey = assertSafeObjectKey(input.objectKey);
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
            ChecksumSHA256: part.checksumSHA256 ?? undefined,
          })),
        },
      }),
    );
  }

  async abortMultipartUpload(objectKeyInput: string, uploadId: string): Promise<void> {
    const objectKey = assertSafeObjectKey(objectKeyInput);
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: uploadId,
      }),
    );
  }

  async createDownloadInstruction(objectKeyInput: string): Promise<DownloadInstruction> {
    const objectKey = assertSafeObjectKey(objectKeyInput);
    const expiresIn = Math.max(60, Math.min(3600, this.config.uploadUrlExpiresSeconds));
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });

    return {
      method: "GET",
      bucket: this.bucket,
      object_key: objectKey,
      headers: {},
      presigned_url: await getSignedUrl(this.client, command, { expiresIn }),
      expires_at: expiresAt,
    };
  }

  async deleteObject(objectKeyInput: string): Promise<DeleteObjectResult> {
    const objectKey = assertSafeObjectKey(objectKeyInput);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );

    return {
      provider: "garage",
      bucket: this.bucket,
      object_key: objectKey,
      operation: "delete_object",
      deletion_performed: true,
    };
  }
}

export function createMediaStorageFromEnv(env: NodeJS.ProcessEnv = process.env): MediaStorageService {
  return new MediaStorageService(loadMediaStorageConfigFromEnv(env));
}
