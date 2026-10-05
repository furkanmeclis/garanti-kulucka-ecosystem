import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { WhatsappLiveTransportError, sendWhatsappLiveRequest } from "../src/providers/whatsapp.js";

const now = "2026-01-01T00:00:00.000Z";

interface ReceivedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void;

let server: Server | null = null;

async function startMockWhatsapp(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] }> {
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
  return { origin: `http://127.0.0.1:${port}/v26.0`, received };
}

function socketBlocked(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "EPERM";
}

async function startMockWhatsappOrSkip(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] } | null> {
  try {
    return await startMockWhatsapp(handler);
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

function messageEnvelope(): ProviderRequestEnvelope {
  return {
    request_id: "req_whatsapp_http_message",
    provider: "whatsapp",
    operation: "message.send",
    direction: "outbound",
    channel: "whatsapp",
    account_public_id: "iac_whatsapp_live",
    occurred_at: now,
    payload: {
      idempotency_key: "wa-http-1",
      to: "+90 555 123 45 67",
      message: "Merhaba",
    },
  };
}

function input(origin: string, timeoutMs = 2_000) {
  const envelope = messageEnvelope();
  return {
    envelope,
    job: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: "whatsapp.message.send",
      requested_at: now,
      payload: { envelope },
    },
    accountConfig: {
      provider: "whatsapp" as const,
      account_public_id: "iac_whatsapp_live",
      live_mode: true,
      tokens: {
        access_token: "http-whatsapp-token-secret",
      },
      settings: {
        live_mode: true,
        api_url: origin,
        phone_number_id: "123456789",
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

describe("WhatsApp Cloud API live adapter over a local HTTP server", () => {
  it("sends the legacy message request over real HTTP", async () => {
    const mock = await startMockWhatsappOrSkip((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        messaging_product: "whatsapp",
        contacts: [{ input: "905551234567", wa_id: "905551234567" }],
        messages: [{ id: "wamid.http" }],
      }));
    });
    if (!mock) return;

    const result = await sendWhatsappLiveRequest(input(mock.origin));

    expect(mock.received).toHaveLength(1);
    expect(mock.received[0]?.method).toBe("POST");
    expect(mock.received[0]?.url).toBe("/v26.0/123456789/messages");
    expect(mock.received[0]?.headers.authorization).toBe("Bearer http-whatsapp-token-secret");
    expect(mock.received[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(mock.received[0]?.body ?? "{}")).toEqual({
      messaging_product: "whatsapp",
      to: "905551234567",
      type: "text",
      text: { body: "Merhaba" },
    });
    expect(result.response_payload).toMatchObject({ success: true, message_sent: true });
    expect(result.attempt.status).toBe("success");
    expect(JSON.stringify(result.attempt)).not.toContain("http-whatsapp-token-secret");
  });

  it("records a retryable 503 attempt without leaking tokens", async () => {
    const mock = await startMockWhatsappOrSkip((_request, response) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("unavailable");
    });
    if (!mock) return;

    const error = await sendWhatsappLiveRequest(input(mock.origin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WhatsappLiveTransportError);
    const attempt = (error as WhatsappLiveTransportError).attempt;
    expect(attempt.status_code).toBe(503);
    expect(attempt.error?.code).toBe("provider_http_error");
    expect(JSON.stringify(attempt)).not.toContain("http-whatsapp-token-secret");
  });

  it("aborts a hanging server with a timeout attempt", async () => {
    const mock = await startMockWhatsappOrSkip(() => {
      // never respond
    });
    if (!mock) return;

    const error = await sendWhatsappLiveRequest(input(mock.origin, 200)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WhatsappLiveTransportError);
    expect((error as WhatsappLiveTransportError).attempt.error?.code).toBe("timeout");
  });

  it("reports connection refused as a network error", async () => {
    const mock = await startMockWhatsappOrSkip(() => undefined);
    if (!mock) return;
    const closedOrigin = mock.origin;
    const current = server;
    server = null;
    current?.closeAllConnections();
    await new Promise<void>((resolve) => current?.close(() => resolve()));

    const error = await sendWhatsappLiveRequest(input(closedOrigin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WhatsappLiveTransportError);
    expect((error as WhatsappLiveTransportError).attempt.error?.code).toBe("network_error");
  });
});
