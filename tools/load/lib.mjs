// Shared helpers for the dependency-free load scripts in tools/load.
// Uses only Node built-ins (fetch, crypto, timers); socket fanout additionally uses socket.io-client,
// which is already installed through the web workspace.

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "api", "host.docker.internal"]);

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const [key, ...rest] = raw.slice(2).split("=");
    args[key] = rest.length > 0 ? rest.join("=") : "true";
  }
  return args;
}

export function numberArg(args, key, envName, fallback) {
  const value = args[key] ?? process.env[envName];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${key} / ${envName} must be a positive number`);
  }
  return parsed;
}

/**
 * Resolves the target URL and refuses remote hosts unless the operator repeats the host name
 * with --confirm-target=<host>. This prevents accidental load against production.
 */
export function resolveTarget(args, env = process.env) {
  const raw = args.target ?? env.LOAD_TARGET_URL;
  if (!raw) {
    throw new Error("Set --target=<url> or LOAD_TARGET_URL (for example http://localhost:3000)");
  }
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Target must be an http(s) URL");
  }
  const confirmed = args["confirm-target"] ?? env.LOAD_CONFIRM_TARGET;
  if (!localHosts.has(url.hostname) && confirmed !== url.hostname) {
    throw new Error(
      `Refusing to load-test remote host "${url.hostname}". Re-run with --confirm-target=${url.hostname} ` +
        "only for a staging environment you own. Never target production.",
    );
  }
  return url;
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function summarize(name, samples, durationMs) {
  const latencies = samples.filter((s) => s.ok).map((s) => s.ms).sort((a, b) => a - b);
  const statuses = {};
  let errors = 0;
  for (const sample of samples) {
    if (sample.status) statuses[sample.status] = (statuses[sample.status] ?? 0) + 1;
    if (sample.error) errors += 1;
  }
  return {
    name,
    requests: samples.length,
    ok: latencies.length,
    errors,
    statuses,
    rps: Number((samples.length / (durationMs / 1000)).toFixed(1)),
    latency_ms: {
      p50: round(percentile(latencies, 50)),
      p95: round(percentile(latencies, 95)),
      p99: round(percentile(latencies, 99)),
      max: round(latencies.at(-1) ?? 0),
    },
  };
}

function round(value) {
  return Number(value.toFixed(1));
}

/** Runs `task` with `concurrency` parallel loops for `durationMs`; each call returns a sample. */
export async function runClosedLoop({ durationMs, concurrency, task }) {
  const samples = [];
  const deadline = Date.now() + durationMs;
  let sequence = 0;
  const loops = Array.from({ length: concurrency }, async () => {
    while (Date.now() < deadline) {
      const n = sequence++;
      const started = performance.now();
      try {
        const result = await task(n);
        samples.push({ ...result, ms: performance.now() - started });
      } catch (error) {
        samples.push({ ok: false, error: error instanceof Error ? error.message : String(error), ms: 0 });
      }
    }
  });
  await Promise.all(loops);
  return samples;
}

export async function timedFetch(url, init, timeoutMs = 10_000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  await response.arrayBuffer();
  return { ok: response.ok, status: response.status };
}

export function printReport(report, thresholds = {}) {
  console.log(JSON.stringify(report, null, 2));
  const failures = [];
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [report];
  for (const scenario of scenarios) {
    if (thresholds.p95 && scenario.latency_ms?.p95 > thresholds.p95) {
      failures.push(`${scenario.name}: p95 ${scenario.latency_ms.p95}ms > ${thresholds.p95}ms`);
    }
    if (thresholds.errorRate !== undefined && scenario.requests > 0) {
      const rate = (scenario.requests - scenario.ok) / scenario.requests;
      if (rate > thresholds.errorRate) {
        failures.push(`${scenario.name}: error rate ${(rate * 100).toFixed(2)}% > ${(thresholds.errorRate * 100).toFixed(2)}%`);
      }
    }
  }
  if (failures.length > 0) {
    console.error(`Thresholds failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  }
}
