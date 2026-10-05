import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderOperation, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { KolaybiLiveTransportError, sendKolaybiLiveRequest } from "../src/providers/kolaybi.js";
import { sendNetgsmLiveRequest } from "../src/providers/netgsm.js";

const now = "2026-10-05T07:30:00.000Z";

interface ReceivedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void;

let server: Server | null = null;

async function startMock(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] } | null> {
  const received: ReceivedRequest[] = [];
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const entry = { method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") };
      received.push(entry);
      handler(entry, response);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const current = server;
      const onError = (error: Error) => reject(error);
      current?.once("error", onError);
      current?.listen(0, "127.0.0.1", () => {
        current.off("error", onError);
        resolve();
      });
    });
  } catch (error) {
    const current = server;
    server = null;
    current?.closeAllConnections();
    current?.close();
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") return null;
    throw error;
  }
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, received };
}

afterEach(async () => {
  const current = server;
  server = null;
  if (current) {
    current.closeAllConnections();
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
});

const policy = {
  contract_mode: "live" as const,
  live_call_permitted: true as const,
  reason: "account_live_mode_enabled" as const,
  timeout_ms: 2_000,
  max_attempts: 3,
};

function job(envelope: ProviderRequestEnvelope) {
  return {
    job_id: `job_${envelope.request_id}`,
    queue: "provider-delivery" as const,
    name: `${envelope.provider}.${envelope.operation}`,
    requested_at: now,
    payload: { envelope },
  };
}

function kolaybiInput(origin: string, operation: ProviderOperation, payload: Record<string, unknown>, apiKey: string) {
  const envelope: ProviderRequestEnvelope = {
    request_id: `req_http_${operation}`,
    provider: "kolaybi",
    operation,
    direction: "outbound",
    channel: "accounting",
    account_public_id: "iac_kolaybi_live",
    occurred_at: now,
    payload,
  };
  return {
    envelope,
    job: job(envelope),
    accountConfig: {
      provider: "kolaybi" as const,
      account_public_id: "iac_kolaybi_live",
      live_mode: true,
      tokens: {},
      settings: { "providers.kolaybi.live_mode": true, api_url: `${origin}/kolaybi/v1`, api_key: apiKey, channel: "GARANTI" },
    },
    policy,
    attemptNumber: 1,
    maxAttempts: 3,
  };
}

function netgsmInput(origin: string, operation: ProviderOperation, payload: Record<string, unknown>) {
  const envelope: ProviderRequestEnvelope = {
    request_id: `req_http_${operation}`,
    provider: "netgsm",
    operation,
    direction: "outbound",
    channel: "voice",
    account_public_id: "iac_netgsm_live",
    occurred_at: now,
    payload,
  };
  return {
    envelope,
    job: job(envelope),
    accountConfig: {
      provider: "netgsm" as const,
      account_public_id: "iac_netgsm_live",
      live_mode: true,
      tokens: { teyit_voice_usercode: "3229110532", teyit_voice_password: "http-voice-secret" },
      settings: { "providers.netgsm.live_mode": true, api_url: origin },
    },
    policy,
    attemptNumber: 1,
    maxAttempts: 3,
    now: new Date(now),
  };
}

function kolaybiHandler(routes: Record<string, { status: number; body: unknown }>): Handler {
  return (request, response) => {
    if (request.url === "/kolaybi/v1/access_token") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: "http-ops-token-secret" }));
      return;
    }
    const route = routes[`${request.method} ${request.url}`];
    response.writeHead(route?.status ?? 404, { "content-type": "application/json" });
    response.end(JSON.stringify(route?.body ?? { success: false }));
  };
}

describe("legacy follow-up operations over a local HTTP server", () => {
  it("sends KolayBi e-document create as form-urlencoded over real HTTP", async () => {
    const mock = await startMock(kolaybiHandler({
      "POST /kolaybi/v1/invoices/e-document/create": { status: 200, body: { success: true, data: { uuid: "http-uuid" } } },
    }));
    if (!mock) return;

    const result = await sendKolaybiLiveRequest(
      kolaybiInput(mock.origin, "invoice.e_document.create", { document_id: "91", idempotency_key: "edoc-http" }, "http-edoc-secret"),
    );

    expect(mock.received[1]).toMatchObject({ method: "POST", url: "/kolaybi/v1/invoices/e-document/create", body: "document_id=91" });
    expect(mock.received[1]?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(mock.received[1]?.headers.authorization).toBe("Bearer http-ops-token-secret");
    expect(mock.received[1]?.headers.channel).toBe("GARANTI");
    expect(result.response_payload).toMatchObject({ success: true, data: { uuid: "http-uuid" } });
    expect(JSON.stringify(result.attempt)).not.toContain("http-edoc-secret");
    expect(JSON.stringify(result.attempt)).not.toContain("http-ops-token-secret");
  });

  it("sends KolayBi e-document cancel and invoice detail GET without a body", async () => {
    const mock = await startMock(kolaybiHandler({
      "POST /kolaybi/v1/invoices/e-document/cancel": { status: 200, body: { success: true } },
      "GET /kolaybi/v1/invoices/91": { status: 200, body: { data: { uuid: "u-91" } } },
    }));
    if (!mock) return;

    await sendKolaybiLiveRequest(
      kolaybiInput(mock.origin, "invoice.e_document.cancel", { document_id: "91", cancel_date: "2026-10-05 10:00:00", idempotency_key: "c" }, "http-cancel-secret"),
    );
    const detail = await sendKolaybiLiveRequest(kolaybiInput(mock.origin, "invoice.get", { invoice_id: "91" }, "http-cancel-secret"));

    expect(mock.received.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST /kolaybi/v1/access_token",
      "POST /kolaybi/v1/invoices/e-document/cancel",
      "GET /kolaybi/v1/invoices/91",
    ]);
    expect(mock.received[1]?.body).toBe("document_id=91&cancel_date=2026-10-05+10%3A00%3A00");
    expect(mock.received[2]?.body).toBe("");
    expect(detail.response_payload).toMatchObject({ data: { invoice_id: 91, e_document_status: "sent", e_document_uuid: "u-91" } });
  });

  it("creates a contact, looks it up and lists products over real HTTP", async () => {
    const mock = await startMock(kolaybiHandler({
      "POST /kolaybi/v1/associates": { status: 200, body: { success: true, data: { id: 5, address: [{ id: 6 }] } } },
      "GET /kolaybi/v1/associates?identity_no=15551234567&per_page=50": {
        status: 200,
        body: { data: [{ id: 5, identity_no: "15551234567", full_name: "Ali Veli" }] },
      },
      "GET /kolaybi/v1/products?per_page=200&page=1": { status: 200, body: { data: [{ id: 1, name: "Kulucka" }] } },
    }));
    if (!mock) return;

    const created = await sendKolaybiLiveRequest(
      kolaybiInput(mock.origin, "contact.create", { musteri_ad: "Ali Veli", phone: "05551234567", idempotency_key: "cc" }, "http-contact-secret"),
    );
    const found = await sendKolaybiLiveRequest(kolaybiInput(mock.origin, "contact.find", { phone: "05551234567" }, "http-contact-secret"));
    const products = await sendKolaybiLiveRequest(kolaybiInput(mock.origin, "product.list", {}, "http-contact-secret"));

    expect(mock.received[1]?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(mock.received[1]?.body).get("identity_no")).toBe("15551234567");
    expect(created.response_payload).toEqual({ success: true, contact_id: 5, address_id: 6 });
    expect(found.response_payload).toMatchObject({ found: true, matched_by: "identity_no", contact: { id: 5 } });
    expect(mock.received[3]?.headers["x-api-key"]).toBe("http-contact-secret");
    expect(mock.received[3]?.headers["x-channel-code"]).toBe("GARANTI");
    expect(products.response_payload).toMatchObject({ toplam: 1, urunler: [{ id: 1, name: "Kulucka" }] });
    expect(JSON.stringify(products.attempt)).not.toContain("http-contact-secret");
  });

  it("records a terminal 412 duplicate contact attempt", async () => {
    const mock = await startMock(kolaybiHandler({
      "POST /kolaybi/v1/associates": { status: 412, body: { success: false, message: "Kayit zaten mevcut" } },
    }));
    if (!mock) return;

    const error = await sendKolaybiLiveRequest(
      kolaybiInput(mock.origin, "contact.create", { musteri_ad: "Ali Veli", idempotency_key: "dup" }, "http-dup-secret"),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KolaybiLiveTransportError);
    expect((error as KolaybiLiveTransportError).attempt).toMatchObject({ status: "terminal_failure", status_code: 412 });
  });

  it("starts and polls the NetGSM confirmation call over real HTTP", async () => {
    const mock = await startMock((request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(request.url?.startsWith("/voicesms/send") ? "00 445566" : "905551234567|1|Turkcell|8|");
    });
    if (!mock) return;

    const started = await sendNetgsmLiveRequest(
      netgsmInput(mock.origin, "call.confirmation.create", { telefon: "05551234567", idempotency_key: "teyit-http" }),
    );
    const status = await sendNetgsmLiveRequest(netgsmInput(mock.origin, "call.confirmation.status", { bulk_id: "445566" }));

    expect(mock.received[0]).toMatchObject({ method: "POST", url: "/voicesms/send" });
    expect(mock.received[0]?.headers["content-type"]).toBe("text/xml; charset=utf-8");
    expect(mock.received[0]?.body).toContain("<no>05551234567</no>");
    expect(mock.received[0]?.body).toContain("<password>http-voice-secret</password>");
    expect(mock.received[1]?.method).toBe("GET");
    expect(mock.received[1]?.url).toBe("/voicesms/report?usercode=3229110532&password=http-voice-secret&type=1&bulkid=445566");
    expect(started.response_payload).toMatchObject({ success: true, bulkId: "445566" });
    expect(status.response_payload).toMatchObject({ call_status: "cevaplandi", confirmation_outcome: "teyit_edildi" });
    expect(JSON.stringify(started.attempt)).not.toContain("http-voice-secret");
    expect(JSON.stringify(status.attempt)).not.toContain("http-voice-secret");
  });
});
