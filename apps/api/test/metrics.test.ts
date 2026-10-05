import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "@garanti-kulucka/shared";
import { createApp } from "../src/app.js";
import { createApiMetrics } from "../src/observability/metrics.js";

const enabledWithToken = { enabled: true, token: "scrape-token", port: null };

describe("api /metrics", () => {
  it("returns 404 when metrics are disabled", async () => {
    const app = createApp({ metrics: createApiMetrics(new MetricsRegistry()), metricsExposure: { enabled: false, token: null, port: null } });
    expect((await app.request("/metrics")).status).toBe(404);
  });

  it("never serves tokenless metrics on the public port", async () => {
    const app = createApp({ metrics: createApiMetrics(new MetricsRegistry()), metricsExposure: { enabled: true, token: null, port: 9464 } });
    expect((await app.request("/metrics")).status).toBe(404);
  });

  it("requires the bearer token and exposes route/status request metrics", async () => {
    const metrics = createApiMetrics(new MetricsRegistry({ service: "api" }));
    const app = createApp({ metrics, metricsExposure: enabledWithToken });

    await app.request("/health/live");
    await app.request("/health/ready");
    await app.request("/does-not-exist");
    await app.request("/webhooks/meta/whatsapp", { method: "POST", body: "{}" });

    expect((await app.request("/metrics")).status).toBe(401);
    const response = await app.request("/metrics", { headers: { authorization: "Bearer scrape-token" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    const text = await response.text();
    expect(text).toContain('http_requests_total{method="GET",route="/health/live",status="200",service="api"} 1');
    expect(text).toContain('http_requests_total{method="GET",route="/health/ready",status="503",service="api"} 1');
    expect(text).toContain('route="unmatched"');
    expect(text).toContain("webhook_ingress_duration_seconds_count{provider=\"meta\"");
    expect(text).toContain("# TYPE http_request_duration_seconds histogram");
  });
});
