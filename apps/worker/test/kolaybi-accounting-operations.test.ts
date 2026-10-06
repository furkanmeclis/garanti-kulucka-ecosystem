import { describe, expect, it } from "vitest";
import type { ProviderOperation, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { handleProviderDeliveryJobWithTransport } from "../src/providers/handlers.js";
import {
  sendKolaybiLiveRequest,
  type KolaybiFetchTransport,
  type KolaybiTransportRequest,
  type KolaybiTransportResponse,
} from "../src/providers/kolaybi.js";

// Accounting module (fatura / cari / tahsilat) KolayBi operations: contact.update and invoice.payment.create.
const now = "2026-10-06T07:00:00.000Z";
const origin = "https://kolaybi-accounting.test";

function envelope(operation: ProviderOperation, payload: Record<string, unknown>): ProviderRequestEnvelope {
  return {
    request_id: `req_accounting_${operation}`,
    provider: "kolaybi",
    operation,
    direction: "outbound",
    channel: "accounting",
    account_public_id: "iac_kolaybi_live",
    occurred_at: now,
    payload,
  };
}

function job(env: ProviderRequestEnvelope) {
  return {
    job_id: `job_${env.request_id}`,
    queue: "provider-delivery" as const,
    name: `kolaybi.${env.operation}`,
    requested_at: now,
    payload: { envelope: env },
  };
}

function adapterInput(operation: ProviderOperation, payload: Record<string, unknown>, transport: KolaybiFetchTransport) {
  const env = envelope(operation, payload);
  return {
    envelope: env,
    job: job(env),
    accountConfig: {
      provider: "kolaybi" as const,
      account_public_id: "iac_kolaybi_live",
      live_mode: true,
      tokens: {},
      settings: { "providers.kolaybi.live_mode": true, api_url: `${origin}/kolaybi/v1`, api_key: "accounting-secret", channel: "GARANTI" },
    },
    policy: { contract_mode: "live" as const, live_call_permitted: true as const, reason: "account_live_mode_enabled" as const, timeout_ms: 5_000, max_attempts: 3 },
    attemptNumber: 1,
    maxAttempts: 3,
    transport,
    now: new Date(now),
  };
}

function json(status: number, body: unknown): KolaybiTransportResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const token = json(200, { data: "accounting-token-secret" });
const call = (captured: KolaybiTransportRequest[]) => captured.find((request) => request.kolaybi_endpoint !== "access_token");

/** The adapter caches its bearer token per account, so the token call is answered only when asked for. */
function sequence(captured: KolaybiTransportRequest[], responses: KolaybiTransportResponse[]): KolaybiFetchTransport {
  return async (request) => {
    captured.push(request);
    if (request.kolaybi_endpoint === "access_token") return token;
    const response = responses.shift();
    if (!response) throw new Error("No mock KolayBi response queued");
    return response;
  };
}


describe("KolayBi accounting operations", () => {
  it("updates a cari with PUT /associates/{id} and a JSON body", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const result = await sendKolaybiLiveRequest(
      adapterInput(
        "contact.update",
        { contact_id: "1001", musteri_ad: "Ayşe Yılmaz", phone: "05551112233", address: "Atatürk Cd. 1", city: "Konya", district: "Selçuklu", tax_office: "Meram" },
        sequence(captured, [json(200, { success: true, data: { id: 1001, address: [{ id: 77 }] } })]),
      ),
    );
    expect(call(captured)).toMatchObject({ method: "PUT", url: `${origin}/kolaybi/v1/associates/1001`, kolaybi_endpoint: "associates.update" });
    expect(call(captured)?.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call(captured)?.body ?? "{}")).toMatchObject({
      is_corporate: false,
      name: "Ayşe",
      surname: "Yılmaz",
      phone: "+905551112233",
      tax_office: "Meram",
      addresses: [{ address: "Atatürk Cd. 1", city: "Konya", district: "Selçuklu", address_type: "invoice" }],
    });
    expect(result.response_payload).toEqual({ success: true, contact_id: 1001, address_id: 77 });
    expect(JSON.stringify(result.attempt)).not.toContain("accounting-secret");
    expect(JSON.stringify(result.attempt)).not.toContain("accounting-token-secret");
  });

  it("records a tahsilat with POST /invoices/proceed", async () => {
    const captured: KolaybiTransportRequest[] = [];
    const result = await sendKolaybiLiveRequest(
      adapterInput(
        "invoice.payment.create",
        { document_id: "5001", vault_id: "3", amount: "250.00", idempotency_key: "accounting:payment:pay_1" },
        sequence(captured, [json(200, { success: true, data: { id: 9001 } })]),
      ),
    );
    expect(call(captured)).toMatchObject({ method: "POST", url: `${origin}/kolaybi/v1/invoices/proceed`, kolaybi_endpoint: "invoices.proceed" });
    expect(new URLSearchParams(call(captured)?.body ?? "").toString()).toBe("document_id=5001&vault_id=3&amount=250.00");
    expect(result.response_payload).toMatchObject({ success: true, document_id: "5001", payment_id: 9001 });
  });

  it("rejects a tahsilat without a vault id before calling KolayBi", async () => {
    const captured: KolaybiTransportRequest[] = [];
    await expect(
      sendKolaybiLiveRequest(adapterInput("invoice.payment.create", { document_id: "5001" }, sequence(captured, []))),
    ).rejects.toThrow(/vault_id/);
    expect(call(captured)).toBeUndefined();
  });

  it("stays a dry-run fixture while providers.kolaybi.live_mode is off", async () => {
    const env = envelope("contact.update", { contact_id: "1001", musteri_ad: "Ayşe Yılmaz" });
    const result = await handleProviderDeliveryJobWithTransport(job(env), {
      accountConfigRepository: {
        getAccountConfig: async () => ({ provider: "kolaybi", account_public_id: "iac_kolaybi_live", live_mode: true, tokens: {}, settings: { api_key: "accounting-secret" } }),
      },
      kolaybiTransport: async () => {
        throw new Error("live KolayBi must not be called");
      },
    });
    expect(result.live_call_performed).toBe(false);
    expect(result.attempt.response_metadata).toMatchObject({ live_call_performed: false });
  });
});
