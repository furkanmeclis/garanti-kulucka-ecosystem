import { describe, expect, it } from "vitest";
import { providerAttemptSchema } from "../../packages/shared/src/index.js";

describe("provider contract gate", () => {
  it("keeps provider attempts credential-free and fixture-driven", () => {
    const attempt = providerAttemptSchema.parse({
      provider: "ptt",
      operation: "shipment.create",
      direction: "outbound",
      request_id: "req_contract",
      started_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      duration_ms: 120,
      status: "success",
      status_code: 202,
      retry_decision: "none",
      next_retry_at: null,
      idempotency_key: "shipment_1",
      request_metadata: {
        fixture_only: true,
      },
      response_metadata: {
        accepted: true,
      },
      error: null,
    });

    expect(attempt).not.toHaveProperty("access_token");
    expect(attempt.request_metadata).not.toHaveProperty("access_token");
    expect(attempt.provider).toBe("ptt");
  });
});
