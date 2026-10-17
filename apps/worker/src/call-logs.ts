import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  CallLogsRepository,
  sql,
  type AppDatabase,
} from "@garanti-kulucka/database";
import type {
  JobEnvelope,
  ProviderRequestEnvelope,
} from "@garanti-kulucka/shared";
import type { ProviderAccountConfigRepository } from "./providers/account-config.js";
import type { ProviderAttemptRepository } from "./providers/attempts.js";
import {
  sendNetgsmLiveRequest,
  NetgsmLiveTransportError,
  type NetgsmFetchTransport,
} from "./providers/netgsm.js";
import { createWorkerMediaS3Client } from "./providers/media-files.js";

export function previousIstanbulDay(now = new Date()) {
  const local = new Date(now.getTime() + 3 * 3600000);
  local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}
export function assertRecordingUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname === "netgsm.com.tr" ||
      url.hostname.endsWith(".netgsm.com.tr")
    )
  )
    throw new Error("Untrusted recording URL");
  return url.toString();
}
export async function downloadRecording(
  url: string,
  transport: typeof fetch = fetch,
) {
  const response = await transport(assertRecordingUrl(url), {
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok || !response.body)
    throw new Error("Recording download failed");
  const mime = (response.headers.get("content-type") ?? "audio/wav").split(
    ";",
  )[0]!;
  if (!/^(audio\/|application\/octet-stream)/.test(mime))
    throw new Error("Recording is not audio");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 100 * 1024 * 1024) {
      await response.body.cancel().catch(() => undefined);
      throw new Error("Recording exceeds 100 MB");
    }
    chunks.push(chunk);
  }
  if (!size) throw new Error("Empty recording");
  return { bytes: Buffer.concat(chunks), mime };
}
export interface CallLogJobs {
  run(job: JobEnvelope): Promise<unknown>;
}
export class DatabaseCallLogJobs implements CallLogJobs {
  constructor(
    private readonly db: AppDatabase,
    private readonly configs: ProviderAccountConfigRepository,
    private readonly attempts: ProviderAttemptRepository,
    private readonly publish: (job: JobEnvelope) => Promise<unknown>,
    private readonly transport?: NetgsmFetchTransport,
    private readonly download: typeof downloadRecording = downloadRecording,
    private readonly put = async (
      bucket: string,
      key: string,
      bytes: Buffer,
      mime: string,
    ) => {
      const client = createWorkerMediaS3Client();
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: mime,
          }),
        );
      } finally {
        client.destroy();
      }
    },
  ) {}
  private async account() {
    const account = await this.db
      .selectFrom("integration_accounts")
      .innerJoin(
        "integration_providers",
        "integration_providers.id",
        "integration_accounts.provider_id",
      )
      .select("integration_accounts.public_id")
      .where("integration_providers.key", "=", "netgsm")
      .where("integration_accounts.status", "=", "active")
      .orderBy("integration_accounts.id")
      .executeTakeFirst();
    return account
      ? this.configs.getAccountConfig("netgsm", account.public_id)
      : null;
  }
  async run(job: JobEnvelope) {
    const account = await this.account();
    if (!account?.live_mode)
      return { status: "live_mode_disabled", live_call_performed: false };
    if (job.name === "netgsm.call.recording.archive")
      return this.archive(String(job.payload.call_log_public_id));
    if (job.name !== "netgsm.call.reconcile")
      throw new Error("Unknown call log job");
    const day = previousIstanbulDay();
    const envelope: ProviderRequestEnvelope = {
      request_id: `req_call_reconcile_${day}`,
      provider: "netgsm",
      operation: "call.report",
      direction: "outbound",
      channel: "voice",
      account_public_id: account.account_public_id,
      occurred_at: new Date().toISOString(),
      payload: { start_date: day, stop_date: day },
      legacy_contract: {
        source: "Netsantral nightly reconciliation",
        legacy_event: "netsantral-report",
      },
    };
    // A cluster-wide lock + persisted attempt times enforce <= 2 reports/minute, also across retries.
    await this.db.transaction().execute(async (db) => {
      await sql`SELECT pg_advisory_xact_lock(734031)`.execute(db);
      const last = await db
        .selectFrom("provider_attempts")
        .innerJoin(
          "integration_providers",
          "integration_providers.id",
          "provider_attempts.provider_id",
        )
        .select("provider_attempts.started_at")
        .where("integration_providers.key", "=", "netgsm")
        .where("operation", "=", "call.report")
        .orderBy("started_at", "desc")
        .executeTakeFirst();
      const wait = last
        ? Math.min(
            31000,
            Math.max(
              0,
              31000 - (Date.now() - new Date(last.started_at).getTime()),
            ),
          )
        : 0;
      if (wait) await sql`SELECT pg_sleep(${wait / 1000})`.execute(db);
      const result = await sendNetgsmLiveRequest({
        envelope,
        job,
        accountConfig: account,
        policy: {
          contract_mode: "live",
          live_call_permitted: true,
          reason: "account_live_mode_enabled",
          timeout_ms: 30000,
          max_attempts: 5,
        },
        attemptNumber: 1,
        maxAttempts: 5,
        ...(this.transport ? { transport: this.transport } : {}),
      }).catch(async (error: unknown) => {
        if (error instanceof NetgsmLiveTransportError)
          await this.attempts.persist(error.attempt);
        throw error;
      });
      await this.attempts.persist(result.attempt);
      const records = result.response_payload.records as Array<{
        raw?: Record<string, unknown>;
      }>;
      for (const record of records)
        if (record.raw)
          await new CallLogsRepository(this.db).ingest(
            record.raw,
            "netgsm_report",
          );
    });
    // Also recovers enqueue/archival failures after a webhook was durably stored.
    const pending = await this.db
      .selectFrom("call_logs")
      .select("public_id")
      .where("recording_url", "is not", null)
      .where("recording_file_id", "is", null)
      .limit(1000)
      .execute();
    for (const call of pending)
      await this.publish({
        job_id: `job_recording_${call.public_id}`,
        queue: "provider-delivery",
        name: "netgsm.call.recording.archive",
        payload: { call_log_public_id: call.public_id },
        requested_at: new Date().toISOString(),
      });
    return { status: "reconciled", day };
  }
  async archive(publicId: string) {
    return this.db.transaction().execute(async (db) => {
      const call = await db
        .selectFrom("call_logs")
        .selectAll()
        .where("public_id", "=", publicId)
        .forUpdate()
        .executeTakeFirst();
      if (!call?.recording_url || call.recording_file_id)
        return { status: "already_archived_or_missing" };
      const bucket = process.env.S3_BUCKET_MEDIA;
      if (!bucket) throw new Error("S3_BUCKET_MEDIA missing");
      const { bytes, mime } = await this.download(call.recording_url);
      const key = `call-recordings/${call.public_id}/recording`;
      await this.put(bucket, key, bytes, mime);
      const file = await db
        .insertInto("files")
        .values({
          public_id: `fil_${call.public_id}`,
          bucket,
          object_key: key,
          original_name: `${call.public_id}.wav`,
          mime_type: mime,
          byte_size: bytes.byteLength,
          checksum: createHash("sha256").update(bytes).digest("base64"),
          upload_status: "available",
          scan_status: "skipped",
          upload_type: "singlepart",
          multipart_upload_id: null,
          completed_at: new Date(),
          abandoned_at: null,
          created_by_user_id: call.user_id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .updateTable("call_logs")
        .set({ recording_file_id: file.id, updated_at: new Date() })
        .where("id", "=", call.id)
        .execute();
      return { status: "archived", public_id: call.public_id };
    });
  }
}
