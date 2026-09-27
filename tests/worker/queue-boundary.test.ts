import { describe, expect, it } from "vitest";
import { queueNameSchema } from "../../packages/shared/src/index.js";
import {
  decideProviderRetry,
  handleProviderDeliveryJob,
} from "../../apps/worker/src/providers/handlers.js";

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
    });
  });

  it.each([
    { status_code: 429, error_code: null },
    { status_code: 503, error_code: null },
    { status_code: null, error_code: "timeout" },
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
      next_retry_at: null,
    });
  });
});
