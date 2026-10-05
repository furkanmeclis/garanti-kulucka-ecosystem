import { describe, expect, it } from "vitest";
import type { ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import {
  WhatsappLiveTransportError,
  type WhatsappFetchTransport,
  type WhatsappTransportRequest,
  type WhatsappTransportResponse,
} from "../src/providers/whatsapp.js";

const now = "2026-01-01T00:00:00.000Z";
const origin = "https://graph.test/v26.0";

function accountConfig(overrides: Record<string, unknown> = {}): ProviderAccountConfigRepository {
  return {
    getAccountConfig: async () => ({
      provider: "whatsapp",
      account_public_id: "iac_whatsapp_live",
      live_mode: true,
      tokens: {
        access_token: "whatsapp-access-token-secret",
      },
      settings: {
        "providers.whatsapp.live_mode": true,
        live_mode: true,
        api_url: origin,
        phone_number_id: "123456789",
        ...overrides,
      },
    }),
  };
}

function attemptRepository(persisted: ProviderAttempt[]): ProviderAttemptRepository {
  return {
    persist: async (attempt) => {
      persisted.push(attempt);
      return {
        id: persisted.length,
        public_id: `pat_${persisted.length}`,
        provider_id: 1,
        account_id: 1,
        request_id: attempt.request_id,
        operation: attempt.operation,
        direction: attempt.direction,
        status: attempt.status,
        status_code: attempt.status_code,
        duration_ms: attempt.duration_ms,
        retry_decision: attempt.retry_decision,
        next_retry_at: attempt.next_retry_at,
        idempotency_key: attempt.idempotency_key,
        request_metadata: attempt.request_metadata,
        response_metadata: attempt.response_metadata,
        error_code: attempt.error?.code ?? null,
        error_message: attempt.error?.message ?? null,
        started_at: attempt.started_at,
        created_at: new Date(now),
        updated_at: new Date(now),
      };
    },
  };
}

function deliveryJob(envelope: ProviderRequestEnvelope, attempts = 3) {
  return {
    id: "bull_job_whatsapp",
    name: `${envelope.provider}.${envelope.operation}`,
    attemptsMade: 0,
    opts: { attempts },
    data: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: `${envelope.provider}.${envelope.operation}`,
      requested_at: now,
      payload: { envelope },
    },
  };
}

function messageEnvelope(payload: Record<string, unknown> = {}): ProviderRequestEnvelope {
  return {
    request_id: "req_whatsapp_message",
    provider: "whatsapp",
    operation: "message.send",
    direction: "outbound",
    channel: "whatsapp",
    account_public_id: "iac_whatsapp_live",
    occurred_at: now,
    payload: {
      idempotency_key: "wa-message-1",
      conversation_public_id: "conv_wa",
      to: "+90 555 123 45 67",
      message: "Merhaba",
      ...payload,
    },
  };
}

function transportReturning(
  captured: WhatsappTransportRequest[],
  response: WhatsappTransportResponse,
): WhatsappFetchTransport {
  return async (request) => {
    captured.push(request);
    return response;
  };
}

function transportThrowing(captured: WhatsappTransportRequest[], error: Error & { code?: string }): WhatsappFetchTransport {
  return async (request) => {
    captured.push(request);
    throw error;
  };
}

const successResponse = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    messaging_product: "whatsapp",
    contacts: [{ input: "905551234567", wa_id: "905551234567" }],
    messages: [{ id: "wamid.123" }],
  }),
};

describe("WhatsApp Cloud API live adapter", () => {
  it("sends text message.send with the legacy Graph request material", async () => {
    const captured: WhatsappTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      whatsappTransport: transportReturning(captured, successResponse),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope()))).resolves.toMatchObject({
      status: "accepted_live",
      live_call_performed: true,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      method: "POST",
      url: `${origin}/123456789/messages`,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer whatsapp-access-token-secret",
      },
      whatsapp_endpoint: "messages",
    });
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({
      messaging_product: "whatsapp",
      to: "905551234567",
      type: "text",
      text: { body: "Merhaba" },
    });
    expect(persisted[0]).toMatchObject({ status: "success", status_code: 200, retry_decision: "none" });
    expect(JSON.stringify(persisted[0])).not.toContain("whatsapp-access-token-secret");
  });

  it("sends template and media JSON bodies through /messages", async () => {
    const templateCaptured: WhatsappTransportRequest[] = [];
    const mediaCaptured: WhatsappTransportRequest[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      whatsappTransport: transportReturning(templateCaptured, successResponse),
    });

    await registry.dispatch("provider-delivery", deliveryJob(messageEnvelope({
      type: "template",
      template_name: "hello_world",
      language_code: "tr",
      components: [{ type: "body", parameters: [{ type: "text", text: "Furkan" }] }],
    })));

    const mediaRegistry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      whatsappTransport: transportReturning(mediaCaptured, successResponse),
    });
    await mediaRegistry.dispatch("provider-delivery", deliveryJob(messageEnvelope({
      type: "document",
      media_id: "wamedia_123",
      caption: "Fatura",
      filename: "fatura.pdf",
    })));

    expect(JSON.parse(templateCaptured[0]?.body ?? "{}")).toEqual({
      messaging_product: "whatsapp",
      to: "905551234567",
      type: "template",
      template: {
        name: "hello_world",
        language: { code: "tr" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Furkan" }] }],
      },
    });
    expect(JSON.parse(mediaCaptured[0]?.body ?? "{}")).toEqual({
      messaging_product: "whatsapp",
      to: "905551234567",
      type: "document",
      document: {
        id: "wamedia_123",
        caption: "Fatura",
        filename: "fatura.pdf",
      },
    });
  });

  it.each([
    { status: 429, expected: "retryable_failure", decision: "retry" },
    { status: 503, expected: "retryable_failure", decision: "retry" },
  ])("persists retryable failure attempts for HTTP $status", async ({ status, expected, decision }) => {
    const captured: WhatsappTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      whatsappTransport: transportReturning(captured, { status, headers: {}, body: "retry later" }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope()))).rejects.toBeInstanceOf(WhatsappLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: expected,
      status_code: status,
      retry_decision: decision,
      error: { code: "provider_http_error" },
    });
    expect(JSON.stringify(persisted[0])).not.toContain("whatsapp-access-token-secret");
  });

  it("does not retry non-idempotent message.send without an idempotency key", async () => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      whatsappTransport: transportReturning([], { status: 503, headers: {}, body: "unavailable" }),
    });

    await expect(
      registry.dispatch("provider-delivery", deliveryJob(messageEnvelope({ idempotency_key: undefined }))),
    ).rejects.toBeInstanceOf(WhatsappLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      request_metadata: { retry: { reason: "missing_idempotency_key" } },
    });
  });

  it.each([
    {
      name: "401 token error",
      response: { status: 401, headers: {}, body: JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token." } }) },
    },
    {
      name: "Graph code 190 token error",
      response: { status: 400, headers: {}, body: JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token." } }) },
    },
  ])("dead-letters $name with a clear redacted error code", async ({ response }) => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      whatsappTransport: transportReturning([], response),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope()))).rejects.toBeInstanceOf(WhatsappLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      error: { code: "whatsapp_token_error", message: "WhatsApp access token was rejected by Meta" },
    });
    expect(JSON.stringify(persisted[0])).not.toContain("whatsapp-access-token-secret");
    expect(JSON.stringify(persisted[0])).not.toContain("Invalid OAuth access token.");
  });

  it.each([
    {
      name: "timeout",
      error: Object.assign(new Error("WhatsApp request timed out after 10ms"), { code: "timeout" }),
      expected: "timeout",
    },
    {
      name: "connection error",
      error: Object.assign(new Error("connect ECONNREFUSED"), { code: "network_error" }),
      expected: "network_error",
    },
  ])("persists retryable failure attempts for $name", async ({ error, expected }) => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      whatsappTransport: transportThrowing([], error),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope()))).rejects.toBeInstanceOf(WhatsappLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "retryable_failure",
      retry_decision: "retry",
      error: { code: expected },
    });
    expect(JSON.stringify(persisted[0])).not.toContain("whatsapp-access-token-secret");
  });

  it("dead-letters malformed JSON responses without leaking tokens", async () => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      whatsappTransport: transportReturning([], { status: 200, headers: {}, body: "not-json" }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope()))).rejects.toBeInstanceOf(WhatsappLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      error: { code: "malformed_response" },
    });
    expect(JSON.stringify(persisted[0])).not.toContain("whatsapp-access-token-secret");
  });
});
