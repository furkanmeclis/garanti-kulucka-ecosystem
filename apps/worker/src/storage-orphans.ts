import { DeleteObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type { AppDatabase } from "@garanti-kulucka/database";

export interface StorageOrphanReconciliationInput {
  mode: "dry_run" | "apply";
  limit: number;
  deleteEnabled: boolean;
}

export interface StorageOrphanReconciliationResult {
  queue: "storage-orphan-reconciliation";
  status: "reported" | "deleted" | "delete_disabled";
  mode: "dry_run" | "apply";
  candidates: Array<{
    public_id: string;
    bucket: string;
    object_key: string;
    upload_status: string;
    action: "report_only" | "delete_object";
    deleted: boolean;
  }>;
  summary: {
    candidate_count: number;
    deleted_count: number;
  };
}

export class StorageOrphanReconciler {
  private readonly client: S3Client;

  constructor(
    private readonly db: AppDatabase,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
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
    this.client = new S3Client(clientConfig);
  }

  async reconcile(input: StorageOrphanReconciliationInput): Promise<StorageOrphanReconciliationResult> {
    const limit = Math.max(1, Math.min(100, input.limit));
    const candidates = await this.db
      .selectFrom("files")
      .leftJoin("message_attachments", "message_attachments.file_id", "files.id")
      .select([
        "files.public_id",
        "files.bucket",
        "files.object_key",
        "files.upload_status",
      ])
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
      .limit(limit)
      .execute();

    const apply = input.mode === "apply" && input.deleteEnabled;
    const results = [];
    let deletedCount = 0;

    for (const candidate of candidates) {
      if (apply) {
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: candidate.bucket,
            Key: candidate.object_key,
          }),
        );
        deletedCount += 1;
      }

      results.push({
        public_id: candidate.public_id,
        bucket: candidate.bucket,
        object_key: candidate.object_key,
        upload_status: candidate.upload_status,
        action: apply ? "delete_object" as const : "report_only" as const,
        deleted: apply,
      });
    }

    return {
      queue: "storage-orphan-reconciliation",
      status: input.mode === "apply" && !input.deleteEnabled ? "delete_disabled" : apply ? "deleted" : "reported",
      mode: input.mode,
      candidates: results,
      summary: {
        candidate_count: candidates.length,
        deleted_count: deletedCount,
      },
    };
  }
}
