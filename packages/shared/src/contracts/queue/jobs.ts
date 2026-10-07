import { z } from "zod";

export const queueNameSchema = z.enum([
  "provider-webhooks",
  "provider-delivery",
  "shipment-tracking",
  "ai-replies",
  "migration-reports",
  "storage-orphan-reconciliation",
  "data-retention",
]);

export const jobEnvelopeSchema = z.object({
  job_id: z.string().min(1),
  queue: queueNameSchema,
  name: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  requested_at: z.string().datetime(),
  request_id: z.string().min(1).optional(),
});

export type QueueName = z.infer<typeof queueNameSchema>;
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;
