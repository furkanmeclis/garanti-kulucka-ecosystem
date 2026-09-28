import { describe, expect, it } from "vitest";
import { parseSafePostgresInt8 } from "../src/index.js";

describe("PostgreSQL integer runtime policy", () => {
  it("parses int8 values inside the JavaScript safe integer range", () => {
    expect(parseSafePostgresInt8("0")).toBe(0);
    expect(parseSafePostgresInt8("42")).toBe(42);
    expect(parseSafePostgresInt8("-42")).toBe(-42);
    expect(parseSafePostgresInt8(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects int8 values that JavaScript would round silently", () => {
    expect(() => parseSafePostgresInt8("9007199254740992")).toThrow(RangeError);
    expect(() => parseSafePostgresInt8("-9007199254740992")).toThrow(RangeError);
  });

  it("rejects malformed int8 values", () => {
    expect(() => parseSafePostgresInt8("42.1")).toThrow(TypeError);
    expect(() => parseSafePostgresInt8("not-a-number")).toThrow(TypeError);
  });
});
