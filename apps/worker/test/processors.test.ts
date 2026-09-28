import { describe, expect, it } from "vitest";
import {
  createWorkerProcessorRegistry,
  workerQueueNames,
  type WorkerLifecycleEvent,
} from "../src/processors.js";
import type { ProviderAttempt, QueueName } from "@garanti-kulucka/shared";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";

const now = new Date().toISOString();

function providerWebhookJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "bull_job_1",
    name: "meta.message.webhook",
    data: {
      job_id: "job_meta_1",
      queue: "provider-webhooks",
      name: "meta.message.webhook",
      requested_at: now,
      payload: {
        envelope: {
          request_id: "req_meta_1",
          provider: "meta",
          operation: "message.webhook",
          direction: "inbound",
          channel: "instagram",
          occurred_at: now,
          payload: {
            object: "instagram",
          },
        },
      },
      ...overrides,
    },
  };
}

function providerDeliveryJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "bull_job_2",
    name: "ptt.shipment.create",
    data: {
      job_id: "job_ptt_1",
      queue: "provider-delivery",
      name: "ptt.shipment.create",
      requested_at: now,
      payload: {
        envelope: {
          request_id: "req_ptt_1",
          provider: "ptt",
          operation: "shipment.create",
          direction: "outbound",
          channel: "cargo",
          occurred_at: now,
          payload: {
            order_public_id: "ord_1",
          },
        },
      },
      ...overrides,
    },
  };
}

function shipmentTrackingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "bull_job_tracking",
    name: "ptt.shipment.track",
    data: {
      job_id: "job_tracking_1",
      queue: "shipment-tracking",
      name: "ptt.shipment.track",
      requested_at: now,
      payload: {
        envelope: {
          request_id: "req_tracking_1",
          provider: "ptt",
          operation: "shipment.track",
          direction: "outbound",
          channel: "cargo",
          occurred_at: now,
          payload: {
            tracking_number: "PTT fixture tracking",
          },
        },
      },
      ...overrides,
    },
  };
}

describe("worker processor registry", () => {
  it("exposes processors for every declared worker queue", () => {
    const registry = createWorkerProcessorRegistry();

    expect(registry.queues).toEqual(workerQueueNames);
    expect([...registry.processors.keys()]).toEqual(workerQueueNames);
  });

  it("dispatches provider webhook fixtures and records lifecycle boundaries", async () => {
    const events: WorkerLifecycleEvent[] = [];
    const registry = createWorkerProcessorRegistry((event) => events.push(event));

    const result = await registry.dispatch("provider-webhooks", providerWebhookJob());

    expect(result).toMatchObject({
      provider: "meta",
      queue: "provider-webhooks",
      live_call_performed: false,
    });
    expect(events.map((event) => event.event)).toEqual(["started", "completed"]);
    expect(events.every((event) => event.queue === "provider-webhooks")).toBe(true);
  });

  it("dispatches provider delivery fixtures and keeps live calls disabled", async () => {
    const registry = createWorkerProcessorRegistry();

    await expect(registry.dispatch("provider-delivery", providerDeliveryJob())).resolves.toMatchObject({
      provider: "ptt",
      queue: "provider-delivery",
      live_call_performed: false,
    });
  });

  it("fails unknown provider job names and records failure lifecycle", async () => {
    const events: WorkerLifecycleEvent[] = [];
    const registry = createWorkerProcessorRegistry((event) => events.push(event));
    const job = providerDeliveryJob({
      name: "ptt.unknown.job",
    });

    await expect(
      registry.dispatch("provider-delivery", {
        ...job,
        name: "ptt.unknown.job",
      }),
    ).rejects.toThrow("Unknown provider job name");
    expect(events.map((event) => event.event)).toEqual(["started", "failed"]);
    expect(events.at(-1)?.error_message).toContain("Unknown provider job name");
  });

  it("fails queue mismatches before processing", async () => {
    const registry = createWorkerProcessorRegistry();

    await expect(
      registry.dispatch("provider-webhooks", providerDeliveryJob()),
    ).rejects.toThrow("Job queue mismatch");
  });

  it("persists provider failure attempts when handler validation fails", async () => {
    const persisted: ProviderAttempt[] = [];
    const events: WorkerLifecycleEvent[] = [];
    const providerAttemptRepository: ProviderAttemptRepository = {
      persist: async (attempt) => {
        persisted.push(attempt);
        return {
          id: persisted.length,
          public_id: `pat_${persisted.length}`,
          provider_id: 1,
          account_id: null,
          request_id: attempt.request_id,
          operation: attempt.operation,
          direction: attempt.direction,
          status: attempt.status,
          status_code: attempt.status_code,
          duration_ms: attempt.duration_ms,
          retry_decision: attempt.retry_decision,
          next_retry_at: attempt.next_retry_at,
          idempotency_key: attempt.idempotency_key,
          request_metadata: attempt.request_metadata,
          response_metadata: attempt.response_metadata,
          error_code: attempt.error?.code ?? null,
          error_message: attempt.error?.message ?? null,
          started_at: attempt.started_at,
          created_at: new Date("2026-01-01T00:00:00.000Z"),
          updated_at: new Date("2026-01-01T00:00:00.000Z"),
        };
      },
    };
    const registry = createWorkerProcessorRegistry({
      lifecycleRecorder: (event) => events.push(event),
      providerAttemptRepository,
    });
    const job = providerDeliveryJob();

    await expect(
      registry.dispatch("provider-delivery", {
        ...job,
        attemptsMade: 0,
        opts: {
          attempts: 5,
        },
        data: {
          ...job.data,
          payload: {
            envelope: {
              ...(job.data.payload as { envelope: Record<string, unknown> }).envelope,
              channel: "sms",
            },
          },
        },
      }),
    ).rejects.toThrow("Provider channel is not registered");

    expect(events.map((event) => event.event)).toEqual(["started", "failed"]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      provider: "ptt",
      operation: "shipment.create",
      status: "terminal_failure",
      retry_decision: "dead_letter",
      status_code: null,
      error: {
        code: "worker_processor_error",
      },
      request_metadata: {
        retry: {
          reason: "terminal_error",
          attempts_remaining: 4,
          retry_delay_ms: null,
          error_retryable: false,
        },
      },
    });
  });

  it("fails unknown runtime queue names", async () => {
    const registry = createWorkerProcessorRegistry();

    await expect(
      registry.dispatch("legacy-random-queue" as QueueName, providerWebhookJob()),
    ).rejects.toThrow("Unknown worker queue");
  });

  it("dispatches shipment tracking fixtures without live calls", async () => {
    const events: WorkerLifecycleEvent[] = [];
    const registry = createWorkerProcessorRegistry((event) => events.push(event));

    await expect(
      registry.dispatch("shipment-tracking", shipmentTrackingJob()),
    ).resolves.toMatchObject({
      provider: "ptt",
      request_id: "req_tracking_1",
      queue: "shipment-tracking",
      status: "accepted_fixture",
      tracking_number: "PTT fixture tracking",
      live_call_performed: false,
      metadata: {
        fixture_only: true,
        dry_run_request: {
          path: "/ptt/shipments/track",
          live_call_performed: false,
        },
        transport_policy: {
          contract_mode: "fixture_only",
          live_call_permitted: false,
        },
      },
    });
    expect(events.map((event) => event.event)).toEqual(["started", "completed"]);
    expect(events.every((event) => event.queue === "shipment-tracking")).toBe(true);
  });

  it("fails shipment tracking jobs that are not provider-qualified", async () => {
    const registry = createWorkerProcessorRegistry();
    const job = shipmentTrackingJob({
      name: "shipment.track",
    });

    await expect(
      registry.dispatch("shipment-tracking", {
        ...job,
        name: "shipment.track",
      }),
    ).rejects.toThrow("Unknown shipment tracking job name");
  });
});
