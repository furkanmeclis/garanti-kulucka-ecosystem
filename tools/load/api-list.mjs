#!/usr/bin/env node
// Read-only load against authenticated API list endpoints.
// Usage: LOAD_TARGET_URL=http://localhost:3000 LOAD_ACCESS_TOKEN=... node tools/load/api-list.mjs --duration=30 --concurrency=20
import { numberArg, parseArgs, printReport, resolveTarget, runClosedLoop, summarize, timedFetch } from "./lib.mjs";

const defaultPaths = [
  "/api/orders?limit=50",
  "/api/customers?limit=50",
  "/api/conversations?limit=50",
  "/api/products?limit=50",
  "/api/shipments?limit=50",
  "/api/orders/summary",
];

const args = parseArgs();
const target = resolveTarget(args);
const token = args.token ?? process.env.LOAD_ACCESS_TOKEN;
if (!token) {
  throw new Error("Set LOAD_ACCESS_TOKEN to an access token of a dedicated load-test user");
}
const durationMs = numberArg(args, "duration", "LOAD_DURATION_SECONDS", 30) * 1000;
const concurrency = numberArg(args, "concurrency", "LOAD_CONCURRENCY", 10);
const paths = (args.paths ?? process.env.LOAD_API_PATHS)?.split(",").filter(Boolean) ?? defaultPaths;

const scenarios = [];
for (const path of paths) {
  const url = new URL(path, target);
  const samples = await runClosedLoop({
    durationMs,
    concurrency,
    task: () => timedFetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }),
  });
  scenarios.push(summarize(`GET ${path}`, samples, durationMs));
}

printReport(
  { target: target.origin, duration_ms: durationMs, concurrency, scenarios },
  { p95: numberArg(args, "max-p95", "LOAD_MAX_P95_MS", 500), errorRate: 0.01 },
);
