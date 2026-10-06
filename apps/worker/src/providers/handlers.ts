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
import { providerAttemptCorrelationMetadata } from "./correlation.js";
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
import { SuratLiveTransportError, sendSuratLiveRequest, type SuratFetchTransport } from "./surat.js";
import { KolaybiLiveTransportError, sendKolaybiLiveRequest, type KolaybiFetchTransport } from "./kolaybi.js";
import { WhatsappLiveTransportError, sendWhatsappLiveRequest, type WhatsappFetchTransport } from "./whatsapp.js";
import { InstagramLiveTransportError, sendInstagramLiveRequest, type InstagramFetchTransport } from "./instagram.js";
import {
  isInstagramGraphOperation,
  sendInstagramGraphLiveRequest,
  type InstagramGraphFetchTransport,
} from "./instagram-graph.js";
import type { ProviderMediaFileResolver } from "./media-files.js";
import { MessengerLiveTransportError, sendMessengerLiveRequest, type MessengerFetchTransport } from "./messenger.js";
import { NetgsmLiveTransportError, sendNetgsmLiveRequest, type NetgsmFetchTransport } from "./netgsm.js";
import { VapiLiveTransportError, sendVapiLiveRequest, type VapiFetchTransport } from "./vapi.js";

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
  suratTransport?: SuratFetchTransport;
  kolaybiTransport?: KolaybiFetchTransport;
  whatsappTransport?: WhatsappFetchTransport;
  instagramTransport?: InstagramFetchTransport;
  instagramGraphTransport?: InstagramGraphFetchTransport;
  mediaFileResolver?: ProviderMediaFileResolver;
  messengerTransport?: MessengerFetchTransport;
  netgsmTransport?: NetgsmFetchTransport;
  vapiTransport?: VapiFetchTransport;
  attemptNumber?: number;
  maxAttempts?: number;
  now?: Date;
}

function booleanSetting(settings: Record<string, unknown>, key: string): boolean | null {
  const value = settings[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

// P7 follow-up operations ported from legacy server.js require the explicit
// providers.<provider>.live_mode opt-in in addition to the account live_mode flag.
const explicitOptInOperations = new Set<ProviderOperation>([
  "invoice.get",
  "invoice.e_document.create",
  "invoice.e_document.cancel",
  "contact.find",
  "contact.create",
  "contact.update",
  "invoice.payment.create",
  "product.list",
  "call.confirmation.create",
  "call.confirmation.status",
  "call.report",
]);

function liveModeEnabledFor(
  provider: ProviderName,
  operation: ProviderOperation,
  accountConfig: { live_mode: boolean; settings: Record<string, unknown> },
): boolean {
  if (!accountConfig.live_mode) return false;
  if (
    provider === "whatsapp" ||
    provider === "instagram" ||
    provider === "messenger" ||
    provider === "vapi" ||
    explicitOptInOperations.has(operation)
  ) {
    return booleanSetting(accountConfig.settings, `providers.${provider}.live_mode`) === true;
  }
  return true;
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
      ...providerAttemptCorrelationMetadata(job, envelope),
      queue: job.queue,
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
      ...providerAttemptCorrelationMetadata(job, envelope),
      queue,
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
    liveModeEnabled: accountConfig ? liveModeEnabledFor(payload.envelope.provider, payload.envelope.operation, accountConfig) : false,
    timeoutMs: accountConfig
      ? numericAccountSetting(accountConfig.settings, ["timeout_ms", `${payload.envelope.provider}.timeout_ms`])
      : null,
    maxAttempts: accountConfig
      ? numericAccountSetting(accountConfig.settings, ["max_attempts", `${payload.envelope.provider}.max_attempts`])
      : null,
  });

  if (
    !accountConfig ||
    !policy.live_call_permitted
  ) {
    return handleProviderDeliveryJob(job);
  }

  const liveResult = payload.envelope.provider === "ptt"
    ? await sendPttLiveRequest({
        envelope: payload.envelope,
        job,
        accountConfig,
        policy,
        attemptNumber: options.attemptNumber ?? 1,
        maxAttempts: options.maxAttempts ?? policy.max_attempts,
        ...(options.pttTransport ? { transport: options.pttTransport } : {}),
        ...(options.now ? { now: options.now } : {}),
      })
    : payload.envelope.provider === "surat"
      ? await sendSuratLiveRequest({
          envelope: payload.envelope,
          job,
          accountConfig,
          policy,
          attemptNumber: options.attemptNumber ?? 1,
          maxAttempts: options.maxAttempts ?? policy.max_attempts,
          ...(options.suratTransport ? { transport: options.suratTransport } : {}),
          ...(options.now ? { now: options.now } : {}),
        })
      : payload.envelope.provider === "kolaybi"
        ? await sendKolaybiLiveRequest({
            envelope: payload.envelope,
            job,
            accountConfig,
            policy,
            attemptNumber: options.attemptNumber ?? 1,
            maxAttempts: options.maxAttempts ?? policy.max_attempts,
            ...(options.kolaybiTransport ? { transport: options.kolaybiTransport } : {}),
            ...(options.now ? { now: options.now } : {}),
          })
        : payload.envelope.provider === "whatsapp"
          ? await sendWhatsappLiveRequest({
              envelope: payload.envelope,
              job,
              accountConfig,
              policy,
              attemptNumber: options.attemptNumber ?? 1,
              maxAttempts: options.maxAttempts ?? policy.max_attempts,
              ...(options.whatsappTransport ? { transport: options.whatsappTransport } : {}),
              ...(options.mediaFileResolver ? { mediaFileResolver: options.mediaFileResolver } : {}),
              ...(options.now ? { now: options.now } : {}),
            })
          : payload.envelope.provider === "instagram" && isInstagramGraphOperation(payload.envelope.operation)
            ? await sendInstagramGraphLiveRequest({
                envelope: payload.envelope,
                job,
                accountConfig,
                policy,
                attemptNumber: options.attemptNumber ?? 1,
                maxAttempts: options.maxAttempts ?? policy.max_attempts,
                ...(options.instagramGraphTransport ? { transport: options.instagramGraphTransport } : {}),
                ...(options.now ? { now: options.now } : {}),
              })
          : payload.envelope.provider === "instagram"
            ? await sendInstagramLiveRequest({
                envelope: payload.envelope,
                job,
                accountConfig,
                policy,
                attemptNumber: options.attemptNumber ?? 1,
                maxAttempts: options.maxAttempts ?? policy.max_attempts,
                ...(options.instagramTransport ? { transport: options.instagramTransport } : {}),
                ...(options.now ? { now: options.now } : {}),
              })
            : payload.envelope.provider === "messenger"
              ? await sendMessengerLiveRequest({
                  envelope: payload.envelope,
                  job,
                  accountConfig,
                  policy,
                  attemptNumber: options.attemptNumber ?? 1,
                  maxAttempts: options.maxAttempts ?? policy.max_attempts,
                  ...(options.messengerTransport ? { transport: options.messengerTransport } : {}),
                  ...(options.now ? { now: options.now } : {}),
                })
              : payload.envelope.provider === "netgsm"
                ? await sendNetgsmLiveRequest({
                    envelope: payload.envelope,
                    job,
                    accountConfig,
                    policy,
                    attemptNumber: options.attemptNumber ?? 1,
                    maxAttempts: options.maxAttempts ?? policy.max_attempts,
                    ...(options.netgsmTransport ? { transport: options.netgsmTransport } : {}),
                    ...(options.now ? { now: options.now } : {}),
                  })
                : payload.envelope.provider === "vapi"
                  ? await sendVapiLiveRequest({
                      envelope: payload.envelope,
                      job,
                      accountConfig,
                      policy,
                      attemptNumber: options.attemptNumber ?? 1,
                      maxAttempts: options.maxAttempts ?? policy.max_attempts,
                      ...(options.vapiTransport ? { transport: options.vapiTransport } : {}),
                      ...(options.now ? { now: options.now } : {}),
                    })
                  : null;

  if (!liveResult) {
    return handleProviderDeliveryJob(job);
  }

  providerResponseEnvelopeSchema.parse({
    request_id: payload.envelope.request_id,
    provider: payload.envelope.provider,
    operation: payload.envelope.operation,
    status: "accepted",
    occurred_at: new Date().toISOString(),
    payload: liveResult.response_payload,
  });

  // Order action workflows (KolayBi cari/fatura, NetGSM teyit) read the normalized provider result back
  // from the persisted attempt to advance to their next atomic step.
  const persistsResult = resultPersistingOperations.has(payload.envelope.operation);
  return {
    provider: payload.envelope.provider,
    request_id: payload.envelope.request_id,
    queue: "provider-delivery",
    status: "accepted_live",
    live_call_performed: true,
    attempt: persistsResult
      ? { ...liveResult.attempt, response_metadata: { ...liveResult.attempt.response_metadata, result: liveResult.response_payload } }
      : liveResult.attempt,
  };
}

const resultPersistingOperations = new Set<string>([
  "contact.find",
  "contact.create",
  "invoice.create",
  "invoice.get",
  "invoice.e_document.create",
  "invoice.e_document.cancel",
  "call.confirmation.create",
  "call.confirmation.status",
]);

export function isProviderLiveTransportError(
  error: unknown,
): error is PttLiveTransportError | SuratLiveTransportError | KolaybiLiveTransportError | WhatsappLiveTransportError | InstagramLiveTransportError | MessengerLiveTransportError | NetgsmLiveTransportError | VapiLiveTransportError {
  return error instanceof PttLiveTransportError ||
    error instanceof SuratLiveTransportError ||
    error instanceof KolaybiLiveTransportError ||
    error instanceof WhatsappLiveTransportError ||
    error instanceof InstagramLiveTransportError ||
    error instanceof MessengerLiveTransportError ||
    error instanceof NetgsmLiveTransportError ||
    error instanceof VapiLiveTransportError;
}
