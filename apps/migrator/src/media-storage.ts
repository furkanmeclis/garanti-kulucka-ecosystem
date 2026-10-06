import { createHash } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

export const defaultLegacyMediaBucket = "gk-legacy-media";
export const legacyMediaUriKeyPrefix = "mesajlar";

export interface InlineMediaObject {
  readonly checksum: string;
  readonly mimeType: string;
  readonly size: number;
  readonly bucket: string;
  readonly objectKey: string;
}

export interface StoredMediaObjectHead {
  readonly size: number;
}

export interface MigratorMediaStorage {
  storeInlineDataUrl(input: {
    readonly dataUrl: string;
    readonly sourceTable: string;
    readonly sourceId: string;
  }): Promise<InlineMediaObject>;
  /**
   * HEAD an already-stored object (e.g. bridge-extracted legacy media). Returns null when the
   * object does not exist; any other storage failure must throw so apply fails closed.
   */
  headObject(input: { readonly bucket: string; readonly objectKey: string }): Promise<StoredMediaObjectHead | null>;
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

  async headObject(input: { readonly bucket: string; readonly objectKey: string }): Promise<StoredMediaObjectHead | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: input.bucket, Key: input.objectKey }));
      if (typeof head.ContentLength !== "number" || !Number.isSafeInteger(head.ContentLength) || head.ContentLength < 0) {
        throw new Error(`Storage HEAD for ${input.bucket}/${input.objectKey} returned no valid content length`);
      }
      return { size: head.ContentLength };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "NotFound"
    || candidate.name === "NoSuchKey"
    || candidate.$metadata?.httpStatusCode === 404;
}

export function legacyMediaBucketFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MIGRATION_LEGACY_MEDIA_BUCKET?.trim();
  const bucket = configured ? configured : defaultLegacyMediaBucket;
  if (!isValidS3BucketName(bucket)) {
    throw new Error("MIGRATION_LEGACY_MEDIA_BUCKET must be a valid S3 bucket name");
  }
  return bucket;
}

export interface LegacyMediaObjectReference {
  readonly uri: string;
  readonly bucket: string;
  readonly objectKey: string;
  readonly checksum: string;
  readonly extension: string;
  readonly mimeType: string;
}

export type LegacyMediaUriParseResult =
  | { readonly ok: true; readonly reference: LegacyMediaObjectReference }
  | { readonly ok: false; readonly reason: string };

const legacyMediaExtensionMimeTypes: Readonly<Record<string, string>> = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  ogg: "audio/ogg",
  opus: "audio/opus",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
  wav: "audio/wav",
  pdf: "application/pdf",
});

export const legacyMediaUriExtensions: readonly string[] = Object.freeze(Object.keys(legacyMediaExtensionMimeTypes).sort());

export function isLegacyMediaUri(value: unknown): value is string {
  return typeof value === "string" && value.slice(0, 5).toLowerCase() === "s3://";
}

/**
 * Strictly parses bridge-extracted legacy media URIs of the form
 * s3://<legacy-bucket>/mesajlar/<sha256-hex>.<ext>. The key is a content hash, so the checksum is
 * taken from the key. MIME comes from media_type when it is a full MIME type, otherwise from the
 * extension (legacy media_type values are often just "image"/"video").
 */
export function parseLegacyMediaUri(
  uri: string,
  options: { readonly expectedBucket: string; readonly mediaType?: unknown },
): LegacyMediaUriParseResult {
  const fail = (reason: string): LegacyMediaUriParseResult => Object.freeze({ ok: false as const, reason });
  if (!uri.startsWith("s3://")) return fail("scheme must be lowercase s3://");
  const rest = uri.slice("s3://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return fail("URI must contain a bucket and an object key");
  const bucket = rest.slice(0, slash);
  const objectKey = rest.slice(slash + 1);
  if (!isValidS3BucketName(bucket)) return fail("bucket name has invalid characters or length");
  if (bucket !== options.expectedBucket) {
    return fail(`bucket ${bucket} does not match configured legacy media bucket ${options.expectedBucket}`);
  }
  const keyMatch = /^([a-z0-9_-]+)\/([^/]+)$/.exec(objectKey);
  if (!keyMatch || keyMatch[1] !== legacyMediaUriKeyPrefix) {
    return fail(`object key must be ${legacyMediaUriKeyPrefix}/<sha256-hex>.<ext>`);
  }
  const fileMatch = /^([0-9a-f]{64})\.([a-z0-9]{1,8})$/.exec(keyMatch[2]!);
  if (!fileMatch) return fail("object key file name must be a lowercase 64-hex sha256 with an extension");
  const extension = fileMatch[2]!;
  const extensionMime = legacyMediaExtensionMimeTypes[extension];
  if (extensionMime === undefined) return fail(`unknown media extension .${extension}`);
  const declaredMime = typeof options.mediaType === "string" ? options.mediaType.trim().toLowerCase() : "";
  const mimeType = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(declaredMime)
    ? declaredMime
    : extensionMime;
  return Object.freeze({
    ok: true as const,
    reference: Object.freeze({
      uri,
      bucket,
      objectKey,
      checksum: `sha256:${fileMatch[1]!}`,
      extension,
      mimeType,
    }),
  });
}

function isValidS3BucketName(bucket: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) && !bucket.includes("..");
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
