import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("health routes", () => {
  it("returns live status", async () => {
    const response = await createApp().request("/health/live");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", service: "api" });
  });

  it("returns degraded readiness when the database is not configured", async () => {
    const response = await createApp().request("/health/ready");
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "degraded",
      service: "api",
      dependencies: {
        database: {
          status: "degraded",
          error: "not_configured",
        },
      },
    });
  });

  it("returns dependency details for ready status", async () => {
    const db = {
      selectFrom: () => ({
        select: () => ({
          limit: () => ({
            execute: async () => [{ id: 1 }],
          }),
        }),
      }),
    };

    const response = await createApp({ db: db as never }).request("/health/ready");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      service: "api",
      dependencies: {
        database: {
          status: "ok",
        },
      },
    });
    expect(body.dependencies.database.latency_ms).toEqual(expect.any(Number));
  });
});
