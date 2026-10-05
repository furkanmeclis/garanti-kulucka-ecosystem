import { createServer, type Server } from "node:http";
import type { Context, MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import {
  authorizeMetricsRequest,
  MetricsRegistry,
  PROMETHEUS_CONTENT_TYPE,
  resolveMetricsExposure,
  type MetricsExposureConfig,
} from "@garanti-kulucka/shared";

export function createApiMetrics(registry = new MetricsRegistry({ service: "api" })) {
  return {
    registry,
    httpRequests: registry.counter("http_requests_total", "HTTP requests handled by the API."),
    httpDuration: registry.histogram("http_request_duration_seconds", "API HTTP request latency in seconds."),
    webhookIngress: registry.histogram(
      "webhook_ingress_duration_seconds",
      "Provider webhook ingress latency in seconds until the API answers the provider.",
    ),
    socketConnections: registry.gauge(
      "realtime_socket_connections",
      "Socket.IO connections currently attached to this API instance.",
    ),
    storageOrphanApply: registry.counter(
      "storage_orphan_cleanup_apply_total",
      "Total controlled orphan cleanup apply attempts that reached the delete gate.",
    ),
    storageOrphanErrors: registry.counter(
      "storage_orphan_cleanup_error_total",
      "Total controlled orphan cleanup failures grouped by operational result code.",
    ),
  };
}

export type ApiMetrics = ReturnType<typeof createApiMetrics>;

let processMetrics: ApiMetrics | null = null;

/** Process-wide API metrics; every app instance in the process shares one registry. */
export function getApiMetrics(): ApiMetrics {
  processMetrics ??= createApiMetrics();
  return processMetrics;
}

function resolveRoute(context: Context): string {
  try {
    const route = routePath(context, -1);
    if (!route || route === "*" || route === "/*") {
      return "unmatched";
    }
    return route;
  } catch {
    return "unmatched";
  }
}

export function httpMetricsMiddleware(metrics: ApiMetrics): MiddlewareHandler {
  return async (context, next) => {
    const startedAt = performance.now();
    try {
      await next();
    } finally {
      const seconds = (performance.now() - startedAt) / 1000;
      const route = resolveRoute(context);
      const status = String(context.res.status);
      const labels = { method: context.req.method, route, status };
      metrics.httpRequests.inc(labels);
      metrics.httpDuration.observe(labels, seconds);
      if (context.req.method === "POST" && context.req.path.startsWith("/webhooks/")) {
        const provider = context.req.path.split("/")[2] ?? "unknown";
        metrics.webhookIngress.observe({ provider, status }, seconds);
      }
    }
  };
}

export function metricsRouteHandler(metrics: ApiMetrics, exposure: MetricsExposureConfig) {
  return async (context: Context) => {
    const decision = authorizeMetricsRequest(exposure, context.req.header("authorization"), false);
    if (decision === "disabled") {
      return context.json({ error: { code: "not_found", message: "Not found" } }, 404);
    }
    if (decision === "unauthorized") {
      return context.json({ error: { code: "unauthorized", message: "Metrics token required" } }, 401);
    }
    return context.body(await metrics.registry.render(), 200, { "content-type": PROMETHEUS_CONTENT_TYPE });
  };
}

/** Optional dedicated internal listener (METRICS_PORT) that never shares the public port. */
export function startInternalMetricsServer(
  registry: MetricsRegistry,
  exposure: MetricsExposureConfig = resolveMetricsExposure(process.env),
): Server | null {
  if (!exposure.enabled || exposure.port === null) {
    return null;
  }
  const server = createServer((request, response) => {
    if (request.url !== "/metrics") {
      response.writeHead(404).end();
      return;
    }
    const decision = authorizeMetricsRequest(exposure, request.headers.authorization, true);
    if (decision !== "allowed") {
      response.writeHead(decision === "unauthorized" ? 401 : 404).end();
      return;
    }
    void registry.render().then((body) => {
      response.writeHead(200, { "content-type": PROMETHEUS_CONTENT_TYPE }).end(body);
    });
  });
  server.listen(exposure.port, process.env.METRICS_HOST ?? "0.0.0.0");
  return server;
}
