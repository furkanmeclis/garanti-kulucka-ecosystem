import { describe, expect, it } from "vitest";

describe("integration gate", () => {
  it("keeps integration tests independent from live provider credentials", () => {
    expect(process.env.PTT_PASSWORD).toBeUndefined();
    expect(process.env.META_ACCESS_TOKEN).toBeUndefined();
  });
});
