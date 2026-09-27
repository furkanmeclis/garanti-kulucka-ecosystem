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
import { assertProviderEnvelope } from "./registry.js";
import { buildProviderTransportPayload } from "./payloads.js";
import { providerTransportPolicyFor } from "./transport-policy.js";

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
  reason: ProviderRetryReason;
  attempts_remaining: number;
  retry_delay_ms: number | null;
};

export type ProviderRetryReason =
  | "retryable_status_code"
  | "retryable_error_code"
  | "missing_idempotency_key"
  | "attempts_exhausted"
  | "terminal_status_code"
  | "terminal_error";

const nonIdempotentOperations = new Set<ProviderOperation>([
  "invoice.create",
  "message.send",
  "sms.send",
]);

function classifyProviderFailure(input: ProviderFailureInput): {
  retryable: boolean;
  reason: ProviderRetryReason;
} {
  if (
    nonIdempotentOperations.has(input.operation) &&
    (!input.idempotency_key || input.idempotency_key.trim().length === 0)
  ) {
    return { retryable: false, reason: "missing_idempotency_key" };
  }

  if (input.status_code === 408 || input.status_code === 429) {
    return { retryable: true, reason: "retryable_status_code" };
  }

  if (typeof input.status_code === "number" && input.status_code >= 500) {
    return { retryable: true, reason: "retryable_status_code" };
  }

  if (input.error_code === "timeout" || input.error_code === "network_error") {
    return { retryable: true, reason: "retryable_error_code" };
  }

  if (typeof input.status_code === "number") {
    return { retryable: false, reason: "terminal_status_code" };
  }

  return { retryable: false, reason: "terminal_error" };
}

export function decideProviderRetry(input: ProviderFailureInput, now = new Date()): ProviderRetryDecision {
  const { retryable, reason } = classifyProviderFailure(input);
  const attemptsRemaining = input.attempt_number < input.max_attempts;

  if (retryable && attemptsRemaining) {
    const delayMs = Math.min(60_000, 2 ** Math.max(0, input.attempt_number - 1) * 2_000);
    return {
      status: "retryable_failure",
      retry_decision: "retry",
      next_retry_at: new Date(now.getTime() + delayMs).toISOString(),
      error_retryable: true,
      reason,
      attempts_remaining: Math.max(0, input.max_attempts - input.attempt_number),
      retry_delay_ms: delayMs,
    };
  }

  return {
    status: "terminal_failure",
    retry_decision: "dead_letter",
    next_retry_at: null,
    error_retryable: retryable,
    reason: retryable ? "attempts_exhausted" : reason,
    attempts_remaining: Math.max(0, input.max_attempts - input.attempt_number),
    retry_delay_ms: null,
  };
}

export function createProviderFailureAttempt(
  envelope: ProviderRequestEnvelope,
  job: JobEnvelope,
  input: Omit<ProviderFailureInput, "operation" | "idempotency_key"> & {
    status_code?: number | null;
    error_code: string;
    error_message: string;
  },
  now = new Date(),
): ProviderAttempt {
  const idempotencyKey =
    typeof envelope.payload.idempotency_key === "string" ? envelope.payload.idempotency_key : null;
  const decision = decideProviderRetry(
    {
      ...input,
      operation: envelope.operation,
      idempotency_key: idempotencyKey,
    },
    now,
  );

  return providerAttemptSchema.parse({
    provider: envelope.provider,
    operation: envelope.operation,
    direction: envelope.direction,
    request_id: envelope.request_id,
    account_public_id: envelope.account_public_id,
    started_at: new Date(job.requested_at).toISOString(),
    duration_ms: Math.max(0, now.getTime() - new Date(job.requested_at).getTime()),
    status: decision.status,
    status_code: input.status_code ?? null,
    retry_decision: decision.retry_decision,
    next_retry_at: decision.next_retry_at,
    idempotency_key: idempotencyKey,
    request_metadata: {
      queue: job.queue,
      job_id: job.job_id,
      channel: envelope.channel,
      retry: {
        reason: decision.reason,
        attempts_remaining: decision.attempts_remaining,
        retry_delay_ms: decision.retry_delay_ms,
        error_retryable: decision.error_retryable,
      },
    },
    response_metadata: {
      accepted: false,
      live_call_performed: false,
    },
    error: {
      code: input.error_code,
      message: input.error_message,
    },
  });
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
      transport_policy: providerTransportPolicyFor(envelope),
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
  assertProviderEnvelope(payload.envelope, "webhook");

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
  assertProviderEnvelope(payload.envelope, "delivery");

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
