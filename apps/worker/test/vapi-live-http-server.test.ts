import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { VapiLiveTransportError, sendVapiLiveRequest } from "../src/providers/vapi.js";

const now = "2026-01-01T00:00:00.000Z";

interface ReceivedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void;

let server: Server | null = null;

async function startMockVapi(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] }> {
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

async function startMockVapiOrSkip(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] } | null> {
  try {
    return await startMockVapi(handler);
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

function callEnvelope(): ProviderRequestEnvelope {
  return {
    request_id: "req_vapi_http_call",
    provider: "vapi",
    operation: "call.create",
    direction: "outbound",
    channel: "voice",
    account_public_id: "iac_vapi_live",
    occurred_at: now,
    payload: {
      idempotency_key: "vapi-http-1",
      customer_phone: "0555 123 45 67",
      customer_name: "Ayse Yilmaz",
      cargo_provider: "PTT",
      tracking_number: "PTT123",
      last_event_text: "Subede bekliyor",
    },
  };
}

function input(origin: string, timeoutMs = 2_000) {
  const envelope = callEnvelope();
  return {
    envelope,
    job: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: "vapi.call.create",
      requested_at: now,
      payload: { envelope },
    },
    accountConfig: {
      provider: "vapi" as const,
      account_public_id: "iac_vapi_live",
      live_mode: true,
      tokens: {
        api_key: "http-vapi-api-key-secret",
      },
      settings: {
        live_mode: true,
        api_url: origin,
        phone_number_id: "pn_http",
        assistant_id: "asst_http",
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

describe("Vapi live adapter over a local HTTP server", () => {
  it("sends the legacy call request over real HTTP", async () => {
    const mock = await startMockVapiOrSkip((_request, response) => {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "call_http_123", status: "queued" }));
    });
    if (!mock) return;

    const result = await sendVapiLiveRequest(input(mock.origin));

    expect(mock.received).toHaveLength(1);
    expect(mock.received[0]?.method).toBe("POST");
    expect(mock.received[0]?.url).toBe("/call/phone");
    expect(mock.received[0]?.headers["content-type"]).toBe("application/json");
    expect(mock.received[0]?.headers.authorization).toBe("Bearer http-vapi-api-key-secret");
    expect(JSON.parse(mock.received[0]?.body ?? "{}")).toMatchObject({
      phoneNumberId: "pn_http",
      customer: { number: "+905551234567", name: "Ayse Yilmaz" },
      assistantId: "asst_http",
    });
    expect(result.response_payload).toMatchObject({ success: true, call_created: true, call_id: "call_http_123" });
    expect(result.attempt.status).toBe("success");
    expect(JSON.stringify(result.attempt)).not.toContain("http-vapi-api-key-secret");
  });

  it("records a retryable 503 attempt without leaking credentials", async () => {
    const mock = await startMockVapiOrSkip((_request, response) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("unavailable");
    });
    if (!mock) return;

    const error = await sendVapiLiveRequest(input(mock.origin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(VapiLiveTransportError);
    const attempt = (error as VapiLiveTransportError).attempt;
    expect(attempt.status_code).toBe(503);
    expect(attempt.error?.code).toBe("provider_http_error");
    expect(JSON.stringify(attempt)).not.toContain("http-vapi-api-key-secret");
  });

  it("aborts a hanging server with a timeout attempt", async () => {
    const mock = await startMockVapiOrSkip(() => {
      // never respond
    });
    if (!mock) return;

    const error = await sendVapiLiveRequest(input(mock.origin, 200)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(VapiLiveTransportError);
    expect((error as VapiLiveTransportError).attempt.error?.code).toBe("timeout");
  });

  it("reports connection refused as a network error", async () => {
    const mock = await startMockVapiOrSkip(() => undefined);
    if (!mock) return;
    const closedOrigin = mock.origin;
    const current = server;
    server = null;
    current?.closeAllConnections();
    await new Promise<void>((resolve) => current?.close(() => resolve()));

    const error = await sendVapiLiveRequest(input(closedOrigin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(VapiLiveTransportError);
    expect((error as VapiLiveTransportError).attempt.error?.code).toBe("network_error");
  });
});
