import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { KolaybiLiveTransportError, sendKolaybiLiveRequest } from "../src/providers/kolaybi.js";

const now = "2026-01-01T00:00:00.000Z";

interface ReceivedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void;

let server: Server | null = null;

async function startMockKolaybi(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] }> {
  const received: ReceivedRequest[] = [];
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const entry = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      received.push(entry);
      handler(entry, response);
    });
  });
  await new Promise<void>((resolve, reject) => {
    const current = server;
    const onError = (error: Error) => reject(error);
    current?.once("error", onError);
    current?.listen(0, "127.0.0.1", () => {
      current.off("error", onError);
      resolve();
    });
  }).catch((error: unknown) => {
    const current = server;
    server = null;
    current?.closeAllConnections();
    current?.close();
    throw error;
  });
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, received };
}

function socketBlocked(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "EPERM";
}

async function startMockKolaybiOrSkip(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] } | null> {
  try {
    return await startMockKolaybi(handler);
  } catch (error) {
    if (socketBlocked(error)) return null;
    throw error;
  }
}

afterEach(async () => {
  const current = server;
  server = null;
  if (current) {
    current.closeAllConnections();
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
});

function invoiceEnvelope(): ProviderRequestEnvelope {
  return {
    request_id: "req_kolaybi_http_invoice",
    provider: "kolaybi",
    operation: "invoice.create",
    direction: "outbound",
    channel: "accounting",
    account_public_id: "iac_kolaybi_live",
    occurred_at: now,
    payload: {
      idempotency_key: "invoice-http-1",
      contact_id: "cnt_http",
      currency: "TRY",
      total_amount: "120.00",
      order_public_id: "ord_http",
    },
  };
}

function input(origin: string, timeoutMs = 2_000) {
  const envelope = invoiceEnvelope();
  return {
    envelope,
    job: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: "kolaybi.invoice.create",
      requested_at: now,
      payload: { envelope },
    },
    accountConfig: {
      provider: "kolaybi" as const,
      account_public_id: "iac_kolaybi_live",
      live_mode: true,
      tokens: {},
      settings: {
        live_mode: true,
        api_url: `${origin}/kolaybi/v1`,
        api_key: "http-api-secret",
        channel: "GARANTI",
      },
    },
    policy: {
      contract_mode: "live" as const,
      live_call_permitted: true as const,
      reason: "account_live_mode_enabled" as const,
      timeout_ms: timeoutMs,
      max_attempts: 3,
    },
    attemptNumber: 1,
    maxAttempts: 3,
  };
}

describe("KolayBi live adapter over a local HTTP server", () => {
  it("sends the legacy token and invoice requests over real HTTP", async () => {
    const mock = await startMockKolaybiOrSkip((request, response) => {
      if (request.url === "/kolaybi/v1/access_token") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: "http-token-secret" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { id: 77, document_id: 77 } }));
    });
    if (!mock) return;

    const result = await sendKolaybiLiveRequest(input(mock.origin));

    expect(mock.received).toHaveLength(2);
    expect(mock.received[0]?.method).toBe("POST");
    expect(mock.received[0]?.url).toBe("/kolaybi/v1/access_token");
    expect(mock.received[0]?.headers.channel).toBe("GARANTI");
    expect(mock.received[0]?.body).toBe(JSON.stringify({ api_key: "http-api-secret" }));
    expect(mock.received[1]?.method).toBe("POST");
    expect(mock.received[1]?.url).toBe("/kolaybi/v1/invoices");
    expect(mock.received[1]?.headers.authorization).toBe("Bearer http-token-secret");
    expect(mock.received[1]?.headers.channel).toBe("GARANTI");
    expect(mock.received[1]?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(mock.received[1]?.body).toBe(
      "contact_id=cnt_http&currency=try&description=Siparis%3A+ord_http&items%5B0%5D%5Bquantity%5D=1&items%5B0%5D%5Bunit_price%5D=100&items%5B0%5D%5Bvat_rate%5D=20&items%5B0%5D%5Bdescription%5D=Urun",
    );
    expect(result.response_payload).toMatchObject({ success: true, data: { id: 77 } });
    expect(result.attempt.status).toBe("success");
    expect(JSON.stringify(result.attempt)).not.toContain("http-api-secret");
    expect(JSON.stringify(result.attempt)).not.toContain("http-token-secret");
  });

  it("records a retryable 503 attempt without leaking credentials", async () => {
    const mock = await startMockKolaybiOrSkip((request, response) => {
      if (request.url === "/kolaybi/v1/access_token") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: "http-token-secret" }));
        return;
      }
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("unavailable");
    });
    if (!mock) return;

    const error = await sendKolaybiLiveRequest(input(mock.origin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KolaybiLiveTransportError);
    const attempt = (error as KolaybiLiveTransportError).attempt;
    expect(attempt.status_code).toBe(503);
    expect(attempt.error?.code).toBe("provider_http_error");
    expect(JSON.stringify(attempt)).not.toContain("http-api-secret");
    expect(JSON.stringify(attempt)).not.toContain("http-token-secret");
  });

  it("aborts a hanging server with a timeout attempt", async () => {
    const mock = await startMockKolaybiOrSkip(() => {
      // never respond
    });
    if (!mock) return;

    const error = await sendKolaybiLiveRequest(input(mock.origin, 200)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KolaybiLiveTransportError);
    expect((error as KolaybiLiveTransportError).attempt.error?.code).toBe("timeout");
  });

  it("reports connection refused as a network error", async () => {
    const mock = await startMockKolaybiOrSkip(() => undefined);
    if (!mock) return;
    const closedOrigin = mock.origin;
    const current = server;
    server = null;
    current?.closeAllConnections();
    await new Promise<void>((resolve) => current?.close(() => resolve()));

    const error = await sendKolaybiLiveRequest(input(closedOrigin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KolaybiLiveTransportError);
    expect((error as KolaybiLiveTransportError).attempt.error?.code).toBe("network_error");
  });
});
