import { describe, expect, it } from "vitest";
import { queueNameSchema } from "../../packages/shared/src/index.js";
import {
  createProviderFailureAttempt,
  decideProviderRetry,
  handleProviderDeliveryJob,
} from "../../apps/worker/src/providers/handlers.js";
import { assertLiveProviderCallAllowed } from "../../apps/worker/src/providers/transport-policy.js";

describe("worker gate", () => {
  it("allows only declared queue names", () => {
    expect(queueNameSchema.safeParse("provider-webhooks").success).toBe(true);
    expect(queueNameSchema.safeParse("random-live-provider-call").success).toBe(false);
  });

  it("records fixture provider delivery attempts without live calls", () => {
    const result = handleProviderDeliveryJob({
      job_id: "job_delivery_1",
      queue: "provider-delivery",
      name: "ptt.shipment.create",
      requested_at: "2026-01-01T00:00:00.000Z",
      payload: {
        envelope: {
          request_id: "req_delivery_1",
          provider: "ptt",
          operation: "shipment.create",
          direction: "outbound",
          channel: "cargo",
          occurred_at: "2026-01-01T00:00:00.000Z",
          payload: {
            idempotency_key: "shipment_1",
          },
        },
      },
    });

    expect(result.live_call_performed).toBe(false);
    expect(result.attempt).toMatchObject({
      provider: "ptt",
      operation: "shipment.create",
      direction: "outbound",
      status: "success",
      status_code: 202,
      retry_decision: "none",
      idempotency_key: "shipment_1",
      request_metadata: {
        fixture_only: true,
        transport_policy: {
          contract_mode: "fixture_only",
          live_call_permitted: false,
          reason: "legacy_fixture_replay_required",
        },
        dry_run_request: {
          path: "/ptt/shipments",
          live_call_performed: false,
          headers: {
            "x-provider-credential": "[redacted:admin-managed]",
          },
        },
      },
    });
  });

  it("blocks live provider calls until fixture replay promotion is explicit", () => {
    expect(() =>
      assertLiveProviderCallAllowed({
        request_id: "req_live_guard",
        provider: "netgsm",
        operation: "sms.send",
        direction: "outbound",
        channel: "sms",
        occurred_at: "2026-01-01T00:00:00.000Z",
        payload: {
          idempotency_key: "sms_1",
        },
      }),
    ).toThrow("Live provider calls are disabled for netgsm.sms.send");
  });

  it.each([
    { status_code: 429, error_code: null, reason: "retryable_status_code" },
    { status_code: 503, error_code: null, reason: "retryable_status_code" },
    { status_code: null, error_code: "timeout", reason: "retryable_error_code" },
  ])("retries transient idempotent provider failures %#", (input) => {
    const decision = decideProviderRetry({
      operation: "shipment.create",
      status_code: input.status_code,
      error_code: input.error_code,
      attempt_number: 1,
      max_attempts: 5,
      idempotency_key: "shipment_1",
    }, new Date("2026-01-01T00:00:00.000Z"));

    expect(decision).toMatchObject({
      status: "retryable_failure",
      retry_decision: "retry",
      error_retryable: true,
      reason: input.reason,
      attempts_remaining: 4,
      retry_delay_ms: 2000,
      next_retry_at: "2026-01-01T00:00:02.000Z",
    });
  });

  it("dead-letters non-idempotent sends without an idempotency key", () => {
    const decision = decideProviderRetry({
      operation: "message.send",
      status_code: 503,
      error_code: null,
      attempt_number: 1,
      max_attempts: 5,
      idempotency_key: null,
    });

    expect(decision).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      error_retryable: false,
      reason: "missing_idempotency_key",
      attempts_remaining: 4,
      retry_delay_ms: null,
      next_retry_at: null,
    });
  });

  it("creates structured dead-letter attempts for exhausted provider retries", () => {
    const attempt = createProviderFailureAttempt(
      {
        request_id: "req_delivery_failed",
        provider: "ptt",
        operation: "shipment.create",
        direction: "outbound",
        channel: "cargo",
        occurred_at: "2026-01-01T00:00:00.000Z",
        payload: {
          idempotency_key: "shipment_1",
        },
      },
      {
        job_id: "job_delivery_failed",
        queue: "provider-delivery",
        name: "ptt.shipment.create",
        requested_at: "2026-01-01T00:00:00.000Z",
        payload: {},
      },
      {
        status_code: 503,
        error_code: "provider_unavailable",
        error_message: "Provider returned 503",
        attempt_number: 5,
        max_attempts: 5,
      },
      new Date("2026-01-01T00:00:03.000Z"),
    );

    expect(attempt).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      next_retry_at: null,
      status_code: 503,
      error: {
        code: "provider_unavailable",
      },
      request_metadata: {
        retry: {
          reason: "attempts_exhausted",
          attempts_remaining: 0,
          retry_delay_ms: null,
          error_retryable: true,
        },
      },
    });
  });
});
