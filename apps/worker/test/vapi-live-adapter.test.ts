import { describe, expect, it } from "vitest";
import type { ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import {
  VapiLiveTransportError,
  type VapiFetchTransport,
  type VapiTransportRequest,
  type VapiTransportResponse,
} from "../src/providers/vapi.js";

const now = "2026-01-01T00:00:00.000Z";
const origin = "https://vapi.test";
const apiKey = "vapi-api-key-secret";

function accountConfig(overrides: Record<string, unknown> = {}): ProviderAccountConfigRepository {
  return {
    getAccountConfig: async () => ({
      provider: "vapi",
      account_public_id: "iac_vapi_live",
      live_mode: true,
      tokens: {
        api_key: apiKey,
      },
      settings: {
        "providers.vapi.live_mode": true,
        live_mode: true,
        api_url: origin,
        phone_number_id: "pn_legacy",
        assistant_id: "asst_legacy",
        system_prompt: "Kargo aramasi: {musteri_adi} {kargo_firmasi} {takip_no} {son_hareket}",
        tts_provider: "azure",
        tts_voice: "tr-TR-AhmetNeural",
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
    id: "bull_job_vapi",
    name: `${envelope.provider}.${envelope.operation}`,
    attemptsMade: 0,
    opts: { attempts },
    data: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: `${envelope.provider}.${envelope.operation}`,
      requested_at: now,
      request_id: `api_${envelope.request_id}`,
      payload: { envelope },
    },
  };
}

function callEnvelope(payload: Record<string, unknown> = {}): ProviderRequestEnvelope {
  return {
    request_id: "req_vapi_call",
    provider: "vapi",
    operation: "call.create",
    direction: "outbound",
    channel: "voice",
    account_public_id: "iac_vapi_live",
    occurred_at: now,
    payload: {
      idempotency_key: "vapi-call-1",
      customer_phone: "0555 123 45 67",
      customer_name: "Ayse Yilmaz",
      cargo_provider: "PTT",
      tracking_number: "PTT123",
      last_event_text: "Subede bekliyor",
      ...payload,
    },
  };
}

function transportReturning(
  captured: VapiTransportRequest[],
  response: VapiTransportResponse,
): VapiFetchTransport {
  return async (request) => {
    captured.push(request);
    return response;
  };
}

function transportThrowing(captured: VapiTransportRequest[], error: Error & { code?: string }): VapiFetchTransport {
  return async (request) => {
    captured.push(request);
    throw error;
  };
}

function expectNoCredentialLeak(attempt: ProviderAttempt | undefined): void {
  const serialized = JSON.stringify(attempt);
  expect(serialized).not.toContain(apiKey);
  expect(serialized).not.toContain("Bearer vapi");
}

describe("Vapi live adapter", () => {
  it("sends call.create with the legacy Vapi request material", async () => {
    const captured: VapiTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      vapiTransport: transportReturning(captured, {
        status: 201,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "call_123", status: "queued" }),
      }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(callEnvelope()))).resolves.toMatchObject({
      status: "accepted_live",
      live_call_performed: true,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      method: "POST",
      url: `${origin}/call/phone`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      vapi_endpoint: "call.create",
    });
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({
      phoneNumberId: "pn_legacy",
      customer: {
        number: "+905551234567",
        name: "Ayse Yilmaz",
      },
      assistantId: "asst_legacy",
      assistantOverrides: {
        firstMessage: "Merhaba Ayse Yilmaz, ben Garanti Kuluçka'dan arıyorum. Kargonuz PTT firmasında, son durumu: Subede bekliyor. İade olmaması için lütfen en kısa sürede şubeden teslim alın.",
        model: {
          provider: "openai",
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "ÖNEMLİ: Bu arama SATIŞ veya GENEL DESTEK araması DEĞİL. Sadece kargo bilgilendirmesi yap. Fiyat, ürün özellikleri veya SSS anlatma. Müşteri adı: Ayse Yilmaz. Kargo firması: PTT. Takip no: PTT123. Son durum: Subede bekliyor.\n\nKargo aramasi: Ayse Yilmaz PTT PTT123 Subede bekliyor",
            },
          ],
        },
        voice: {
          provider: "azure",
          voiceId: "tr-TR-AhmetNeural",
        },
        variableValues: {
          musteri_adi: "Ayse Yilmaz",
          kargo_firmasi: "PTT",
          takip_no: "PTT123",
          son_hareket: "Subede bekliyor",
        },
        endCallMessage: "İyi günler, hoşça kalın.",
        maxDurationSeconds: 180,
      },
    });
    expect(persisted[0]).toMatchObject({
      status: "success",
      status_code: 201,
      retry_decision: "none",
      response_metadata: { vapi_call_id: "call_123" },
    });
    expectNoCredentialLeak(persisted[0]);
  });

  it("builds inline assistant calls when no assistant id is configured", async () => {
    const captured: VapiTransportRequest[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig({ assistant_id: "" }),
      vapiTransport: transportReturning(captured, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "call_inline" }),
      }),
    });

    await registry.dispatch("provider-delivery", deliveryJob(callEnvelope()));

    const body = JSON.parse(captured[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body).not.toHaveProperty("assistantId");
    expect(body).toHaveProperty("assistant");
    expect(body.assistant).toMatchObject({
      transcriber: { provider: "deepgram", model: "nova-2", language: "tr" },
      maxDurationSeconds: 180,
    });
  });

  it.each([
    { status: 401, expected: "terminal_failure", decision: "dead_letter" },
    { status: 429, expected: "retryable_failure", decision: "retry" },
    { status: 503, expected: "retryable_failure", decision: "retry" },
  ])("persists failure attempts for HTTP $status", async ({ status, expected, decision }) => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      vapiTransport: transportReturning([], { status, headers: {}, body: "retry later" }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(callEnvelope()))).rejects.toBeInstanceOf(VapiLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: expected,
      status_code: status,
      retry_decision: decision,
      error: { code: "provider_http_error" },
    });
    expectNoCredentialLeak(persisted[0]);
  });

  it("does not retry non-idempotent call.create without an idempotency key", async () => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      vapiTransport: transportReturning([], { status: 503, headers: {}, body: "unavailable" }),
    });

    await expect(
      registry.dispatch("provider-delivery", deliveryJob(callEnvelope({ idempotency_key: undefined }))),
    ).rejects.toBeInstanceOf(VapiLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      request_metadata: { retry: { reason: "missing_idempotency_key" } },
    });
    expectNoCredentialLeak(persisted[0]);
  });

  it.each([
    {
      name: "timeout",
      error: Object.assign(new Error("Vapi request timed out after 10ms"), { code: "timeout" }),
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
      vapiTransport: transportThrowing([], error),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(callEnvelope()))).rejects.toBeInstanceOf(VapiLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "retryable_failure",
      retry_decision: "retry",
      error: { code: expected },
    });
    expectNoCredentialLeak(persisted[0]);
  });

  it.each([
    { name: "empty response", body: "" },
    { name: "missing id", body: JSON.stringify({ status: "queued" }) },
  ])("dead-letters malformed responses: $name", async ({ body }) => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      vapiTransport: transportReturning([], { status: 200, headers: {}, body }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(callEnvelope()))).rejects.toBeInstanceOf(VapiLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      error: { code: "malformed_response" },
    });
    expectNoCredentialLeak(persisted[0]);
  });

  it("gates live calls behind provider live mode and account opt-in", async () => {
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: {
        getAccountConfig: async () => ({
          provider: "vapi",
          account_public_id: "iac_vapi_live",
          live_mode: true,
          tokens: { api_key: apiKey },
          settings: {
            "providers.vapi.live_mode": false,
            live_mode: true,
            api_url: origin,
            phone_number_id: "pn_legacy",
          },
        }),
      },
      vapiTransport: async () => {
        throw new Error("transport should not be called");
      },
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(callEnvelope()))).resolves.toMatchObject({
      status: "accepted_fixture",
      live_call_performed: false,
    });
  });

  it("keeps SIP media and webphone config outside the worker Vapi request boundary", async () => {
    const captured: VapiTransportRequest[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      vapiTransport: transportReturning(captured, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "call_no_sip" }),
      }),
    });

    await registry.dispatch("provider-delivery", deliveryJob(callEnvelope({
      sip_username: "agent100",
      sip_password: "sip-secret",
      sip_websocket_url: "wss://sip.example.com/ws",
      webphone: { enabled: true },
      media_proxy_url: "rtp://worker.example.com",
    })));

    const serializedBody = JSON.stringify(JSON.parse(captured[0]?.body ?? "{}"));
    expect(serializedBody).not.toContain("sip");
    expect(serializedBody).not.toContain("webphone");
    expect(serializedBody).not.toContain("media_proxy");
    expect(serializedBody).not.toContain("rtp://");
  });
});
