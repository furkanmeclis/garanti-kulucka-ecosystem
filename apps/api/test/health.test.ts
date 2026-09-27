import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("health routes", () => {
  it("returns live status", async () => {
    const response = await createApp().request("/health/live");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", service: "api" });
  });
});
