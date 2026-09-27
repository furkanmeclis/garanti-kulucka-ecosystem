import { describe, expect, it } from "vitest";
import { validateBootstrapPassword } from "../src/bootstrap/admin.js";

describe("admin bootstrap validation", () => {
  it("requires a strong enough initial password", () => {
    expect(() => validateBootstrapPassword("short")).toThrow("at least 12 characters");
    expect(() => validateBootstrapPassword("long-enough-password")).not.toThrow();
  });
});
