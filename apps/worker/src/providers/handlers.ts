import {
  type JobEnvelope,
  type ProviderAttempt,
  type ProviderName,
  type ProviderRequestEnvelope,
  providerDeliveryJobPayloadSchema,
  providerAttemptSchema,
  providerResponseEnvelopeSchema,
  providerWebhookJobPayloadSchema,
} from "@garanti-kulucka/shared";
import { assertProviderEnvelope } from "./registry.js";
import { buildProviderDryRunRequest } from "./dry-run-transport.js";
import { buildProviderTransportPayload } from "./payloads.js";
import { providerTransportPolicyFor } from "./transport-policy.js";
import {
  decideProviderRetry,
  type ProviderFailureInput,
  type ProviderRetryDecision,
  type ProviderRetryReason,
} from "./retry.js";
import type { ProviderAccountConfigRepository } from "./account-config.js";
import { PttLiveTransportError, sendPttLiveRequest, type PttFetchTransport } from "./ptt.js";

export { decideProviderRetry, type ProviderFailureInput, type ProviderRetryDecision, type ProviderRetryReason };

export interface ProviderJobHandlingResult {
  provider: ProviderName;
  request_id: string;
  queue: "provider-webhooks" | "provider-delivery";
  status: "accepted_fixture" | "accepted_live";
  live_call_performed: boolean;
  attempt: ProviderAttempt;
}

export interface ProviderDeliveryHandlerOptions {
  accountConfigRepository?: ProviderAccountConfigRepository;
  pttTransport?: PttFetchTransport;
  attemptNumber?: number;
  maxAttempts?: number;
  now?: Date;
}

function numericAccountSetting(
  settings: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return null;
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
      dry_run_request: buildProviderDryRunRequest(envelope),
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

export async function handleProviderDeliveryJobWithTransport(
  job: JobEnvelope,
  options: ProviderDeliveryHandlerOptions = {},
): Promise<ProviderJobHandlingResult> {
  if (job.queue !== "provider-delivery") {
    throw new Error(`Delivery handler received unexpected queue: ${job.queue}`);
  }

  const payload = providerDeliveryJobPayloadSchema.parse(job.payload);
  assertProviderEnvelope(payload.envelope, "delivery");

  const accountConfig = await options.accountConfigRepository?.getAccountConfig(
    payload.envelope.provider,
    payload.envelope.account_public_id,
  );
  const policy = providerTransportPolicyFor(payload.envelope, {
    liveModeEnabled: accountConfig?.live_mode ?? false,
    timeoutMs: accountConfig
      ? numericAccountSetting(accountConfig.settings, ["timeout_ms", "ptt.timeout_ms"])
      : null,
    maxAttempts: accountConfig
      ? numericAccountSetting(accountConfig.settings, ["max_attempts", "ptt.max_attempts"])
      : null,
  });

  if (
    payload.envelope.provider !== "ptt" ||
    !accountConfig ||
    !policy.live_call_permitted
  ) {
    return handleProviderDeliveryJob(job);
  }

  const liveResult = await sendPttLiveRequest({
    envelope: payload.envelope,
    job,
    accountConfig,
    policy,
    attemptNumber: options.attemptNumber ?? 1,
    maxAttempts: options.maxAttempts ?? policy.max_attempts,
    ...(options.pttTransport ? { transport: options.pttTransport } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  providerResponseEnvelopeSchema.parse({
    request_id: payload.envelope.request_id,
    provider: payload.envelope.provider,
    operation: payload.envelope.operation,
    status: "accepted",
    occurred_at: new Date().toISOString(),
    payload: liveResult.response_payload,
  });

  return {
    provider: payload.envelope.provider,
    request_id: payload.envelope.request_id,
    queue: "provider-delivery",
    status: "accepted_live",
    live_call_performed: true,
    attempt: liveResult.attempt,
  };
}

export function isProviderLiveTransportError(error: unknown): error is PttLiveTransportError {
  return error instanceof PttLiveTransportError;
}
