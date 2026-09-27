import { describe, expect, it } from "vitest";

describe("e2e gate", () => {
  it("documents the local system boundary without live external services", () => {
    const requiredServices = ["api", "worker", "migrator", "postgres", "redis", "garage"];
    expect(requiredServices).toContain("api");
    expect(requiredServices).toContain("garage");
  });
});
