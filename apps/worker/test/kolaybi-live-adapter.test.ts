import { describe, expect, it } from "vitest";
import type { ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import {
  KolaybiLiveTransportError,
  type KolaybiFetchTransport,
  type KolaybiTransportRequest,
  type KolaybiTransportResponse,
} from "../src/providers/kolaybi.js";

const now = "2026-01-01T00:00:00.000Z";
const origin = "https://kolaybi.test";

function accountConfig(overrides: Record<string, unknown> = {}): ProviderAccountConfigRepository {
  return {
    getAccountConfig: async () => ({
      provider: "kolaybi",
      account_public_id: "iac_kolaybi_live",
      live_mode: true,
      tokens: {},
      settings: {
        "providers.kolaybi.live_mode": true,
        live_mode: true,
        api_url: `${origin}/kolaybi/v1`,
        api_key: "kolaybi-api-secret",
        channel: "GARANTI",
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
    id: "bull_job_kolaybi",
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

function invoiceEnvelope(payload: Record<string, unknown> = {}): ProviderRequestEnvelope {
  return {
    request_id: "req_kolaybi_invoice",
    provider: "kolaybi",
    operation: "invoice.create",
    direction: "outbound",
    channel: "accounting",
    account_public_id: "iac_kolaybi_live",
    occurred_at: now,
    payload: {
      idempotency_key: "invoice-create-1",
      order_public_id: "ord_1",
      contact_id: "cnt_1",
      address_id: "adr_1",
      order_date: "2026-01-01 10:00:00",
      currency: "TRY",
      siparis_no: "ORD-1",
      items: [
        {
          product_id: "prd_1",
          quantity: 2,
          unit_price: "120.50",
          vat_rate: 20,
          description: "Kulucka Makinesi",
        },
      ],
      ...payload,
    },
  };
}

function transportReturningSequence(
  captured: KolaybiTransportRequest[],
  responses: KolaybiTransportResponse[],
): KolaybiFetchTransport {
  return async (request) => {
    captured.push(request);
    const response = responses.shift();
    if (!response) throw new Error("No mock KolayBi response queued");
    return response;
  };
}

function transportThrowing(captured: KolaybiTransportRequest[], error: Error & { code?: string }): KolaybiFetchTransport {
  return async (request) => {
    captured.push(request);
    throw error;
  };
}

const tokenResponse = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "access-token-secret" }) };
const invoiceResponse = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ success: true, data: { id: 42, document_id: 42 } }),
};

describe("KolayBi live REST adapter", () => {
  it("sends invoice.create with legacy token and form-urlencoded invoice request material", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      kolaybiTransport: transportReturningSequence(captured, [tokenResponse, invoiceResponse]),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(invoiceEnvelope()))).resolves.toMatchObject({
      status: "accepted_live",
      live_call_performed: true,
    });

    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      method: "POST",
      url: `${origin}/kolaybi/v1/access_token`,
      headers: { Channel: "GARANTI", "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: "kolaybi-api-secret" }),
      kolaybi_endpoint: "access_token",
    });
    expect(captured[1]).toMatchObject({
      method: "POST",
      url: `${origin}/kolaybi/v1/invoices`,
      headers: {
        Authorization: "Bearer access-token-secret",
        Channel: "GARANTI",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      kolaybi_endpoint: "invoices",
    });
    expect(captured[1]?.body).toBe(
      "contact_id=cnt_1&address_id=adr_1&order_date=2026-01-01+10%3A00%3A00&currency=try&description=Siparis%3A+ORD-1&items%5B0%5D%5Bproduct_id%5D=prd_1&items%5B0%5D%5Bquantity%5D=2&items%5B0%5D%5Bunit_price%5D=120.50&items%5B0%5D%5Bvat_rate%5D=20&items%5B0%5D%5Bdescription%5D=Kulucka+Makinesi",
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ status: "success", status_code: 200, retry_decision: "none" });
    expect(JSON.stringify(persisted[0])).not.toContain("kolaybi-api-secret");
    expect(JSON.stringify(persisted[0])).not.toContain("access-token-secret");
  });

  it("refreshes the token once after a 401 invoice response", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig({ api_key: "refresh-secret" }),
      providerAttemptRepository: attemptRepository(persisted),
      kolaybiTransport: transportReturningSequence(captured, [
        { status: 200, headers: {}, body: JSON.stringify({ data: "stale-token-secret" }) },
        { status: 401, headers: {}, body: JSON.stringify({ error: "expired" }) },
        { status: 200, headers: {}, body: JSON.stringify({ data: "fresh-token-secret" }) },
        invoiceResponse,
      ]),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(invoiceEnvelope({ idempotency_key: "refresh-1" })))).resolves.toMatchObject({
      status: "accepted_live",
    });

    expect(captured.map((request) => request.kolaybi_endpoint)).toEqual([
      "access_token",
      "invoices",
      "access_token",
      "invoices",
    ]);
    expect(captured[1]?.headers.Authorization).toBe("Bearer stale-token-secret");
    expect(captured[3]?.headers.Authorization).toBe("Bearer fresh-token-secret");
    expect(JSON.stringify(persisted[0])).not.toContain("fresh-token-secret");
    expect(JSON.stringify(persisted[0])).not.toContain("refresh-secret");
  });

  it.each([
    { status: 429, expected: "retryable_failure", decision: "retry" },
    { status: 503, expected: "retryable_failure", decision: "retry" },
  ])("persists retryable failure attempts for HTTP $status", async ({ status, expected, decision }) => {
    const captured: KolaybiTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig({ api_key: `http-${status}-secret` }),
      providerAttemptRepository: attemptRepository(persisted),
      kolaybiTransport: transportReturningSequence(captured, [
        tokenResponse,
        { status, headers: { "content-type": "text/plain" }, body: "retry later" },
      ]),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(invoiceEnvelope()))).rejects.toBeInstanceOf(KolaybiLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: expected,
      status_code: status,
      retry_decision: decision,
      error: { code: "provider_http_error" },
    });
    expect(JSON.stringify(persisted[0])).not.toContain(`http-${status}-secret`);
  });

  it("does not retry non-idempotent invoice.create without an idempotency key", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig({ api_key: "no-idempotency-secret" }),
      providerAttemptRepository: attemptRepository(persisted),
      kolaybiTransport: transportReturningSequence(captured, [
        tokenResponse,
        { status: 503, headers: {}, body: "unavailable" },
      ]),
    });

    await expect(
      registry.dispatch("provider-delivery", deliveryJob(invoiceEnvelope({ idempotency_key: undefined }))),
    ).rejects.toBeInstanceOf(KolaybiLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      request_metadata: { retry: { reason: "missing_idempotency_key" } },
    });
  });

  it.each([
    {
      name: "timeout",
      error: Object.assign(new Error("KolayBi request timed out after 10ms"), { code: "timeout" }),
      expected: "timeout",
    },
    {
      name: "connection error",
      error: Object.assign(new Error("connect ECONNREFUSED"), { code: "network_error" }),
      expected: "network_error",
    },
  ])("persists retryable failure attempts for $name", async ({ error, expected }) => {
    const captured: KolaybiTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig({ api_key: `${expected}-secret` }),
      providerAttemptRepository: attemptRepository(persisted),
      kolaybiTransport: transportThrowing(captured, error),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(invoiceEnvelope()))).rejects.toBeInstanceOf(KolaybiLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "retryable_failure",
      retry_decision: "retry",
      error: { code: expected },
    });
    expect(JSON.stringify(persisted[0])).not.toContain(`${expected}-secret`);
  });

  it("dead-letters malformed JSON responses without leaking credentials", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig({ api_key: "malformed-secret" }),
      providerAttemptRepository: attemptRepository(persisted),
      kolaybiTransport: transportReturningSequence(captured, [
        tokenResponse,
        { status: 200, headers: {}, body: "not-json" },
      ]),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(invoiceEnvelope()))).rejects.toBeInstanceOf(KolaybiLiveTransportError);

    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      error: { code: "malformed_response" },
    });
    expect(JSON.stringify(persisted[0])).not.toContain("malformed-secret");
  });
});
