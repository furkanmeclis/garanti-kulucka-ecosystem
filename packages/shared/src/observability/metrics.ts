/**
 * Minimal Prometheus text exposition (format 0.0.4) without external dependencies.
 * Supports counters, gauges and histograms with string labels.
 */

export type MetricLabels = Record<string, string | number>;

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function labelKey(labels: MetricLabels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${String(labels[key])}`)
    .join("|");
}

function formatLabels(labels: MetricLabels, extra?: MetricLabels): string {
  const merged = { ...labels, ...(extra ?? {}) };
  const keys = Object.keys(merged).sort();
  if (keys.length === 0) {
    return "";
  }
  return `{${keys.map((key) => `${key}="${escapeLabelValue(String(merged[key]))}"`).join(",")}}`;
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Inf";
  if (value === Number.NEGATIVE_INFINITY) return "-Inf";
  return String(value);
}

interface MetricBase {
  readonly name: string;
  readonly help: string;
  readonly type: "counter" | "gauge" | "histogram";
  render(): string[];
}

export class Counter implements MetricBase {
  readonly type = "counter" as const;
  private readonly values = new Map<string, { labels: MetricLabels; value: number }>();

  constructor(readonly name: string, readonly help: string) {}

  inc(labels: MetricLabels = {}, amount = 1): void {
    if (amount < 0) {
      throw new Error(`Counter ${this.name} cannot decrease`);
    }
    const key = labelKey(labels);
    const current = this.values.get(key);
    if (current) {
      current.value += amount;
    } else {
      this.values.set(key, { labels: { ...labels }, value: amount });
    }
  }

  get(labels: MetricLabels = {}): number {
    return this.values.get(labelKey(labels))?.value ?? 0;
  }

  render(): string[] {
    return [...this.values.values()].map((entry) => `${this.name}${formatLabels(entry.labels)} ${formatNumber(entry.value)}`);
  }
}

export class Gauge implements MetricBase {
  readonly type = "gauge" as const;
  private readonly values = new Map<string, { labels: MetricLabels; value: number }>();

  constructor(readonly name: string, readonly help: string) {}

  set(labels: MetricLabels, value: number): void {
    this.values.set(labelKey(labels), { labels: { ...labels }, value });
  }

  get(labels: MetricLabels = {}): number | undefined {
    return this.values.get(labelKey(labels))?.value;
  }

  reset(): void {
    this.values.clear();
  }

  render(): string[] {
    return [...this.values.values()].map((entry) => `${this.name}${formatLabels(entry.labels)} ${formatNumber(entry.value)}`);
  }
}

export class Histogram implements MetricBase {
  readonly type = "histogram" as const;
  private readonly values = new Map<string, { labels: MetricLabels; counts: number[]; sum: number; count: number }>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: readonly number[] = DEFAULT_BUCKETS,
  ) {}

  observe(labels: MetricLabels, value: number): void {
    const key = labelKey(labels);
    let entry = this.values.get(key);
    if (!entry) {
      entry = { labels: { ...labels }, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.values.set(key, entry);
    }
    const target = entry;
    this.buckets.forEach((bound, index) => {
      if (value <= bound) {
        target.counts[index] = (target.counts[index] ?? 0) + 1;
      }
    });
    target.sum += value;
    target.count += 1;
  }

  count(labels: MetricLabels = {}): number {
    return this.values.get(labelKey(labels))?.count ?? 0;
  }

  render(): string[] {
    const lines: string[] = [];
    for (const entry of this.values.values()) {
      this.buckets.forEach((bound, index) => {
        lines.push(`${this.name}_bucket${formatLabels(entry.labels, { le: formatNumber(bound) })} ${entry.counts[index] ?? 0}`);
      });
      lines.push(`${this.name}_bucket${formatLabels(entry.labels, { le: "+Inf" })} ${entry.count}`);
      lines.push(`${this.name}_sum${formatLabels(entry.labels)} ${formatNumber(entry.sum)}`);
      lines.push(`${this.name}_count${formatLabels(entry.labels)} ${entry.count}`);
    }
    return lines;
  }
}

export type MetricsCollector = () => void | Promise<void>;

export class MetricsRegistry {
  private readonly metrics = new Map<string, MetricBase>();
  private readonly collectors: MetricsCollector[] = [];

  constructor(private readonly defaultLabels: MetricLabels = {}) {}

  counter(name: string, help: string): Counter {
    return this.register(name, () => new Counter(name, help), "counter");
  }

  gauge(name: string, help: string): Gauge {
    return this.register(name, () => new Gauge(name, help), "gauge");
  }

  histogram(name: string, help: string, buckets?: readonly number[]): Histogram {
    return this.register(name, () => new Histogram(name, help, buckets), "histogram");
  }

  /** Collectors run before every exposition (e.g. queue depth, socket counts). */
  addCollector(collector: MetricsCollector): void {
    this.collectors.push(collector);
  }

  async render(): Promise<string> {
    await Promise.all(
      this.collectors.map(async (collector) => {
        try {
          await collector();
        } catch {
          // A failing collector must never break the scrape; the gauge keeps its last value.
        }
      }),
    );
    const lines: string[] = [];
    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help.replace(/\n/g, " ")}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      for (const line of metric.render()) {
        lines.push(this.applyDefaultLabels(line));
      }
    }
    return `${lines.join("\n")}\n`;
  }

  private applyDefaultLabels(line: string): string {
    const keys = Object.keys(this.defaultLabels);
    if (keys.length === 0) {
      return line;
    }
    const extra = keys
      .sort()
      .map((key) => `${key}="${escapeLabelValue(String(this.defaultLabels[key]))}"`)
      .join(",");
    const spaceIndex = line.lastIndexOf(" ");
    const series = line.slice(0, spaceIndex);
    const value = line.slice(spaceIndex);
    if (series.endsWith("}")) {
      return `${series.slice(0, -1)},${extra}}${value}`;
    }
    return `${series}{${extra}}${value}`;
  }

  private register<T extends MetricBase>(name: string, factory: () => T, type: MetricBase["type"]): T {
    const existing = this.metrics.get(name);
    if (existing) {
      if (existing.type !== type) {
        throw new Error(`Metric ${name} already registered as ${existing.type}`);
      }
      return existing as T;
    }
    const metric = factory();
    this.metrics.set(name, metric);
    return metric;
  }
}

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export interface MetricsExposureConfig {
  enabled: boolean;
  /** Bearer token required on every scrape when set. */
  token: string | null;
  /** Dedicated internal port; when set /metrics is served there instead of the public port. */
  port: number | null;
}

export function resolveMetricsExposure(env: Record<string, string | undefined>): MetricsExposureConfig {
  const enabled = env.METRICS_ENABLED === "true";
  const token = env.METRICS_BEARER_TOKEN && env.METRICS_BEARER_TOKEN.length > 0 ? env.METRICS_BEARER_TOKEN : null;
  const rawPort = env.METRICS_PORT ? Number.parseInt(env.METRICS_PORT, 10) : Number.NaN;
  const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : null;
  return { enabled, token, port };
}

export type MetricsAuthorization = "allowed" | "disabled" | "unauthorized";

/**
 * Decide whether a scrape may proceed.
 * - Disabled unless METRICS_ENABLED=true.
 * - With a token configured, the Authorization header must carry exactly `Bearer <token>`.
 * - Without a token, metrics are only served on the dedicated internal port (`internalListener`).
 */
export function authorizeMetricsRequest(
  config: MetricsExposureConfig,
  authorizationHeader: string | null | undefined,
  internalListener: boolean,
): MetricsAuthorization {
  if (!config.enabled) {
    return "disabled";
  }
  if (config.token) {
    return authorizationHeader === `Bearer ${config.token}` ? "allowed" : "unauthorized";
  }
  return internalListener && config.port !== null ? "allowed" : "disabled";
}

export interface MigrationReportEntityProgress {
  entity: string;
  plannedRows?: number;
  blockedRows?: number;
  appliedRows?: number;
  insertedRows?: number;
}

/** Extract per-entity row counts from a migrator report payload (dry-run or apply). */
export function migrationProgressFromReport(report: unknown): Array<{ entity: string; state: string; rows: number }> {
  if (!report || typeof report !== "object") {
    return [];
  }
  const entities = (report as { entities?: unknown }).entities;
  if (!Array.isArray(entities)) {
    return [];
  }
  const samples: Array<{ entity: string; state: string; rows: number }> = [];
  for (const entry of entities) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.entity !== "string") continue;
    for (const [field, state] of [
      ["plannedRows", "planned"],
      ["blockedRows", "blocked"],
      ["appliedRows", "applied"],
      ["insertedRows", "inserted"],
    ] as const) {
      const value = record[field];
      if (typeof value === "number" && Number.isFinite(value)) {
        samples.push({ entity: record.entity, state, rows: value });
      }
    }
  }
  return samples;
}
