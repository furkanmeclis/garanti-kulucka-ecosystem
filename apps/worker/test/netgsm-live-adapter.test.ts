import { describe, expect, it } from "vitest";
import type { ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import {
  NetgsmLiveTransportError,
  type NetgsmFetchTransport,
  type NetgsmTransportRequest,
  type NetgsmTransportResponse,
} from "../src/providers/netgsm.js";

const now = "2026-01-01T00:00:00.000Z";
const origin = "https://netgsm.test";
const usercode = "3229110532";
const password = "netgsm-password-secret";

function accountConfig(overrides: Record<string, unknown> = {}): ProviderAccountConfigRepository {
  return {
    getAccountConfig: async () => ({
      provider: "netgsm",
      account_public_id: "iac_netgsm_live",
      live_mode: true,
      tokens: {
        sms_usercode: usercode,
        sms_password: password,
      },
      settings: {
        "providers.netgsm.live_mode": true,
        live_mode: true,
        api_url: origin,
        msgheader: "GARANTIKLC",
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
    id: "bull_job_netgsm",
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

function smsEnvelope(payload: Record<string, unknown> = {}): ProviderRequestEnvelope {
  return {
    request_id: "req_netgsm_sms",
    provider: "netgsm",
    operation: "sms.send",
    direction: "outbound",
    channel: "sms",
    account_public_id: "iac_netgsm_live",
    occurred_at: now,
    payload: {
      idempotency_key: "sms-1",
      recipient_phone: "+90 (555) 123 45 67",
      message: "Merhaba, kargonuz şubede. İyi günler.",
      ...payload,
    },
  };
}

function transportReturning(
  captured: NetgsmTransportRequest[],
  response: NetgsmTransportResponse,
): NetgsmFetchTransport {
  return async (request) => {
    captured.push(request);
    return response;
  };
}

function transportThrowing(captured: NetgsmTransportRequest[], error: Error & { code?: string }): NetgsmFetchTransport {
  return async (request) => {
    captured.push(request);
    throw error;
  };
}

function expectNoCredentialLeak(attempt: ProviderAttempt | undefined): void {
  const serialized = JSON.stringify(attempt);
  expect(serialized).not.toContain(usercode);
  expect(serialized).not.toContain(password);
}

describe("NetGSM live adapter", () => {
  it("sends sms.send with the legacy NetGSM XML request material", async () => {
    const captured: NetgsmTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      netgsmTransport: transportReturning(captured, { status: 200, headers: {}, body: "00 987654321" }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(smsEnvelope({
      recipient_phones: ["+90 555 123 45 67", "0 532 000 00 00"],
      msgheader: "GKULUCKA",
      filter: 0,
      baslangicTarih: "010120261200",
      bitisTarih: "020120261200",
      dil: "TR",
    })))).resolves.toMatchObject({
      status: "accepted_live",
      live_call_performed: true,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      method: "POST",
      url: `${origin}/sms/send/xml/`,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      netgsm_endpoint: "sms.send.xml",
    });
    expect(captured[0]?.body).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<mainbody>
  <header>
    <company dil="TR">Netgsm</company>
    <usercode>${usercode}</usercode>
    <password>${password}</password>
    <type>1:n</type>
    <msgheader>GKULUCKA</msgheader>
    
    <startdate>010120261200</startdate>
    <stopdate>020120261200</stopdate>
  </header>
  <body>
    <msg><![CDATA[Merhaba, kargonuz şubede. İyi günler.]]></msg>
    <no>905551234567</no>
    <no>05320000000</no>
  </body>
</mainbody>`);
    expect(persisted[0]).toMatchObject({
      status: "success",
      status_code: 200,
      retry_decision: "none",
      response_metadata: { netgsm_code: "00", netgsm_job_id: "987654321" },
    });
    expectNoCredentialLeak(persisted[0]);
  });

  it.each(["00", "01", "02"])("accepts NetGSM success code %s with a job id", async (code) => {
    const captured: NetgsmTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      netgsmTransport: transportReturning(captured, { status: 200, headers: {}, body: `${code} 12345` }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(smsEnvelope()))).resolves.toMatchObject({
      status: "accepted_live",
    });

    expect(persisted[0]).toMatchObject({
      status: "success",
      response_metadata: { netgsm_code: code, netgsm_job_id: "12345" },
    });
    expectNoCredentialLeak(persisted[0]);
  });

  it.each(["20", "30", "40", "50", "51", "70", "80", "85"])(
    "dead-letters NetGSM terminal error code %s",
    async (code) => {
      const persisted: ProviderAttempt[] = [];
      const registry = createWorkerProcessorRegistry({
        providerAccountConfigRepository: accountConfig(),
        providerAttemptRepository: attemptRepository(persisted),
        netgsmTransport: transportReturning([], { status: 200, headers: {}, body: code }),
      });

      await expect(registry.dispatch("provider-delivery", deliveryJob(smsEnvelope()))).rejects.toBeInstanceOf(NetgsmLiveTransportError);

      expect(persisted[0]).toMatchObject({
        status: "terminal_failure",
        status_code: 200,
        retry_decision: "dead_letter",
        error: { code: "netgsm_error_code" },
        response_metadata: { netgsm_code: code },
      });
      expectNoCredentialLeak(persisted[0]);
    },
  );

  it.each([
    { status: 429, expected: "retryable_failure", decision: "retry" },
    { status: 503, expected: "retryable_failure", decision: "retry" },
  ])("persists retryable failure attempts for HTTP $status", async ({ status, expected, decision }) => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      netgsmTransport: transportReturning([], { status, headers: {}, body: "temporarily unavailable" }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(smsEnvelope()))).rejects.toBeInstanceOf(NetgsmLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: expected,
      status_code: status,
      retry_decision: decision,
      error: { code: "provider_http_error" },
    });
    expectNoCredentialLeak(persisted[0]);
  });

  it("does not retry non-idempotent sms.send without an idempotency key", async () => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      netgsmTransport: transportReturning([], { status: 503, headers: {}, body: "unavailable" }),
    });

    await expect(
      registry.dispatch("provider-delivery", deliveryJob(smsEnvelope({ idempotency_key: undefined }))),
    ).rejects.toBeInstanceOf(NetgsmLiveTransportError);

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
      error: Object.assign(new Error("NetGSM request timed out after 10ms"), { code: "timeout" }),
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
      netgsmTransport: transportThrowing([], error),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(smsEnvelope()))).rejects.toBeInstanceOf(NetgsmLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "retryable_failure",
      retry_decision: "retry",
      error: { code: expected },
    });
    expectNoCredentialLeak(persisted[0]);
  });

  it("dead-letters malformed responses without leaking credentials", async () => {
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      netgsmTransport: transportReturning([], { status: 200, headers: {}, body: "" }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(smsEnvelope()))).rejects.toBeInstanceOf(NetgsmLiveTransportError);

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
          provider: "netgsm",
          account_public_id: "iac_netgsm_live",
          live_mode: false,
          tokens: { sms_usercode: usercode, sms_password: password },
          settings: { "providers.netgsm.live_mode": true, live_mode: false },
        }),
      },
      netgsmTransport: async () => {
        throw new Error("transport should not be called");
      },
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(smsEnvelope()))).resolves.toMatchObject({
      status: "accepted_fixture",
      live_call_performed: false,
    });
  });
});
