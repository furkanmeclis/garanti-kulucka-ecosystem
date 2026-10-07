import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runtimeMetricContracts, storageMetricContracts } from "@garanti-kulucka/shared";

// The compose `monitoring` profile (infra/monitoring) must stay in step with the frozen metric catalog
// (docs/operations/OBSERVABILITY.md) and the alert table (docs/operations/ALERTS_AND_INCIDENT_RUNBOOKS.md).

interface Dashboard {
  uid: string;
  title: string;
  panels: Array<{ id: number; title: string; targets: Array<{ expr: string; datasource: { uid: string } }> }>;
}

const dashboardDir = "infra/monitoring/grafana/dashboards";
const dashboards = readdirSync(dashboardDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(`${dashboardDir}/${file}`, "utf8")) as Dashboard);
const alertsYaml = readFileSync("infra/monitoring/prometheus/rules/alerts.yml", "utf8");
const prometheusYaml = readFileSync("infra/monitoring/prometheus/prometheus.yml", "utf8");
const compose = readFileSync("compose.yaml", "utf8");
const runbook = readFileSync("docs/operations/ALERTS_AND_INCIDENT_RUNBOOKS.md", "utf8");

const catalog = new Map<string, string>([
  ...runtimeMetricContracts.map((metric) => [metric.name, metric.type] as [string, string]),
  ...storageMetricContracts.map((metric) => [metric.name, metric.type] as [string, string]),
]);
const builtins = new Set(["up"]);

/** Metric names referenced by a PromQL expression (histogram suffixes resolved to the base metric). */
function metricsIn(expr: string): string[] {
  const withoutStrings = expr.replace(/"[^"]*"/g, '""').replace(/\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, "");
  const names = withoutStrings.match(/\b[a-z_][a-z0-9_]*(?=\s*[{[]|\s*\)|\s*$|\s+(?:offset|>|<|==|\/|\*|\+|-|or|and|unless))/g) ?? [];
  return [...new Set(names)]
    .filter((name) => !["by", "without", "on", "ignoring", "group_left", "group_right", "le", "offset", "bool"].includes(name))
    .filter((name) => /_/.test(name) || builtins.has(name))
    .map((name) => {
      const base = name.replace(/_(bucket|sum|count)$/, "");
      return catalog.get(base) === "histogram" ? base : name;
    });
}

const dashboardExprs = dashboards.flatMap((dashboard) => dashboard.panels.flatMap((panel) => panel.targets.map((target) => target.expr)));
const alertExprs = [...alertsYaml.matchAll(/expr: >?\n?([\s\S]*?)(?=\n\s+(?:for|labels):)/g)].map((match) => match[1]!.replace(/\s+/g, " ").trim());
const alertNames = [...alertsYaml.matchAll(/- alert: (\w+)/g)].map((match) => match[1]!);

describe("monitoring stack", () => {
  it("only queries catalog metrics from dashboards and alerts", () => {
    const unknown = [...dashboardExprs, ...alertExprs].flatMap(metricsIn).filter((name) => !catalog.has(name) && !builtins.has(name));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it("charts every catalog metric on a dashboard", () => {
    const used = new Set(dashboardExprs.flatMap(metricsIn));
    expect([...catalog.keys()].filter((name) => !used.has(name))).toEqual([]);
  });

  it("uses the provisioned Prometheus datasource and unique panel ids", () => {
    for (const dashboard of dashboards) {
      expect(new Set(dashboard.panels.map((panel) => panel.id)).size).toBe(dashboard.panels.length);
      for (const panel of dashboard.panels) {
        expect(panel.targets.length, `${dashboard.uid}/${panel.title}`).toBeGreaterThan(0);
        for (const target of panel.targets) expect(target.datasource.uid).toBe("prometheus");
      }
    }
    expect(new Set(dashboards.map((dashboard) => dashboard.uid)).size).toBe(dashboards.length);
  });

  it("implements every runbook alert that the stack can observe", () => {
    const runbookAlerts = [...runbook.matchAll(/^\| (\w+) \| `/gm)].map((match) => match[1]!);
    // These need probes outside this stack (blackbox / node exporter); MONITORING_STACK.md says so.
    const external = new Set(["ReadinessDegraded", "DatabaseDown", "RedisDown", "DiskSpaceLow"]);
    expect(runbookAlerts.length).toBeGreaterThan(10);
    expect(runbookAlerts.filter((name) => !external.has(name) && !alertNames.includes(name))).toEqual([]);
    expect(new Set(alertNames).size).toBe(alertNames.length);
    expect(alertsYaml.match(/labels: \{ severity: (page|ticket) \}/g)?.length).toBe(alertNames.length);
  });

  it("scrapes the internal metrics listeners of the compose services and keeps the stack opt-in", () => {
    expect(prometheusYaml).toContain('targets: ["api:9464"]');
    expect(prometheusYaml).toContain('targets: ["worker:3001"]');
    expect(compose).toMatch(/api:\n(?:.*\n)*?\s+METRICS_PORT: 9464/);
    expect(compose).toMatch(/worker:\n(?:.*\n)*?\s+METRICS_PORT: 3001/);
    expect(compose).toMatch(/METRICS_ENABLED: \$\{METRICS_ENABLED:-false\}/);
    for (const service of ["prometheus", "alertmanager", "grafana"]) {
      expect(compose).toMatch(new RegExp(`\\n  ${service}:\\n(?:.*\\n)*?\\s+profiles:\\n\\s+- monitoring`));
    }
    // UIs never bind on all interfaces.
    expect(compose).toContain('"127.0.0.1:9090:9090"');
    expect(compose).toContain('"127.0.0.1:9093:9093"');
    expect(compose).toContain('"127.0.0.1:3002:3000"');
  });
});
