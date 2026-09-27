import { describe, expect, it } from "vitest";
import { handleProviderDeliveryJob, handleProviderWebhookJob } from "../src/providers/handlers.js";
import { findProviderAdapter, providerAdapters } from "../src/providers/registry.js";

const now = new Date().toISOString();

describe("provider adapter registry", () => {
  it("registers all provider boundaries as fixture-only adapters", () => {
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
    expect(providerAdapters.every((adapter) => adapter.live_calls_enabled === false)).toBe(true);
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
      },
    });

    expect(result).toEqual({
      provider: "meta",
      request_id: "req_meta_1",
      queue: "provider-webhooks",
      status: "accepted_fixture",
      live_call_performed: false,
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
});
