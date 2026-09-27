import { describe, expect, it } from "vitest";
import { queueNames, validateJobEnvelope } from "../src/queues.js";

describe("worker queue contracts", () => {
  it("declares required queues", () => {
    expect(queueNames).toContain("provider-delivery");
    expect(queueNames).toContain("shipment-tracking");
  });

  it("validates job envelopes", () => {
    expect(() =>
      validateJobEnvelope({
        job_id: "job_1",
        queue: "provider-webhooks",
        name: "meta.webhook.received",
        payload: {},
        requested_at: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});
