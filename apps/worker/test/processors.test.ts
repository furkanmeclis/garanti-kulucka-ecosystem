import { describe, expect, it } from "vitest";
import {
  createWorkerProcessorRegistry,
  workerQueueNames,
  type WorkerLifecycleEvent,
} from "../src/processors.js";
import type { QueueName } from "@garanti-kulucka/shared";

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

  it("fails unknown runtime queue names", async () => {
    const registry = createWorkerProcessorRegistry();

    await expect(
      registry.dispatch("legacy-random-queue" as QueueName, providerWebhookJob()),
    ).rejects.toThrow("Unknown worker queue");
  });

  it("fails declared queues that do not have an implemented processor yet", async () => {
    const registry = createWorkerProcessorRegistry();

    await expect(
      registry.dispatch("shipment-tracking", {
        id: "bull_job_tracking",
        name: "shipment.track",
        data: {
          job_id: "job_tracking_1",
          queue: "shipment-tracking",
          name: "shipment.track",
          payload: {},
          requested_at: now,
        },
      }),
    ).rejects.toThrow("Worker processor is not implemented for queue: shipment-tracking");
  });
});
