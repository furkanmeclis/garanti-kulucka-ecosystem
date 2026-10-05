import { describe, expect, it } from "vitest";
import type { ProviderAttempt, ProviderName, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import {
  InstagramLiveTransportError,
  type InstagramFetchTransport,
  type InstagramTransportRequest,
  type InstagramTransportResponse,
} from "../src/providers/instagram.js";
import {
  MessengerLiveTransportError,
  type MessengerFetchTransport,
  type MessengerTransportRequest,
  type MessengerTransportResponse,
} from "../src/providers/messenger.js";

const now = "2026-01-01T00:00:00.000Z";
const origin = "https://graph.test/v26.0";

type MetaProvider = "instagram" | "messenger";
type MetaRequest = InstagramTransportRequest | MessengerTransportRequest;
type MetaResponse = InstagramTransportResponse | MessengerTransportResponse;
type MetaTransport = InstagramFetchTransport | MessengerFetchTransport;

function accountConfig(provider: MetaProvider, overrides: Record<string, unknown> = {}): ProviderAccountConfigRepository {
  return {
    getAccountConfig: async () => ({
      provider,
      account_public_id: `iac_${provider}_live`,
      live_mode: true,
      tokens: provider === "instagram"
        ? { access_token: `${provider}-access-token-secret` }
        : { page_access_token: `${provider}-access-token-secret` },
      settings: {
        [`providers.${provider}.live_mode`]: true,
        live_mode: true,
        api_url: origin,
        ...(provider === "instagram" ? { ig_user_id: "17841400000000000" } : { page_id: "1122334455" }),
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
    id: `bull_job_${envelope.provider}`,
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

function messageEnvelope(provider: MetaProvider, payload: Record<string, unknown> = {}): ProviderRequestEnvelope {
  return {
    request_id: `req_${provider}_message`,
    provider,
    operation: "message.send",
    direction: "outbound",
    channel: provider,
    account_public_id: `iac_${provider}_live`,
    occurred_at: now,
    payload: {
      idempotency_key: `${provider}-message-1`,
      conversation_public_id: `conv_${provider}`,
      recipient_id: provider === "instagram" ? "17841499999999999" : "psid_messenger_demo",
      message: "Merhaba",
      ...payload,
    },
  };
}

function transportReturning(captured: MetaRequest[], response: MetaResponse): MetaTransport {
  return (async (request: MetaRequest) => {
    captured.push(request);
    return response;
  }) as MetaTransport;
}

function transportThrowing(captured: MetaRequest[], error: Error & { code?: string }): MetaTransport {
  return (async (request: MetaRequest) => {
    captured.push(request);
    throw error;
  }) as MetaTransport;
}

const providers = [
  {
    provider: "instagram" as const,
    errorClass: InstagramLiveTransportError,
    transportKey: "instagramTransport" as const,
    expectedPath: "/17841400000000000/messages",
    expectedBody: {
      recipient: { id: "17841499999999999" },
      message: { text: "Merhaba" },
    },
    tokenError: "instagram_token_error",
    tokenMessage: "Instagram access token was rejected by Meta",
  },
  {
    provider: "messenger" as const,
    errorClass: MessengerLiveTransportError,
    transportKey: "messengerTransport" as const,
    expectedPath: "/1122334455/messages",
    expectedBody: {
      recipient: { id: "psid_messenger_demo" },
      message: { text: "Merhaba" },
      messaging_type: "RESPONSE",
    },
    tokenError: "messenger_token_error",
    tokenMessage: "Messenger page access token was rejected by Meta",
  },
];

const successResponse = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    recipient_id: "recipient_1",
    message_id: "mid.123",
  }),
};

describe.each(providers)("$provider Graph live adapter", (spec) => {
  it("sends message.send with legacy Graph request material", async () => {
    const captured: MetaRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(spec.provider),
      providerAttemptRepository: attemptRepository(persisted),
      [spec.transportKey]: transportReturning(captured, successResponse),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope(spec.provider)))).resolves.toMatchObject({
      status: "accepted_live",
      live_call_performed: true,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      method: "POST",
      url: `${origin}${spec.expectedPath}`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${spec.provider}-access-token-secret`,
      },
      meta_endpoint: "messages",
      meta_provider: spec.provider,
    });
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual(spec.expectedBody);
    expect(persisted[0]).toMatchObject({ provider: spec.provider as ProviderName, status: "success", status_code: 200, retry_decision: "none" });
    expect(JSON.stringify(persisted[0])).not.toContain(`${spec.provider}-access-token-secret`);
  });

  it("gates live calls behind provider live_mode and account opt-in", async () => {
    const captured: MetaRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(spec.provider, { [`providers.${spec.provider}.live_mode`]: false }),
      providerAttemptRepository: attemptRepository(persisted),
      [spec.transportKey]: transportReturning(captured, successResponse),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope(spec.provider)))).resolves.toMatchObject({
      status: "accepted_fixture",
      live_call_performed: false,
    });
    expect(captured).toHaveLength(0);
  });

  it.each([
    { status: 429, body: "retry later", errorCode: "provider_http_error" },
    { status: 503, body: "unavailable", errorCode: "provider_http_error" },
    { status: 400, body: JSON.stringify({ error: { code: 4, message: "Application request limit reached" } }), errorCode: "graph_rate_limit" },
    { status: 400, body: JSON.stringify({ error: { code: 17, message: "User request limit reached" } }), errorCode: "graph_rate_limit" },
    { status: 400, body: JSON.stringify({ error: { code: 613, message: "Calls to this api have exceeded rate limit" } }), errorCode: "graph_rate_limit" },
  ])("persists retryable failure attempts for HTTP/Graph rate failure %#", async ({ status, body, errorCode }) => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(spec.provider),
      providerAttemptRepository: attemptRepository(persisted),
      [spec.transportKey]: transportReturning([], { status, headers: {}, body }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope(spec.provider)))).rejects.toBeInstanceOf(spec.errorClass);

    expect(persisted[0]).toMatchObject({
      status: "retryable_failure",
      retry_decision: "retry",
      error: { code: errorCode },
    });
    expect(JSON.stringify(persisted[0])).not.toContain(`${spec.provider}-access-token-secret`);
  });

  it("does not retry non-idempotent message.send without an idempotency key", async () => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(spec.provider),
      providerAttemptRepository: attemptRepository(persisted),
      [spec.transportKey]: transportReturning([], { status: 503, headers: {}, body: "unavailable" }),
    });

    await expect(
      registry.dispatch("provider-delivery", deliveryJob(messageEnvelope(spec.provider, { idempotency_key: undefined }))),
    ).rejects.toBeInstanceOf(spec.errorClass);

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
      providerAccountConfigRepository: accountConfig(spec.provider),
      providerAttemptRepository: attemptRepository(persisted),
      [spec.transportKey]: transportReturning([], response),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope(spec.provider)))).rejects.toBeInstanceOf(spec.errorClass);

    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      error: { code: spec.tokenError, message: spec.tokenMessage },
    });
    expect(JSON.stringify(persisted[0])).not.toContain(`${spec.provider}-access-token-secret`);
    expect(JSON.stringify(persisted[0])).not.toContain("Invalid OAuth access token.");
  });

  it.each([
    {
      name: "timeout",
      error: Object.assign(new Error(`${spec.provider} request timed out after 10ms`), { code: "timeout" }),
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
      providerAccountConfigRepository: accountConfig(spec.provider),
      providerAttemptRepository: attemptRepository(persisted),
      [spec.transportKey]: transportThrowing([], error),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope(spec.provider)))).rejects.toBeInstanceOf(spec.errorClass);

    expect(persisted[0]).toMatchObject({
      status: "retryable_failure",
      retry_decision: "retry",
      error: { code: expected },
    });
    expect(JSON.stringify(persisted[0])).not.toContain(`${spec.provider}-access-token-secret`);
  });

  it("dead-letters malformed JSON responses without leaking tokens", async () => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(spec.provider),
      providerAttemptRepository: attemptRepository(persisted),
      [spec.transportKey]: transportReturning([], { status: 200, headers: {}, body: "not-json" }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(messageEnvelope(spec.provider)))).rejects.toBeInstanceOf(spec.errorClass);

    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      error: { code: "malformed_response" },
    });
    expect(JSON.stringify(persisted[0])).not.toContain(`${spec.provider}-access-token-secret`);
  });
});
