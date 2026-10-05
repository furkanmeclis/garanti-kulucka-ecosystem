import { z } from "zod";

export const runtimeMetricNameSchema = z.enum([
  "http_requests_total",
  "http_request_duration_seconds",
  "webhook_ingress_duration_seconds",
  "realtime_socket_connections",
  "queue_jobs",
  "queue_job_retries_total",
  "queue_job_dead_letters_total",
  "provider_attempt_duration_seconds",
  "provider_attempts_total",
  "provider_attempt_errors_total",
  "migration_rows",
  "migration_report_last_received_timestamp_seconds",
]);

export const runtimeMetricContractSchema = z.object({
  name: runtimeMetricNameSchema,
  type: z.enum(["gauge", "counter", "histogram"]),
  description: z.string().min(1),
  labels: z.array(z.string().min(1)),
  source: z.enum(["api", "worker"]),
});

export const runtimeMetricContracts = [
  { name: "http_requests_total", type: "counter", description: "HTTP requests handled by the API.", labels: ["method", "route", "status"], source: "api" },
  { name: "http_request_duration_seconds", type: "histogram", description: "API HTTP request latency.", labels: ["method", "route", "status"], source: "api" },
  { name: "webhook_ingress_duration_seconds", type: "histogram", description: "Latency of provider webhook ingress requests until the API answers the provider.", labels: ["provider", "status"], source: "api" },
  { name: "realtime_socket_connections", type: "gauge", description: "Socket.IO connections currently attached to this API instance.", labels: [], source: "api" },
  { name: "queue_jobs", type: "gauge", description: "BullMQ job counts per queue and state (waiting, active, delayed, failed).", labels: ["queue", "state"], source: "worker" },
  { name: "queue_job_retries_total", type: "counter", description: "Failed job attempts that will be retried by BullMQ.", labels: ["queue"], source: "worker" },
  { name: "queue_job_dead_letters_total", type: "counter", description: "Jobs that exhausted all attempts and moved to the failed (dead-letter) set.", labels: ["queue"], source: "worker" },
  { name: "provider_attempt_duration_seconds", type: "histogram", description: "Provider attempt latency.", labels: ["provider", "operation", "status"], source: "worker" },
  { name: "provider_attempts_total", type: "counter", description: "Provider attempts recorded by the worker.", labels: ["provider", "operation", "status"], source: "worker" },
  { name: "provider_attempt_errors_total", type: "counter", description: "Provider attempts that did not succeed.", labels: ["provider", "operation"], source: "worker" },
  { name: "migration_rows", type: "gauge", description: "Rows per migration entity and state from the latest migrator report of a run.", labels: ["run_id", "report_type", "entity", "state"], source: "worker" },
  { name: "migration_report_last_received_timestamp_seconds", type: "gauge", description: "Unix time the worker last accepted a migrator report for a run.", labels: ["run_id", "report_type"], source: "worker" },
] as const satisfies readonly z.infer<typeof runtimeMetricContractSchema>[];

export type RuntimeMetricName = z.infer<typeof runtimeMetricNameSchema>;
