import { createServer, type Server } from "node:http";
import type { Job, Queue } from "bullmq";
import type { AppDatabase } from "@garanti-kulucka/database";
import {
  authorizeMetricsRequest,
  healthStatusSchema,
  MetricsRegistry,
  migrationProgressFromReport,
  PROMETHEUS_CONTENT_TYPE,
  resolveMetricsExposure,
  type JobEnvelope,
  type MetricsExposureConfig,
  type ProviderAttempt,
  type QueueName,
} from "@garanti-kulucka/shared";
import type { ProviderAttemptRepository, StoredProviderAttempt } from "./providers/attempts.js";

export function createWorkerMetrics(registry = new MetricsRegistry({ service: "worker" })) {
  return {
    registry,
    queueJobs: registry.gauge("queue_jobs", "BullMQ job counts per queue and state."),
    queueRetries: registry.counter("queue_job_retries_total", "Failed job attempts that will be retried by BullMQ."),
    queueDeadLetters: registry.counter(
      "queue_job_dead_letters_total",
      "Jobs that exhausted all attempts and moved to the failed (dead-letter) set.",
    ),
    providerDuration: registry.histogram("provider_attempt_duration_seconds", "Provider attempt latency in seconds."),
    providerAttempts: registry.counter("provider_attempts_total", "Provider attempts recorded by the worker."),
    providerErrors: registry.counter("provider_attempt_errors_total", "Provider attempts that did not succeed."),
    migrationRows: registry.gauge(
      "migration_rows",
      "Rows per migration entity and state from the latest migrator report of a run.",
    ),
    migrationReportReceived: registry.gauge(
      "migration_report_last_received_timestamp_seconds",
      "Unix time the worker last accepted a migrator report for a run.",
    ),
    storageOrphanCandidates: registry.gauge(
      "storage_orphan_candidate_count",
      "Current count of file metadata rows eligible for orphan object cleanup.",
    ),
    storageOrphanApply: registry.counter(
      "storage_orphan_cleanup_apply_total",
      "Total controlled orphan cleanup apply attempts that reached the delete gate.",
    ),
    dataRetentionCandidates: registry.gauge(
      "data_retention_candidate_rows",
      "Rows past their retention window still present after the last data.retention.prune run.",
    ),
    dataRetentionDeleted: registry.counter(
      "data_retention_deleted_rows_total",
      "Rows deleted by data.retention.prune.",
    ),
    storageOrphanErrors: registry.counter(
      "storage_orphan_cleanup_error_total",
      "Total controlled orphan cleanup failures grouped by operational result code.",
    ),
  };
}

export type WorkerMetrics = ReturnType<typeof createWorkerMetrics>;

export function recordProviderAttempt(metrics: WorkerMetrics, attempt: ProviderAttempt): void {
  const labels = { provider: attempt.provider, operation: attempt.operation, status: attempt.status };
  metrics.providerAttempts.inc(labels);
  metrics.providerDuration.observe(labels, attempt.duration_ms / 1000);
  if (attempt.status !== "success") {
    metrics.providerErrors.inc({ provider: attempt.provider, operation: attempt.operation });
  }
}

/** Records metrics for every attempt, then delegates persistence when a database repository exists. */
export class MetricsProviderAttemptRepository implements ProviderAttemptRepository {
  constructor(
    private readonly metrics: WorkerMetrics,
    private readonly inner?: ProviderAttemptRepository,
  ) {}

  async persist(attempt: ProviderAttempt): Promise<StoredProviderAttempt> {
    recordProviderAttempt(this.metrics, attempt);
    if (this.inner) {
      return this.inner.persist(attempt);
    }
    return undefined as unknown as StoredProviderAttempt;
  }
}

export function recordJobFailure(metrics: WorkerMetrics, queue: QueueName, job: Job<JobEnvelope> | undefined): void {
  const maxAttempts = Math.max(1, Number(job?.opts?.attempts ?? 1));
  const attemptsMade = job?.attemptsMade ?? maxAttempts;
  if (attemptsMade >= maxAttempts) {
    metrics.queueDeadLetters.inc({ queue });
  } else {
    metrics.queueRetries.inc({ queue });
  }
}

export function recordJobCompletion(
  metrics: WorkerMetrics,
  queue: QueueName,
  data: JobEnvelope,
  returnValue: unknown,
  now: Date = new Date(),
): void {
  if (queue === "migration-reports") {
    const payload = (data.payload ?? {}) as { run_id?: unknown; report_type?: unknown; report?: unknown };
    const runId = typeof payload.run_id === "string" ? payload.run_id : "unknown";
    const reportType = typeof payload.report_type === "string" ? payload.report_type : "unknown";
    for (const sample of migrationProgressFromReport(payload.report)) {
      metrics.migrationRows.set(
        { run_id: runId, report_type: reportType, entity: sample.entity, state: sample.state },
        sample.rows,
      );
    }
    metrics.migrationReportReceived.set({ run_id: runId, report_type: reportType }, Math.floor(now.getTime() / 1000));
  }

  if (queue === "data-retention" && returnValue && typeof returnValue === "object") {
    const result = returnValue as { tables?: Array<{ table?: string; candidates?: number; deleted?: number }> };
    for (const entry of result.tables ?? []) {
      const table = entry.table ?? "unknown";
      metrics.dataRetentionCandidates.set({ table }, Math.max(0, (entry.candidates ?? 0) - (entry.deleted ?? 0)));
      if (entry.deleted) metrics.dataRetentionDeleted.inc({ table }, entry.deleted);
    }
  }

  if (queue === "storage-orphan-reconciliation" && returnValue && typeof returnValue === "object") {
    const result = returnValue as {
      mode?: string;
      status?: string;
      candidates?: Array<{ bucket?: string; deleted?: boolean }>;
      summary?: { candidate_count?: number };
    };
    const byBucket = new Map<string, number>();
    for (const candidate of result.candidates ?? []) {
      const bucket = candidate.bucket ?? "unknown";
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
      if (result.mode === "apply") {
        metrics.storageOrphanApply.inc({ bucket, result_code: candidate.deleted ? "deleted" : (result.status ?? "unknown") });
      }
    }
    if (byBucket.size === 0) {
      metrics.storageOrphanCandidates.set({ bucket: "all" }, result.summary?.candidate_count ?? 0);
    }
    for (const [bucket, count] of byBucket) {
      metrics.storageOrphanCandidates.set({ bucket }, count);
    }
  }
}

const QUEUE_STATES = ["waiting", "active", "delayed", "failed", "prioritized", "waiting-children"] as const;

export function registerQueueDepthCollector(metrics: WorkerMetrics, queues: ReadonlyMap<QueueName, Queue<JobEnvelope>>): void {
  metrics.registry.addCollector(async () => {
    await Promise.all(
      [...queues.entries()].map(async ([name, queue]) => {
        const counts = await queue.getJobCounts(...QUEUE_STATES);
        for (const state of QUEUE_STATES) {
          metrics.queueJobs.set({ queue: name, state }, counts[state] ?? 0);
        }
      }),
    );
  });
}

export interface WorkerHealthDependencies {
  redis: { ping: () => Promise<unknown> };
  db: AppDatabase | null;
}

type DependencyStatus = { status: "ok" | "degraded"; latency_ms?: number; error?: string };

async function probe(check: () => Promise<unknown>): Promise<DependencyStatus> {
  const startedAt = performance.now();
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2_000).unref()),
    ]);
    return { status: "ok", latency_ms: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      status: "degraded",
      latency_ms: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

export async function workerReadiness(deps: WorkerHealthDependencies) {
  const dependencies: Record<string, DependencyStatus> = {
    redis: await probe(() => deps.redis.ping()),
    database: deps.db
      ? await probe(() => (deps.db as AppDatabase).selectFrom("roles").select("id").limit(1).execute())
      : { status: "degraded", error: "not_configured" },
  };
  const status = Object.values(dependencies).some((dependency) => dependency.status === "degraded") ? "degraded" : "ok";
  return healthStatusSchema.parse({
    status,
    service: "worker",
    timestamp: new Date().toISOString(),
    dependencies,
  });
}

export interface WorkerHttpServerOptions {
  metrics: WorkerMetrics;
  health: WorkerHealthDependencies;
  exposure?: MetricsExposureConfig;
  /** True when this listener is the dedicated internal metrics port. */
  internalListener?: boolean;
}

export function createWorkerHttpHandler(options: WorkerHttpServerOptions) {
  const exposure = options.exposure ?? resolveMetricsExposure(process.env);
  return async (method: string, url: string, authorization: string | undefined) => {
    const path = url.split("?")[0];
    if (method === "GET" && path === "/health/live") {
      const body = healthStatusSchema.parse({ status: "ok", service: "worker", timestamp: new Date().toISOString() });
      return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
    }
    if (method === "GET" && path === "/health/ready") {
      const body = await workerReadiness(options.health);
      return { status: body.status === "ok" ? 200 : 503, contentType: "application/json", body: JSON.stringify(body) };
    }
    if (method === "GET" && path === "/metrics") {
      const decision = authorizeMetricsRequest(exposure, authorization, options.internalListener ?? false);
      if (decision === "allowed") {
        return { status: 200, contentType: PROMETHEUS_CONTENT_TYPE, body: await options.metrics.registry.render() };
      }
      return { status: decision === "unauthorized" ? 401 : 404, contentType: "text/plain", body: "" };
    }
    return { status: 404, contentType: "text/plain", body: "" };
  };
}

export function startWorkerHttpServer(port: number, options: WorkerHttpServerOptions): Server {
  const handle = createWorkerHttpHandler(options);
  const server = createServer((request, response) => {
    void handle(request.method ?? "GET", request.url ?? "/", request.headers.authorization).then(
      (result) => {
        response.writeHead(result.status, { "content-type": result.contentType }).end(result.body);
      },
      () => {
        response.writeHead(500).end();
      },
    );
  });
  server.listen(port, process.env.WORKER_HTTP_HOST ?? "0.0.0.0");
  return server;
}
