import { describe, expect, it } from "vitest";
import { handleProviderDeliveryJob, handleProviderWebhookJob } from "../src/providers/handlers.js";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import { findProviderAdapter, providerAdapters } from "../src/providers/registry.js";

const now = new Date().toISOString();

describe("provider adapter registry", () => {
  it("registers provider boundaries and marks live-capable providers", () => {
    expect(providerAdapters.map((adapter) => adapter.provider)).toEqual([
      "ptt",
      "surat",
      "kolaybi",
      "meta",
      "whatsapp",
      "instagram",
      "messenger",
      "netgsm",
      "vapi",
      "sip",
    ]);
    expect(providerAdapters.filter((adapter) => adapter.live_calls_enabled).map((adapter) => adapter.provider)).toEqual(["ptt", "surat", "kolaybi", "whatsapp", "instagram", "messenger", "netgsm", "vapi"]);
  });

  it("models SIP as config sync rather than a live provider call", () => {
    expect(findProviderAdapter("sip").delivery_operations).toEqual(["sip.config.sync"]);
  });
});

describe("provider job handlers", () => {
  it("accepts Meta webhook fixtures without making live calls", () => {
    const result = handleProviderWebhookJob({
      job_id: "job_meta_1",
      queue: "provider-webhooks",
      name: "meta.message.webhook",
      requested_at: now,
      request_id: "req_api_meta_1",
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
          legacy_contract: {
            source: "legacy-supabase-webhook",
            fixture_name: "meta_message_webhook_minimal",
          },
        },
        webhook_event_public_id: "wev_meta_1",
      },
    });

    expect(result).toMatchObject({
      provider: "meta",
      request_id: "req_meta_1",
      queue: "provider-webhooks",
      status: "accepted_fixture",
      live_call_performed: false,
      attempt: {
        provider: "meta",
        operation: "message.webhook",
        direction: "inbound",
        request_id: "req_meta_1",
        status: "success",
        status_code: 202,
        retry_decision: "none",
        idempotency_key: null,
        error: null,
        request_metadata: {
          request_id: "req_api_meta_1",
          job_id: "job_meta_1",
          webhook_event_id: "wev_meta_1",
          provider_attempt_id: null,
        },
      },
    });
  });

  it("accepts cargo delivery fixtures without making live calls", () => {
    const result = handleProviderDeliveryJob({
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
          legacy_contract: {
            source: "legacy-shipment-service",
            fixture_name: "ptt_shipment_create_minimal",
          },
        },
      },
    });

    expect(result.live_call_performed).toBe(false);
    expect(result.provider).toBe("ptt");
  });

  it("rejects operations that are not registered for the provider direction", () => {
    expect(() =>
      handleProviderDeliveryJob({
        job_id: "job_meta_bad",
        queue: "provider-delivery",
        name: "meta.message.send",
        requested_at: now,
        payload: {
          envelope: {
            request_id: "req_meta_bad",
            provider: "meta",
            operation: "message.send",
            direction: "outbound",
            channel: "instagram",
            occurred_at: now,
            payload: {},
          },
        },
      }),
    ).toThrow("Provider operation is not registered");
  });

  it("rejects channels that are not registered for the provider", () => {
    expect(() =>
      handleProviderDeliveryJob({
        job_id: "job_ptt_bad_channel",
        queue: "provider-delivery",
        name: "ptt.shipment.create",
        requested_at: now,
        payload: {
          envelope: {
            request_id: "req_ptt_bad_channel",
            provider: "ptt",
            operation: "shipment.create",
            direction: "outbound",
            channel: "sms",
            occurred_at: now,
            payload: {},
          },
        },
      }),
    ).toThrow("Provider channel is not registered");
  });

  it("persists provider attempts after processor success when repository is configured", async () => {
    const persisted: unknown[] = [];
    const providerAttemptRepository: ProviderAttemptRepository = {
      persist: async (attempt) => {
        persisted.push(attempt);
        return {
          id: 1,
          public_id: "pat_test",
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
    const registry = createWorkerProcessorRegistry({ providerAttemptRepository });

    await registry.dispatch("provider-delivery", {
      id: "job_ptt_1",
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
            payload: {},
          },
        },
      },
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      provider: "ptt",
      request_id: "req_ptt_1",
      status: "success",
    });
  });
});
