import { describe, expect, it } from "vitest";
import { providerAttemptSchema } from "../../packages/shared/src/index.js";

describe("provider contract gate", () => {
  it("keeps provider attempts credential-free and fixture-driven", () => {
    const attempt = providerAttemptSchema.parse({
      provider: "ptt",
      operation: "shipment.create",
      request_id: "req_contract",
      started_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      duration_ms: 120,
      status: "success",
    });

    expect(attempt).not.toHaveProperty("access_token");
    expect(attempt.provider).toBe("ptt");
  });
});
