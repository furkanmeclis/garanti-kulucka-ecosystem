import { describe, expect, it } from "vitest";
import {
  healthStatusSchema,
  jobEnvelopeSchema,
  providerAttemptSchema,
  realtimeEnvelopeSchema,
  storageMetricContracts,
  storageMetricContractSchema,
} from "../src/index.js";

describe("shared contracts", () => {
  it("validates health payloads", () => {
    expect(() =>
      healthStatusSchema.parse({
        status: "ok",
        service: "api",
        timestamp: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it("validates realtime envelopes", () => {
    expect(() =>
      realtimeEnvelopeSchema.parse({
        event: "settings.changed",
        id: "evt_1",
        occurred_at: new Date().toISOString(),
        payload: { scope: "global", key: "instagram.access_token" },
      }),
    ).not.toThrow();
  });

  it("validates queue jobs", () => {
    expect(() =>
      jobEnvelopeSchema.parse({
        job_id: "job_1",
        queue: "provider-delivery",
        name: "kolaybi.invoice.create",
        payload: {},
        requested_at: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it("validates provider attempts", () => {
    expect(() =>
      providerAttemptSchema.parse({
        provider: "surat",
        operation: "shipment.create",
        direction: "outbound",
        request_id: "req_1",
        started_at: new Date().toISOString(),
        duration_ms: 42,
        status: "success",
        status_code: 202,
        retry_decision: "none",
        next_retry_at: null,
        idempotency_key: "shipment_1",
        request_metadata: {
          queue: "provider-delivery",
        },
        response_metadata: {
          accepted: true,
        },
        error: null,
      }),
    ).not.toThrow();
  });

  it("validates storage cleanup metric contracts", () => {
    expect(storageMetricContracts.map((contract) => contract.name)).toEqual([
      "storage_orphan_candidate_count",
      "storage_orphan_cleanup_apply_total",
      "storage_orphan_cleanup_error_total",
      "garage_capacity_bytes",
      "garage_backup_age_seconds",
    ]);

    for (const contract of storageMetricContracts) {
      expect(() => storageMetricContractSchema.parse(contract)).not.toThrow();
    }

    expect(storageMetricContracts.filter((contract) => contract.source === "external_scrape").map((contract) => contract.name)).toEqual([
      "garage_capacity_bytes",
      "garage_backup_age_seconds",
    ]);
  });
});
