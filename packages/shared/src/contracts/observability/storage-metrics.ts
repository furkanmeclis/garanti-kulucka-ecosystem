import { z } from "zod";

export const storageMetricNameSchema = z.enum([
  "storage_orphan_candidate_count",
  "storage_orphan_cleanup_apply_total",
  "storage_orphan_cleanup_error_total",
  "garage_capacity_bytes",
  "garage_backup_age_seconds",
]);

export const storageMetricContractSchema = z.object({
  name: storageMetricNameSchema,
  type: z.enum(["gauge", "counter"]),
  description: z.string().min(1),
  labels: z.array(z.string().min(1)),
  source: z.enum(["api", "external_scrape"]),
});

export const storageMetricContracts = [
  {
    name: "storage_orphan_candidate_count",
    type: "gauge",
    description: "Current count of file metadata rows eligible for orphan object cleanup.",
    labels: ["bucket"],
    source: "api",
  },
  {
    name: "storage_orphan_cleanup_apply_total",
    type: "counter",
    description: "Total controlled orphan cleanup apply attempts that reached the delete gate.",
    labels: ["bucket", "result_code"],
    source: "api",
  },
  {
    name: "storage_orphan_cleanup_error_total",
    type: "counter",
    description: "Total controlled orphan cleanup failures grouped by operational result code.",
    labels: ["bucket", "result_code"],
    source: "api",
  },
  {
    name: "garage_capacity_bytes",
    type: "gauge",
    description: "Garage media storage capacity and free-space measurements scraped from infrastructure.",
    labels: ["bucket", "state"],
    source: "external_scrape",
  },
  {
    name: "garage_backup_age_seconds",
    type: "gauge",
    description: "Age of the newest verified Garage backup or restore probe evidence.",
    labels: ["bucket"],
    source: "external_scrape",
  },
] as const;

export type StorageMetricName = z.infer<typeof storageMetricNameSchema>;
export type StorageMetricContract = z.infer<typeof storageMetricContractSchema>;
