import { describe, expect, it } from "vitest";
import { createApiClient } from "../src/api-client-boundary.js";

describe("web API client boundary", () => {
  it("creates a typed API client", () => {
    expect(createApiClient("http://localhost:3000")).toHaveProperty("health");
  });
});
