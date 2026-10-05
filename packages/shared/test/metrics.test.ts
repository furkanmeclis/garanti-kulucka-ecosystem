import { describe, expect, it } from "vitest";
import {
  authorizeMetricsRequest,
  MetricsRegistry,
  migrationProgressFromReport,
  resolveMetricsExposure,
  runtimeMetricContracts,
  runtimeMetricContractSchema,
} from "../src/index.js";

describe("prometheus text exposition", () => {
  it("renders counters, gauges and histograms with escaped labels and default labels", async () => {
    const registry = new MetricsRegistry({ service: "api" });
    registry.counter("http_requests_total", "Requests").inc({ route: "/a\"b", status: "200" }, 2);
    registry.gauge("queue_jobs", "Jobs").set({ queue: "q", state: "waiting" }, 7);
    const histogram = registry.histogram("lat_seconds", "Latency", [0.1, 1]);
    histogram.observe({ op: "x" }, 0.05);
    histogram.observe({ op: "x" }, 0.5);
    let collected = 0;
    registry.addCollector(() => {
      collected += 1;
    });
    registry.addCollector(() => {
      throw new Error("collector failure must not break scrape");
    });

    const text = await registry.render();
    expect(collected).toBe(1);
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain('http_requests_total{route="/a\\"b",status="200",service="api"} 2');
    expect(text).toContain('queue_jobs{queue="q",state="waiting",service="api"} 7');
    expect(text).toContain('lat_seconds_bucket{le="0.1",op="x",service="api"} 1');
    expect(text).toContain('lat_seconds_bucket{le="+Inf",op="x",service="api"} 2');
    expect(text).toContain('lat_seconds_count{op="x",service="api"} 2');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("rejects conflicting metric types and negative counter increments", () => {
    const registry = new MetricsRegistry();
    registry.counter("m", "m");
    expect(() => registry.gauge("m", "m")).toThrow();
    expect(() => registry.counter("c", "c").inc({}, -1)).toThrow();
  });
});

describe("metrics exposure policy", () => {
  it("is disabled unless METRICS_ENABLED=true", () => {
    const config = resolveMetricsExposure({ METRICS_BEARER_TOKEN: "t" });
    expect(authorizeMetricsRequest(config, "Bearer t", false)).toBe("disabled");
  });

  it("requires the bearer token when one is configured", () => {
    const config = resolveMetricsExposure({ METRICS_ENABLED: "true", METRICS_BEARER_TOKEN: "secret" });
    expect(authorizeMetricsRequest(config, "Bearer secret", false)).toBe("allowed");
    expect(authorizeMetricsRequest(config, "Bearer nope", true)).toBe("unauthorized");
    expect(authorizeMetricsRequest(config, undefined, false)).toBe("unauthorized");
  });

  it("serves tokenless metrics only on the dedicated internal port", () => {
    const config = resolveMetricsExposure({ METRICS_ENABLED: "true", METRICS_PORT: "9464" });
    expect(config.port).toBe(9464);
    expect(authorizeMetricsRequest(config, undefined, true)).toBe("allowed");
    expect(authorizeMetricsRequest(config, undefined, false)).toBe("disabled");
    const noPort = resolveMetricsExposure({ METRICS_ENABLED: "true" });
    expect(authorizeMetricsRequest(noPort, undefined, true)).toBe("disabled");
  });
});

describe("runtime metric contracts", () => {
  it("validates every runtime metric contract", () => {
    for (const contract of runtimeMetricContracts) {
      expect(runtimeMetricContractSchema.parse(contract)).toEqual(contract);
    }
  });

  it("extracts per-entity migration progress from migrator reports", () => {
    expect(
      migrationProgressFromReport({
        entities: [
          { entity: "customers", plannedRows: 10, plannedBatches: 1, blockedRows: 2 },
          { entity: "orders", plannedRows: 5, blockedRows: 0, appliedRows: 5 },
          { nope: true },
        ],
      }),
    ).toEqual([
      { entity: "customers", state: "planned", rows: 10 },
      { entity: "customers", state: "blocked", rows: 2 },
      { entity: "orders", state: "planned", rows: 5 },
      { entity: "orders", state: "blocked", rows: 0 },
      { entity: "orders", state: "applied", rows: 5 },
    ]);
    expect(migrationProgressFromReport(null)).toEqual([]);
  });
});
