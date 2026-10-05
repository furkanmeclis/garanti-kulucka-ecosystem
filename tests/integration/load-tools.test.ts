import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { percentile, resolveTarget, summarize } from "../../tools/load/lib.mjs";

const run = promisify(execFile);

describe("load tools", () => {
  let server: Server;
  let origin: string;
  const seen: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      seen.push(`${request.method} ${request.url} ${request.headers["x-hub-signature-256"] ? "signed" : "unsigned"}`);
      request.resume();
      request.on("end", () => {
        response.writeHead(request.method === "POST" ? 202 : 200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("refuses remote targets unless the host is confirmed", () => {
    expect(() => resolveTarget({}, {})).toThrow(/LOAD_TARGET_URL/);
    expect(() => resolveTarget({ target: "https://staging.example.com" }, {})).toThrow(/Refusing/);
    expect(resolveTarget({ target: "https://staging.example.com", "confirm-target": "staging.example.com" }, {}).hostname).toBe(
      "staging.example.com",
    );
    expect(resolveTarget({}, { LOAD_TARGET_URL: "http://localhost:3000" }).port).toBe("3000");
  });

  it("computes percentiles and summaries", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    const summary = summarize(
      "x",
      [
        { ok: true, status: 200, ms: 10 },
        { ok: false, status: 503, ms: 5 },
        { ok: false, error: "timeout", ms: 0 },
      ],
      1000,
    );
    expect(summary).toMatchObject({ requests: 3, ok: 1, errors: 1, statuses: { 200: 1, 503: 1 }, rps: 3 });
  });

  it("runs the API list and webhook scripts against a local server", async () => {
    const env = { ...process.env, LOAD_TARGET_URL: origin, LOAD_ACCESS_TOKEN: "test-token", LOAD_WEBHOOK_SECRET: "s" };
    const list = await run(process.execPath, ["tools/load/api-list.mjs", "--duration=0.2", "--concurrency=2", "--paths=/api/orders"], {
      env,
    });
    expect(JSON.parse(list.stdout).scenarios[0]).toMatchObject({ name: "GET /api/orders", errors: 0 });

    const webhook = await run(process.execPath, ["tools/load/webhook-ingress.mjs", "--duration=0.2", "--concurrency=2"], { env });
    const report = JSON.parse(webhook.stdout);
    expect(report.scenarios[0].statuses["202"]).toBeGreaterThan(0);
    expect(seen.some((line) => line === "POST /webhooks/meta signed")).toBe(true);
  });
});
