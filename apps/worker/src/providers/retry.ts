import type { ProviderAttempt, ProviderOperation } from "@garanti-kulucka/shared";

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
  "invoice.e_document.create",
  "invoice.e_document.cancel",
  "invoice.e_document.resend",
  "invoice.delete",
  "invoice.payment.delete",
  "contact.create",
  "call.create",
  "call.confirmation.create",
  "message.send",
  "email.send",
  "shipment.create",
  "sms.send",
  "media.publish",
  "comment.reply",
  "comment.private_reply",
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

  if (input.error_code === "graph_rate_limit") {
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
