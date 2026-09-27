import { describe, expect, it } from "vitest";
import { queueNameSchema } from "../../packages/shared/src/index.js";

describe("worker gate", () => {
  it("allows only declared queue names", () => {
    expect(queueNameSchema.safeParse("provider-webhooks").success).toBe(true);
    expect(queueNameSchema.safeParse("random-live-provider-call").success).toBe(false);
  });
});
