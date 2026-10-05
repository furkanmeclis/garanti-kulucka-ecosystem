import { describe, expect, it } from "vitest";
import {
  healthStatusSchema,
  jobEnvelopeSchema,
  providerAttemptSchema,
  redactValue,
  realtimeEnvelopeSchema,
  structuredLogSchema,
  createStructuredLog,
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

  it("keeps queue job request correlation backward compatible", () => {
    expect(
      jobEnvelopeSchema.parse({
        job_id: "job_1",
        queue: "provider-delivery",
        name: "kolaybi.invoice.create",
        payload: {},
        requested_at: new Date().toISOString(),
      }).request_id,
    ).toBeUndefined();

    expect(
      jobEnvelopeSchema.parse({
        job_id: "job_1",
        queue: "provider-delivery",
        name: "kolaybi.invoice.create",
        payload: {},
        requested_at: new Date().toISOString(),
        request_id: "req_api_1",
      }).request_id,
    ).toBe("req_api_1");
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

  it("validates structured observability logs", () => {
    const log = createStructuredLog({
      ts: "2026-01-01T00:00:00.000Z",
      level: "info",
      service: "api",
      event: "api.test",
      request_id: "req_1",
      job_id: "job_1",
      msg: "Test log",
      context: {
        authorization: "Bearer secret-token",
        safe: true,
      },
    });

    expect(structuredLogSchema.parse(log)).toMatchObject({
      ts: "2026-01-01T00:00:00.000Z",
      level: "info",
      service: "api",
      event: "api.test",
      request_id: "req_1",
      job_id: "job_1",
      msg: "Test log",
      context: {
        authorization: "[redacted]",
        safe: true,
      },
    });
  });

  it("redacts common credentials and provider secrets recursively", () => {
    const input = {
      password: "plain-password",
      token: "plain-token",
      authorization: "Bearer auth-token",
      cookie: "session=plain-cookie",
      nested: {
        url: "https://garage/object?X-Amz-Credential=credential&X-Amz-Signature=signature&safe=value",
        database: "postgres://user:db-password@localhost:5432/app",
        header: "Authorization: Bearer provider-token",
        cookieHeader: "Cookie: sid=session-secret; theme=dark",
        sifre: "netgsm-secret",
        Sifre: "netgsm-secret-caps",
        api_key: "api-secret",
        access_token: "access-secret",
        CariKodu: "customer-code-secret",
      },
    };

    const redacted = redactValue(input);

    expect(redacted).toEqual({
      password: "[redacted]",
      token: "[redacted]",
      authorization: "[redacted]",
      cookie: "[redacted]",
      nested: {
        url: "https://garage/object?X-Amz-Credential=[redacted]&X-Amz-Signature=[redacted]&safe=value",
        database: "postgres://user:[redacted]@localhost:5432/app",
        header: "Authorization: [redacted]",
        cookieHeader: "Cookie: [redacted]",
        sifre: "[redacted]",
        Sifre: "[redacted]",
        api_key: "[redacted]",
        access_token: "[redacted]",
        CariKodu: "[redacted]",
      },
    });
    expect(JSON.stringify(redacted)).not.toContain("plain");
    expect(JSON.stringify(redacted)).not.toContain("db-password");
    expect(JSON.stringify(redacted)).not.toContain("provider-token");
  });
});
