import {
  type JobEnvelope,
  type ProviderAttempt,
  type ProviderName,
  type ProviderOperation,
  type ProviderRequestEnvelope,
  providerDeliveryJobPayloadSchema,
  providerAttemptSchema,
  providerResponseEnvelopeSchema,
  providerWebhookJobPayloadSchema,
} from "@garanti-kulucka/shared";
import { assertProviderOperation } from "./registry.js";
import { buildProviderTransportPayload } from "./payloads.js";

export interface ProviderJobHandlingResult {
  provider: ProviderName;
  request_id: string;
  queue: "provider-webhooks" | "provider-delivery";
  status: "accepted_fixture";
  live_call_performed: false;
  attempt: ProviderAttempt;
}

export interface ProviderFailureInput {
  operation: ProviderOperation;
  status_code?: number | null;
  error_code?: string | null;
  attempt_number: number;
  max_attempts: number;
  idempotency_key?: string | null;
}

export type ProviderRetryDecision = Pick<
  ProviderAttempt,
  "status" | "retry_decision" | "next_retry_at"
> & {
  error_retryable: boolean;
};

const nonIdempotentOperations = new Set<ProviderOperation>([
  "invoice.create",
  "message.send",
  "sms.send",
]);

function isRetryableProviderFailure(input: ProviderFailureInput): boolean {
  if (
    nonIdempotentOperations.has(input.operation) &&
    (!input.idempotency_key || input.idempotency_key.trim().length === 0)
  ) {
    return false;
  }

  if (input.status_code === 408 || input.status_code === 429) {
    return true;
  }

  if (typeof input.status_code === "number" && input.status_code >= 500) {
    return true;
  }

  return input.error_code === "timeout" || input.error_code === "network_error";
}

export function decideProviderRetry(input: ProviderFailureInput, now = new Date()): ProviderRetryDecision {
  const retryable = isRetryableProviderFailure(input);
  const attemptsRemaining = input.attempt_number < input.max_attempts;

  if (retryable && attemptsRemaining) {
    const delayMs = Math.min(60_000, 2 ** Math.max(0, input.attempt_number - 1) * 2_000);
    return {
      status: "retryable_failure",
      retry_decision: "retry",
      next_retry_at: new Date(now.getTime() + delayMs).toISOString(),
      error_retryable: true,
    };
  }

  return {
    status: "terminal_failure",
    retry_decision: "dead_letter",
    next_retry_at: null,
    error_retryable: retryable,
  };
}

function createFixtureAttempt(
  envelope: ProviderRequestEnvelope,
  job: JobEnvelope,
  queue: ProviderJobHandlingResult["queue"],
): ProviderAttempt {
  const startedAt = new Date(job.requested_at);
  const durationMs = Math.max(0, Date.now() - startedAt.getTime());

  return providerAttemptSchema.parse({
    provider: envelope.provider,
    operation: envelope.operation,
    direction: envelope.direction,
    request_id: envelope.request_id,
    account_public_id: envelope.account_public_id,
    started_at: startedAt.toISOString(),
    duration_ms: durationMs,
    status: "success",
    status_code: 202,
    retry_decision: "none",
    next_retry_at: null,
    idempotency_key:
      typeof envelope.payload.idempotency_key === "string" ? envelope.payload.idempotency_key : null,
    request_metadata: {
      queue,
      job_id: job.job_id,
      channel: envelope.channel,
      fixture_only: true,
      transport_payload: buildProviderTransportPayload(envelope),
    },
    response_metadata: {
      accepted: true,
      live_call_performed: false,
    },
    error: null,
  });
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
    attempt: createFixtureAttempt(payload.envelope, job, "provider-webhooks"),
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
    attempt: createFixtureAttempt(payload.envelope, job, "provider-delivery"),
  };
}
