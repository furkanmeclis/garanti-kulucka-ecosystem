import { describe, expect, it } from "vitest";
import {
  healthStatusSchema,
  jobEnvelopeSchema,
  providerAttemptSchema,
  realtimeEnvelopeSchema,
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
        payload: { setting: "instagram" },
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
        request_id: "req_1",
        started_at: new Date().toISOString(),
        duration_ms: 42,
        status: "success",
      }),
    ).not.toThrow();
  });
});
