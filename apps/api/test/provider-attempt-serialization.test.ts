import { describe, expect, it } from "vitest";
import {
  parseProviderAttemptLimit,
  providerRequestPreviewFromMetadata,
  redactProviderAttemptMetadata,
  serializeProviderDebugSummary,
  serializeProviderAttempt,
  type ProviderAttemptRecord,
} from "../src/integrations/repository.js";

describe("provider attempt serialization", () => {
  it("redacts secret-looking metadata recursively", () => {
    expect(
      redactProviderAttemptMetadata({
        fixture_only: true,
        transport: {
          access_token: "plain-token",
          nested: {
            api_key: "plain-key",
          },
        },
      }),
    ).toEqual({
      fixture_only: true,
      transport: {
        access_token: "[redacted]",
        nested: {
          api_key: "[redacted]",
        },
      },
    });
  });

  it("serializes provider attempts without leaking provider credentials", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const attempt: ProviderAttemptRecord = {
      id: 1,
      public_id: "pat_test",
      provider_id: 1,
      account_id: 2,
      provider_key: "instagram",
      account_public_id: "iac_instagram",
      request_id: "req_test",
      operation: "message.send",
      direction: "outbound",
      status: "success",
      status_code: 202,
      duration_ms: 125,
      retry_decision: "none",
      next_retry_at: null,
      idempotency_key: "msg_1",
      request_metadata: {
        authorization: "Bearer plain-token",
        dry_run_request: {
          method: "POST",
          path: "/meta/instagram/messages",
          headers: {
            authorization: "Bearer plain-token",
          },
          body: {
            message: "Fixture message",
          },
          live_call_performed: false,
        },
      },
      response_metadata: {
        accepted: true,
      },
      error_code: null,
      error_message: null,
      started_at: now,
      created_at: now,
      updated_at: now,
    };

    const serialized = serializeProviderAttempt(attempt);

    expect(serialized).toMatchObject({
      provider_key: "instagram",
      account_public_id: "iac_instagram",
      status: "success",
      request_metadata: {
        authorization: "[redacted]",
        dry_run_request: {
          headers: {
            authorization: "[redacted]",
          },
        },
      },
      provider_request_preview: {
        method: "POST",
        path: "/meta/instagram/messages",
        headers: {
          authorization: "[redacted]",
        },
        body: {
          message: "Fixture message",
        },
        live_call_performed: false,
      },
    });
    expect(JSON.stringify(serialized)).not.toContain("plain-token");
  });

  it("returns null provider request previews when dry-run metadata is absent", () => {
    expect(providerRequestPreviewFromMetadata({ fixture_only: true })).toBeNull();
    expect(providerRequestPreviewFromMetadata(null)).toBeNull();
  });

  it("clamps provider attempt list limits", () => {
    expect(parseProviderAttemptLimit(undefined)).toBe(50);
    expect(parseProviderAttemptLimit("0")).toBe(1);
    expect(parseProviderAttemptLimit("250")).toBe(100);
    expect(parseProviderAttemptLimit("bad")).toBe(50);
  });

  it("serializes provider debug summaries through the redacted attempt serializer", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const latestAttempt: ProviderAttemptRecord = {
      id: 2,
      public_id: "pat_surat",
      provider_id: 1,
      account_id: null,
      provider_key: "surat",
      account_public_id: null,
      request_id: "req_surat",
      operation: "shipment.track",
      direction: "outbound",
      status: "failed",
      status_code: 503,
      duration_ms: 1450,
      retry_decision: "retry",
      next_retry_at: null,
      idempotency_key: "trk_surat",
      request_metadata: {
        dry_run_request: {
          method: "POST",
          path: "/kargo-takip",
          headers: {
            authorization: "Bearer plain-surat-token",
          },
          body: {
            api_key: "plain-surat-key",
          },
          live_call_performed: false,
        },
      },
      response_metadata: {},
      error_code: "fixture_timeout",
      error_message: "fixture retry",
      started_at: now,
      created_at: now,
      updated_at: now,
    };

    const serialized = serializeProviderDebugSummary({
      providers: [
        {
          provider_key: "surat",
          total_attempts: 1,
          success_count: 0,
          failure_count: 1,
          retry_count: 1,
          average_duration_ms: 1450,
          latest_attempt: latestAttempt,
        },
      ],
      cron: {
        provider_keys: ["ptt", "surat"],
        operation: "shipment.track",
        total_attempts: 1,
        success_count: 0,
        failure_count: 1,
        retry_count: 1,
        total_duration_ms: 1450,
        latest_attempt: latestAttempt,
      },
    });

    expect(serialized.providers[0]?.latest_attempt).toMatchObject({
      provider_request_preview: {
        headers: {
          authorization: "[redacted]",
        },
        body: {
          api_key: "[redacted]",
        },
      },
    });
    expect(JSON.stringify(serialized)).not.toContain("plain-surat");
  });
});
