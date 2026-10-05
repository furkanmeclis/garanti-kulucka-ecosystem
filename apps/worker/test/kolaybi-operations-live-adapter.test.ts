import { describe, expect, it } from "vitest";
import type { ProviderAttempt, ProviderOperation, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import {
  KolaybiLiveTransportError,
  normalizeKolaybiPhone,
  sendKolaybiLiveRequest,
  type KolaybiFetchTransport,
  type KolaybiTransportRequest,
  type KolaybiTransportResponse,
} from "../src/providers/kolaybi.js";

const now = "2026-10-05T07:00:00.000Z";
const origin = "https://kolaybi-ops.test";

function settings(apiKey: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "providers.kolaybi.live_mode": true,
    live_mode: true,
    api_url: `${origin}/kolaybi/v1`,
    api_key: apiKey,
    channel: "GARANTI",
    ...overrides,
  };
}

function envelope(operation: ProviderOperation, payload: Record<string, unknown>): ProviderRequestEnvelope {
  return {
    request_id: `req_kolaybi_${operation}`,
    provider: "kolaybi",
    operation,
    direction: "outbound",
    channel: "accounting",
    account_public_id: "iac_kolaybi_live",
    occurred_at: now,
    payload,
  };
}

function adapterInput(
  operation: ProviderOperation,
  payload: Record<string, unknown>,
  apiKey: string,
  transport: KolaybiFetchTransport,
) {
  const env = envelope(operation, payload);
  return {
    envelope: env,
    job: {
      job_id: `job_${env.request_id}`,
      queue: "provider-delivery" as const,
      name: `kolaybi.${operation}`,
      requested_at: now,
      payload: { envelope: env },
    },
    accountConfig: {
      provider: "kolaybi" as const,
      account_public_id: "iac_kolaybi_live",
      live_mode: true,
      tokens: {},
      settings: settings(apiKey),
    },
    policy: {
      contract_mode: "live" as const,
      live_call_permitted: true as const,
      reason: "account_live_mode_enabled" as const,
      timeout_ms: 5_000,
      max_attempts: 3,
    },
    attemptNumber: 1,
    maxAttempts: 3,
    transport,
    now: new Date(now),
  };
}

function sequence(captured: KolaybiTransportRequest[], responses: KolaybiTransportResponse[]): KolaybiFetchTransport {
  return async (request) => {
    captured.push(request);
    const response = responses.shift();
    if (!response) throw new Error("No mock KolayBi response queued");
    return response;
  };
}

function json(status: number, body: unknown): KolaybiTransportResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const token = json(200, { data: "ops-token-secret" });

function expectNoSecrets(attempt: ProviderAttempt, apiKey: string): void {
  const serialized = JSON.stringify(attempt);
  expect(serialized).not.toContain(apiKey);
  expect(serialized).not.toContain("ops-token-secret");
}

describe("KolayBi legacy follow-up operations (transport mock)", () => {
  it("creates an e-document with the legacy form-urlencoded document_id body", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const result = await sendKolaybiLiveRequest(
      adapterInput("invoice.e_document.create", { document_id: 42, idempotency_key: "edoc-42" }, "edoc-create-secret", sequence(captured, [
        token,
        json(200, { success: true, data: { uuid: "uuid-42" } }),
      ])),
    );

    expect(captured[1]).toMatchObject({
      method: "POST",
      url: `${origin}/kolaybi/v1/invoices/e-document/create`,
      headers: {
        Authorization: "Bearer ops-token-secret",
        Channel: "GARANTI",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "document_id=42",
      kolaybi_endpoint: "invoices.e_document.create",
    });
    expect(result.response_payload).toMatchObject({ success: true, document_id: "42", data: { uuid: "uuid-42" } });
    expect(result.attempt).toMatchObject({ status: "success", operation: "invoice.e_document.create", idempotency_key: "edoc-42" });
    expectNoSecrets(result.attempt, "edoc-create-secret");
  });

  it("dead-letters a 524 e-document timeout without idempotency key and hints to check status", async () => {
    const error = await sendKolaybiLiveRequest(
      adapterInput("invoice.e_document.create", { document_id: "43" }, "edoc-timeout-secret", sequence([], [
        token,
        { status: 524, headers: {}, body: "timeout" },
      ])),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KolaybiLiveTransportError);
    const attempt = (error as KolaybiLiveTransportError).attempt;
    expect(attempt).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      status_code: 524,
      error: { code: "provider_http_error" },
      request_metadata: { retry: { reason: "missing_idempotency_key" } },
    });
    expect(attempt.error?.message).toContain("invoice.get");
    expectNoSecrets(attempt, "edoc-timeout-secret");
  });

  it("retries a 503 e-document create only when an idempotency key is present", async () => {
    const error = await sendKolaybiLiveRequest(
      adapterInput("invoice.e_document.create", { document_id: "44", idempotency_key: "edoc-44" }, "edoc-retry-secret", sequence([], [
        token,
        { status: 503, headers: {}, body: "unavailable" },
      ])),
    ).catch((caught: unknown) => caught);

    expect((error as KolaybiLiveTransportError).attempt).toMatchObject({ status: "retryable_failure", retry_decision: "retry" });
  });

  it("cancels an e-document with document_id, cancel_date and cancel_time", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const result = await sendKolaybiLiveRequest(
      adapterInput(
        "invoice.e_document.cancel",
        { document_id: "42", cancel_date: "2026-10-05 10:00:00", cancel_time: "10:00:00", idempotency_key: "cancel-42" },
        "edoc-cancel-secret",
        sequence(captured, [token, json(200, { success: true, data: { cancelled: true } })]),
      ),
    );

    expect(captured[1]).toMatchObject({
      method: "POST",
      url: `${origin}/kolaybi/v1/invoices/e-document/cancel`,
      body: "document_id=42&cancel_date=2026-10-05+10%3A00%3A00&cancel_time=10%3A00%3A00",
      kolaybi_endpoint: "invoices.e_document.cancel",
    });
    expect(result.response_payload).toMatchObject({ success: true, data: { cancelled: true } });
  });

  it("requires cancel_date like the legacy endpoint", async () => {
    await expect(
      sendKolaybiLiveRequest(adapterInput("invoice.e_document.cancel", { document_id: "42" }, "edoc-cancel-missing", sequence([], [token]))),
    ).rejects.toThrow("cancel_date");
  });

  it("dead-letters success:false responses as provider_rejected", async () => {
    const error = await sendKolaybiLiveRequest(
      adapterInput("invoice.e_document.cancel", { document_id: "42", cancel_date: "2026-10-05 10:00:00", idempotency_key: "c" }, "edoc-reject-secret", sequence([], [
        token,
        json(200, { success: false, message: "Belge iptal edilemez" }),
      ])),
    ).catch((caught: unknown) => caught);

    expect((error as KolaybiLiveTransportError).attempt).toMatchObject({
      status: "terminal_failure",
      error: { code: "provider_rejected", message: "Belge iptal edilemez" },
    });
  });

  it("reads invoice detail via GET /invoices/{id} and maps the uuid like legacy durum", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const sent = await sendKolaybiLiveRequest(
      adapterInput("invoice.get", { invoice_id: "42" }, "invoice-get-secret", sequence(captured, [token, json(200, { data: { uuid: "abc-uuid" } })])),
    );
    expect(captured[1]).toMatchObject({
      method: "GET",
      url: `${origin}/kolaybi/v1/invoices/42`,
      headers: { Authorization: "Bearer ops-token-secret", Channel: "GARANTI" },
      body: "",
      kolaybi_endpoint: "invoices.show",
    });
    expect(captured[1]?.headers["Content-Type"]).toBeUndefined();
    expect(sent.response_payload).toEqual({
      success: true,
      data: {
        invoice_id: 42,
        e_document_status: "sent",
        e_document_uuid: "abc-uuid",
        e_document_date: null,
        is_e_document: true,
        send_type: null,
      },
    });

    const ready = await sendKolaybiLiveRequest(
      adapterInput("invoice.get", { invoice_id: "43" }, "invoice-get-secret", sequence([], [json(200, { data: {} })])),
    );
    expect(ready.response_payload).toMatchObject({ data: { e_document_status: "ready", e_document_uuid: null, is_e_document: false } });
  });

  it("finds a contact by derived identity_no, then email, then a phone scan", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const result = await sendKolaybiLiveRequest(
      adapterInput("contact.find", { phone: "+90 (555) 123 45 67" }, "contact-find-secret", sequence(captured, [
        token,
        json(200, { data: [] }),
        json(200, { data: [{ id: 9, email: "other@x.test" }, { id: 10, email: "x@y.test" }] }),
        json(200, { data: [{ id: 11, full_name: "Ali Veli", phone: "0555 123 45 67", address: [{ id: 501 }] }] }),
      ])),
    );

    expect(captured.slice(1).map((request) => request.url)).toEqual([
      `${origin}/kolaybi/v1/associates?identity_no=15551234567&per_page=50`,
      `${origin}/kolaybi/v1/associates?email=5551234567%40garantikulucka.com&per_page=50`,
      `${origin}/kolaybi/v1/associates?per_page=250&page=1`,
    ]);
    expect(captured.slice(1).every((request) => request.method === "GET" && request.kolaybi_endpoint === "associates.list")).toBe(true);
    expect(result.response_payload).toMatchObject({
      success: true,
      found: true,
      matched_by: "phone",
      contact: { id: 11, full_name: "Ali Veli", address_id: 501 },
    });
  });

  it("returns found:false when no lookup matches", async () => {
    const result = await sendKolaybiLiveRequest(
      adapterInput("contact.find", { identity_no: "12345678901" }, "contact-miss-secret", sequence([], [token, json(200, { data: [] })])),
    );
    expect(result.response_payload).toEqual({ success: true, found: false, matched_by: null, contact: null });
  });

  it("creates a contact with the legacy /associates form body", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const result = await sendKolaybiLiveRequest(
      adapterInput(
        "contact.create",
        {
          musteri_ad: "Ayse  Yilmaz Kaya PTT Kargo",
          phone: "0555 123 45 67",
          address: "Ataturk Cad. 1",
          city: "Ankara",
          district: "Cankaya",
          idempotency_key: "contact-1",
        },
        "contact-create-secret",
        sequence(captured, [token, json(200, { success: true, data: { id: 77, addresses: [{ id: 88 }] } })]),
      ),
    );

    expect(captured[1]).toMatchObject({
      method: "POST",
      url: `${origin}/kolaybi/v1/associates`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      kolaybi_endpoint: "associates.create",
    });
    expect(Object.fromEntries(new URLSearchParams(captured[1]?.body))).toEqual({
      is_corporate: "false",
      associate_type: "customer",
      name: "Ayse",
      surname: "Yilmaz Kaya",
      identity_no: "15551234567",
      email: "5551234567@garantikulucka.com",
      tax_office: "Diğer",
      phone: "+905551234567",
      "addresses[address]": "Ataturk Cad. 1",
      "addresses[city]": "Ankara",
      "addresses[district]": "Cankaya",
      "addresses[address_type]": "invoice",
    });
    expect(result.response_payload).toEqual({ success: true, contact_id: 77, address_id: 88 });
    expectNoSecrets(result.attempt, "contact-create-secret");
  });

  it("dead-letters a 412 duplicate contact without retry", async () => {
    const error = await sendKolaybiLiveRequest(
      adapterInput("contact.create", { musteri_ad: "Ali Veli", idempotency_key: "dup" }, "contact-dup-secret", sequence([], [
        token,
        json(412, { success: false, message: "Kayit zaten mevcut" }),
      ])),
    ).catch((caught: unknown) => caught);
    expect((error as KolaybiLiveTransportError).attempt).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      status_code: 412,
      error: { code: "provider_http_error" },
    });
  });

  it("pages through products with the legacy urunler headers and redacts x-api-key", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const result = await sendKolaybiLiveRequest(
      adapterInput("product.list", { per_page: 2 }, "product-list-secret", sequence(captured, [
        token,
        json(200, { data: [{ id: 1, name: "Kulucka 48", sale_price: 1000, total_stock_quantity: 5, sale_unit_description: "Adet", category: "Makine" }, { id: 2, name: "Termostat" }] }),
        json(200, { data: [{ id: 3, name: "Viyol" }] }),
      ])),
    );

    expect(captured.slice(1).map((request) => request.url)).toEqual([
      `${origin}/kolaybi/v1/products?per_page=2&page=1`,
      `${origin}/kolaybi/v1/products?per_page=2&page=2`,
    ]);
    expect(captured[1]?.headers).toEqual({
      Authorization: "Bearer ops-token-secret",
      "x-api-key": "product-list-secret",
      "x-channel-code": "GARANTI",
    });
    expect(result.response_payload).toMatchObject({
      success: true,
      toplam: 3,
      urunler: [
        { id: 1, name: "Kulucka 48", sale_price: 1000, stock_quantity: 5, unit: "Adet", category: "Makine" },
        { id: 2, name: "Termostat" },
        { id: 3, name: "Viyol" },
      ],
    });
    expectNoSecrets(result.attempt, "product-list-secret");
  });

  it("refreshes the token once on 401 for follow-up operations", async () => {
    const captured: KolaybiTransportRequest[] = [];
    await sendKolaybiLiveRequest(
      adapterInput("invoice.get", { invoice_id: "5" }, "refresh-ops-secret", sequence(captured, [
        json(200, { data: "stale-ops-token" }),
        json(401, { error: "expired" }),
        json(200, { data: "fresh-ops-token" }),
        json(200, { data: { uuid: "u" } }),
      ])),
    );
    expect(captured.map((request) => request.kolaybi_endpoint)).toEqual(["access_token", "invoices.show", "access_token", "invoices.show"]);
    expect(captured[3]?.headers.Authorization).toBe("Bearer fresh-ops-token");
  });

  it("normalizes phones like legacy normalTelefon", () => {
    expect(normalizeKolaybiPhone("+90 538 701 48 68")).toBe("5387014868");
    expect(normalizeKolaybiPhone("00905387014868")).toBe("5387014868");
    expect(normalizeKolaybiPhone("(0538) 701 48 68")).toBe("5387014868");
  });
});

describe("KolayBi follow-up operation live gating", () => {
  function repository(overrides: Record<string, unknown>): ProviderAccountConfigRepository {
    return {
      getAccountConfig: async () => ({
        provider: "kolaybi",
        account_public_id: "iac_kolaybi_live",
        live_mode: true,
        tokens: {},
        settings: settings("gating-secret", overrides),
      }),
    };
  }

  function attempts(persisted: ProviderAttempt[]): ProviderAttemptRepository {
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

  function job(env: ProviderRequestEnvelope) {
    return {
      id: "bull_job_kolaybi_ops",
      name: `${env.provider}.${env.operation}`,
      attemptsMade: 0,
      opts: { attempts: 3 },
      data: {
        job_id: `job_${env.request_id}`,
        queue: "provider-delivery" as const,
        name: `${env.provider}.${env.operation}`,
        requested_at: now,
        payload: { envelope: env },
      },
    };
  }

  it("stays fixture-only without the explicit providers.kolaybi.live_mode opt-in", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: repository({ "providers.kolaybi.live_mode": false }),
      providerAttemptRepository: attempts([]),
      kolaybiTransport: sequence(captured, []),
    });

    await expect(
      registry.dispatch("provider-delivery", job(envelope("product.list", {}))),
    ).resolves.toMatchObject({ status: "accepted_fixture", live_call_performed: false });
    expect(captured).toHaveLength(0);
  });

  it("dispatches live when the account and provider opt-in are both enabled", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: repository({}),
      providerAttemptRepository: attempts(persisted),
      kolaybiTransport: sequence(captured, [token, json(200, { data: { uuid: "x" } })]),
    });

    await expect(
      registry.dispatch("provider-delivery", job(envelope("invoice.get", { invoice_id: "7" }))),
    ).resolves.toMatchObject({ status: "accepted_live", live_call_performed: true });
    expect(persisted[0]).toMatchObject({ operation: "invoice.get", status: "success" });
    expectNoSecrets(persisted[0] as ProviderAttempt, "gating-secret");
  });
});
