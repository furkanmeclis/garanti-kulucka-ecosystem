import type { JobEnvelope, ProviderRequestEnvelope } from "@garanti-kulucka/shared";

export function providerAttemptCorrelationMetadata(
  job: JobEnvelope,
  envelope: ProviderRequestEnvelope,
): Record<string, unknown> {
  const payload = job.payload as {
    webhook_event_public_id?: unknown;
    envelope?: {
      webhook_event_public_id?: unknown;
    };
  };
  const webhookEventId =
    typeof payload.webhook_event_public_id === "string"
      ? payload.webhook_event_public_id
      : typeof payload.envelope?.webhook_event_public_id === "string"
        ? payload.envelope.webhook_event_public_id
        : null;

  return {
    request_id: job.request_id ?? envelope.request_id,
    job_id: job.job_id,
    webhook_event_id: webhookEventId,
    provider_attempt_id: null,
  };
}
