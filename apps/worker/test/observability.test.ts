import { describe, expect, it, vi } from "vitest";
import { MetricsRegistry, type JobEnvelope, type ProviderAttempt } from "@garanti-kulucka/shared";
import {
  createWorkerHttpHandler,
  createWorkerMetrics,
  MetricsProviderAttemptRepository,
  recordJobCompletion,
  recordJobFailure,
  registerQueueDepthCollector,
} from "../src/observability.js";

function attempt(overrides: Partial<ProviderAttempt> = {}): ProviderAttempt {
  return {
    provider: "ptt",
    operation: "shipment.create",
    direction: "outbound",
    request_id: "req_1",
    started_at: "2026-01-01T00:00:00.000Z",
    duration_ms: 120,
    status: "success",
    status_code: 200,
    retry_decision: "none",
    next_retry_at: null,
    idempotency_key: null,
    request_metadata: {},
    response_metadata: {},
    error: null,
    ...overrides,
  } as ProviderAttempt;
}

describe("worker metrics", () => {
  it("records provider attempt latency and error rate and still delegates persistence", async () => {
    const metrics = createWorkerMetrics(new MetricsRegistry());
    const inner = { persist: vi.fn(async () => ({ id: 1 }) as never) };
    const repository = new MetricsProviderAttemptRepository(metrics, inner);
    await repository.persist(attempt());
    await repository.persist(attempt({ status: "retryable_failure", status_code: 503 }));
    await new MetricsProviderAttemptRepository(metrics).persist(attempt({ status: "terminal_failure" }));

    expect(inner.persist).toHaveBeenCalledTimes(2);
    expect(metrics.providerErrors.get({ provider: "ptt", operation: "shipment.create" })).toBe(2);
    const text = await metrics.registry.render();
    expect(text).toContain('provider_attempts_total{operation="shipment.create",provider="ptt",status="success"} 1');
    expect(text).toContain('provider_attempt_duration_seconds_sum{operation="shipment.create",provider="ptt",status="success"} 0.12');
  });

  it("separates retries from dead letters", () => {
    const metrics = createWorkerMetrics(new MetricsRegistry());
    recordJobFailure(metrics, "provider-delivery", { attemptsMade: 1, opts: { attempts: 5 } } as never);
    recordJobFailure(metrics, "provider-delivery", { attemptsMade: 5, opts: { attempts: 5 } } as never);
    recordJobFailure(metrics, "provider-delivery", undefined);
    expect(metrics.queueRetries.get({ queue: "provider-delivery" })).toBe(1);
    expect(metrics.queueDeadLetters.get({ queue: "provider-delivery" })).toBe(2);
  });

  it("captures migration progress per entity and storage orphan candidates", async () => {
    const metrics = createWorkerMetrics(new MetricsRegistry());
    const envelope = {
      job_id: "job_report",
      queue: "migration-reports",
      name: "migration.report",
      requested_at: "2026-01-01T00:00:00.000Z",
      payload: {
        run_id: "run_1",
        report_type: "dry-run",
        report: { entities: [{ entity: "customers", plannedRows: 42, blockedRows: 3 }] },
      },
    } as JobEnvelope;
    recordJobCompletion(metrics, "migration-reports", envelope, {}, new Date("2026-01-01T00:00:10.000Z"));
    recordJobCompletion(metrics, "storage-orphan-reconciliation", { ...envelope, queue: "storage-orphan-reconciliation" } as JobEnvelope, {
      mode: "dry_run",
      status: "reported",
      candidates: [{ bucket: "media", deleted: false }, { bucket: "media", deleted: false }],
      summary: { candidate_count: 2, deleted_count: 0 },
    });

    expect(metrics.migrationRows.get({ run_id: "run_1", report_type: "dry-run", entity: "customers", state: "planned" })).toBe(42);
    expect(metrics.migrationRows.get({ run_id: "run_1", report_type: "dry-run", entity: "customers", state: "blocked" })).toBe(3);
    expect(metrics.migrationReportReceived.get({ run_id: "run_1", report_type: "dry-run" })).toBe(1767225610);
    expect(metrics.storageOrphanCandidates.get({ bucket: "media" })).toBe(2);
  });

  it("collects queue depth at scrape time", async () => {
    const metrics = createWorkerMetrics(new MetricsRegistry());
    const queue = { getJobCounts: vi.fn(async () => ({ waiting: 4, active: 1, delayed: 0, failed: 9 })) };
    registerQueueDepthCollector(metrics, new Map([["provider-webhooks", queue as never]]));
    const text = await metrics.registry.render();
    expect(text).toContain('queue_jobs{queue="provider-webhooks",state="waiting"} 4');
    expect(text).toContain('queue_jobs{queue="provider-webhooks",state="failed"} 9');
    expect(text).toContain('queue_jobs{queue="provider-webhooks",state="prioritized"} 0');
  });
});

describe("worker health and metrics endpoints", () => {
  const metrics = createWorkerMetrics(new MetricsRegistry());

  it("separates liveness from dependency readiness", async () => {
    const handler = createWorkerHttpHandler({
      metrics,
      health: { redis: { ping: async () => "PONG" }, db: null },
      exposure: { enabled: false, token: null, port: null },
    });
    const live = await handler("GET", "/health/live", undefined);
    expect(live.status).toBe(200);
    const ready = await handler("GET", "/health/ready", undefined);
    expect(ready.status).toBe(503);
    expect(JSON.parse(ready.body)).toMatchObject({
      service: "worker",
      status: "degraded",
      dependencies: { redis: { status: "ok" }, database: { status: "degraded", error: "not_configured" } },
    });
  });

  it("reports ready when redis and database respond", async () => {
    const db = { selectFrom: () => ({ select: () => ({ limit: () => ({ execute: async () => [] }) }) }) };
    const handler = createWorkerHttpHandler({
      metrics,
      health: { redis: { ping: async () => "PONG" }, db: db as never },
      exposure: { enabled: false, token: null, port: null },
    });
    expect((await handler("GET", "/health/ready", undefined)).status).toBe(200);
    const failing = createWorkerHttpHandler({
      metrics,
      health: { redis: { ping: async () => { throw new Error("ECONNREFUSED"); } }, db: db as never },
      exposure: { enabled: false, token: null, port: null },
    });
    const response = await failing("GET", "/health/ready", undefined);
    expect(response.status).toBe(503);
    expect(JSON.parse(response.body).dependencies.redis).toMatchObject({ status: "degraded", error: "ECONNREFUSED" });
  });

  it("protects /metrics", async () => {
    const health = { redis: { ping: async () => "PONG" }, db: null };
    const disabled = createWorkerHttpHandler({ metrics, health, exposure: { enabled: false, token: "t", port: null } });
    expect((await disabled("GET", "/metrics", "Bearer t")).status).toBe(404);
    const tokened = createWorkerHttpHandler({ metrics, health, exposure: { enabled: true, token: "t", port: null } });
    expect((await tokened("GET", "/metrics", undefined)).status).toBe(401);
    const ok = await tokened("GET", "/metrics", "Bearer t");
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("# TYPE queue_jobs gauge");
    const internal = createWorkerHttpHandler({ metrics, health, exposure: { enabled: true, token: null, port: 9465 }, internalListener: true });
    expect((await internal("GET", "/metrics", undefined)).status).toBe(200);
    const publicNoToken = createWorkerHttpHandler({ metrics, health, exposure: { enabled: true, token: null, port: 9465 } });
    expect((await publicNoToken("GET", "/metrics", undefined)).status).toBe(404);
  });
});
