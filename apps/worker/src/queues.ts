import { jobEnvelopeSchema, type JobEnvelope, type QueueName } from "@garanti-kulucka/shared";

export function validateJobEnvelope(input: unknown): JobEnvelope {
  return jobEnvelopeSchema.parse(input);
}

export const queueNames: QueueName[] = [
  "provider-webhooks",
  "provider-delivery",
  "shipment-tracking",
  "ai-replies",
  "migration-reports",
];
