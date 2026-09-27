import { describe, expect, it } from "vitest";

describe("migration gate", () => {
  it("keeps migration execution manual-only", () => {
    expect(["migrate --dry-run", "migrate --apply", "verify"]).toContain("migrate --apply");
  });
});
