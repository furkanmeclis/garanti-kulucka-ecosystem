import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

export interface InlineMediaObject {
  readonly checksum: string;
  readonly mimeType: string;
  readonly size: number;
  readonly bucket: string;
  readonly objectKey: string;
}

export interface MigratorMediaStorage {
  storeInlineDataUrl(input: {
    readonly dataUrl: string;
    readonly sourceTable: string;
    readonly sourceId: string;
  }): Promise<InlineMediaObject>;
}

export interface MigratorMediaStorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly prefix: string;
}

export function createMigratorMediaStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MigratorMediaStorage | null {
  const endpoint = env.MIGRATION_MEDIA_S3_ENDPOINT ?? env.S3_ENDPOINT;
  const accessKeyId = env.MIGRATION_MEDIA_S3_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.MIGRATION_MEDIA_S3_SECRET_ACCESS_KEY ?? env.S3_SECRET_ACCESS_KEY;
  const bucket = env.MIGRATION_MEDIA_S3_BUCKET ?? env.S3_BUCKET_MEDIA;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
  return new S3MigratorMediaStorage({
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    region: env.MIGRATION_MEDIA_S3_REGION ?? env.S3_REGION ?? "garage",
    prefix: env.MIGRATION_MEDIA_S3_PREFIX ?? "legacy-migration",
  });
}

export class S3MigratorMediaStorage implements MigratorMediaStorage {
  private readonly client: S3Client;

  constructor(private readonly config: MigratorMediaStorageConfig) {
    const clientConfig: S3ClientConfig = {
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.client = new S3Client(clientConfig);
  }

  async storeInlineDataUrl(input: {
    readonly dataUrl: string;
    readonly sourceTable: string;
    readonly sourceId: string;
  }): Promise<InlineMediaObject> {
    const decoded = decodeDataUrl(input.dataUrl);
    const checksum = `sha256:${createHash("sha256").update(decoded.bytes).digest("hex")}`;
    const objectKey = mediaObjectKey({
      prefix: this.config.prefix,
      checksum,
      mimeType: decoded.mimeType,
      sourceTable: input.sourceTable,
      sourceId: input.sourceId,
    });
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: objectKey,
      Body: decoded.bytes,
      ContentType: decoded.mimeType,
      ContentLength: decoded.bytes.byteLength,
    }));
    return {
      checksum,
      mimeType: decoded.mimeType,
      size: decoded.bytes.byteLength,
      bucket: this.config.bucket,
      objectKey,
    };
  }
}

export function decodeDataUrl(dataUrl: string): { readonly mimeType: string; readonly bytes: Buffer } {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Inline media URL must be a valid data: URL");
  const mimeType = match[1]!.toLowerCase();
  const encoded = match[3]!;
  const bytes = match[2]
    ? Buffer.from(encoded.replace(/\s/g, ""), "base64")
    : Buffer.from(decodeURIComponent(encoded), "utf8");
  return { mimeType, bytes };
}

function mediaObjectKey(input: {
  readonly prefix: string;
  readonly checksum: string;
  readonly mimeType: string;
  readonly sourceTable: string;
  readonly sourceId: string;
}): string {
  const extension = extensionForMime(input.mimeType);
  const safePrefix = input.prefix.split("/").filter(Boolean).join("/");
  const digest = input.checksum.slice("sha256:".length);
  const source = `${input.sourceTable.replace(/[^a-zA-Z0-9_-]/g, "_")}-${input.sourceId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return `${safePrefix}/messages/${digest.slice(0, 2)}/${digest}-${source}${extension}`;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "video/mp4") return ".mp4";
  if (mimeType === "application/pdf") return ".pdf";
  const subtype = mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return subtype ? `.${subtype}` : "";
}
