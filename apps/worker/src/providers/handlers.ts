import {
  type JobEnvelope,
  type ProviderName,
  providerDeliveryJobPayloadSchema,
  providerResponseEnvelopeSchema,
  providerWebhookJobPayloadSchema,
} from "@garanti-kulucka/shared";
import { assertProviderOperation } from "./registry.js";

export interface ProviderJobHandlingResult {
  provider: ProviderName;
  request_id: string;
  queue: "provider-webhooks" | "provider-delivery";
  status: "accepted_fixture";
  live_call_performed: false;
}

export function handleProviderWebhookJob(job: JobEnvelope): ProviderJobHandlingResult {
  if (job.queue !== "provider-webhooks") {
    throw new Error(`Webhook handler received unexpected queue: ${job.queue}`);
  }

  const payload = providerWebhookJobPayloadSchema.parse(job.payload);
  assertProviderOperation(payload.envelope.provider, payload.envelope.operation, "webhook");

  providerResponseEnvelopeSchema.parse({
    request_id: payload.envelope.request_id,
    provider: payload.envelope.provider,
    operation: payload.envelope.operation,
    status: "accepted",
    occurred_at: new Date().toISOString(),
    payload: {
      fixture_only: true,
      job_id: job.job_id,
    },
  });

  return {
    provider: payload.envelope.provider,
    request_id: payload.envelope.request_id,
    queue: "provider-webhooks",
    status: "accepted_fixture",
    live_call_performed: false,
  };
}

export function handleProviderDeliveryJob(job: JobEnvelope): ProviderJobHandlingResult {
  if (job.queue !== "provider-delivery") {
    throw new Error(`Delivery handler received unexpected queue: ${job.queue}`);
  }

  const payload = providerDeliveryJobPayloadSchema.parse(job.payload);
  assertProviderOperation(payload.envelope.provider, payload.envelope.operation, "delivery");

  providerResponseEnvelopeSchema.parse({
    request_id: payload.envelope.request_id,
    provider: payload.envelope.provider,
    operation: payload.envelope.operation,
    status: "accepted",
    occurred_at: new Date().toISOString(),
    payload: {
      fixture_only: true,
      job_id: job.job_id,
    },
  });

  return {
    provider: payload.envelope.provider,
    request_id: payload.envelope.request_id,
    queue: "provider-delivery",
    status: "accepted_fixture",
    live_call_performed: false,
  };
}
