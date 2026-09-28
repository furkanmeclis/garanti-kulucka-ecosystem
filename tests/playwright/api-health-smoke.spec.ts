import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { expect, request, test } from "@playwright/test";
import { createApp } from "../../apps/api/src/app.js";

test("API live health is reachable through a real Node HTTP server", async () => {
  const server = serve({ fetch: createApp().fetch, port: 0 });
  const address = server.address() as AddressInfo;
  const baseURL = `http://127.0.0.1:${address.port}`;
  const client = await request.newContext({ baseURL });

  try {
    const response = await client.get("/health/live", {
      headers: {
        "x-request-id": "playwright_smoke_1",
      },
    });
    const body = await response.json();

    expect(response.status()).toBe(200);
    expect(response.headers()["x-request-id"]).toBe("playwright_smoke_1");
    expect(body).toMatchObject({
      status: "ok",
      service: "api",
    });
  } finally {
    await client.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
