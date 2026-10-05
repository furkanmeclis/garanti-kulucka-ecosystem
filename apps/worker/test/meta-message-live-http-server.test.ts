import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { InstagramLiveTransportError, sendInstagramLiveRequest } from "../src/providers/instagram.js";
import { MessengerLiveTransportError, sendMessengerLiveRequest } from "../src/providers/messenger.js";

const now = "2026-01-01T00:00:00.000Z";

interface ReceivedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void;
type MetaProvider = "instagram" | "messenger";

let server: Server | null = null;

async function startMockMeta(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] }> {
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

async function startMockMetaOrSkip(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] } | null> {
  try {
    return await startMockMeta(handler);
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

function messageEnvelope(provider: MetaProvider): ProviderRequestEnvelope {
  return {
    request_id: `req_${provider}_http_message`,
    provider,
    operation: "message.send",
    direction: "outbound",
    channel: provider,
    account_public_id: `iac_${provider}_live`,
    occurred_at: now,
    payload: {
      idempotency_key: `${provider}-http-1`,
      recipient_id: provider === "instagram" ? "17841499999999999" : "psid_messenger_demo",
      message: "Merhaba",
    },
  };
}

function input(provider: MetaProvider, origin: string, timeoutMs = 2_000) {
  const envelope = messageEnvelope(provider);
  return {
    envelope,
    job: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: `${provider}.message.send`,
      requested_at: now,
      payload: { envelope },
    },
    accountConfig: {
      provider,
      account_public_id: `iac_${provider}_live`,
      live_mode: true,
      tokens: provider === "instagram"
        ? { access_token: `http-${provider}-token-secret` }
        : { page_access_token: `http-${provider}-token-secret` },
      settings: {
        live_mode: true,
        [`providers.${provider}.live_mode`]: true,
        api_url: origin,
        ...(provider === "instagram" ? { ig_user_id: "17841400000000000" } : { page_id: "1122334455" }),
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

const providers = [
  {
    provider: "instagram" as const,
    send: sendInstagramLiveRequest,
    errorClass: InstagramLiveTransportError,
    expectedPath: "/v26.0/17841400000000000/messages",
    expectedBody: {
      recipient: { id: "17841499999999999" },
      message: { text: "Merhaba" },
    },
  },
  {
    provider: "messenger" as const,
    send: sendMessengerLiveRequest,
    errorClass: MessengerLiveTransportError,
    expectedPath: "/v26.0/1122334455/messages",
    expectedBody: {
      recipient: { id: "psid_messenger_demo" },
      message: { text: "Merhaba" },
      messaging_type: "RESPONSE",
    },
  },
];

describe.each(providers)("$provider Graph live adapter over a local HTTP server", (spec) => {
  it("sends the legacy message request over real HTTP", async () => {
    const mock = await startMockMetaOrSkip((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        recipient_id: "recipient.http",
        message_id: "mid.http",
      }));
    });
    if (!mock) return;

    const result = await spec.send(input(spec.provider, mock.origin));

    expect(mock.received).toHaveLength(1);
    expect(mock.received[0]?.method).toBe("POST");
    expect(mock.received[0]?.url).toBe(spec.expectedPath);
    expect(mock.received[0]?.headers.authorization).toBe(`Bearer http-${spec.provider}-token-secret`);
    expect(mock.received[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(mock.received[0]?.body ?? "{}")).toEqual(spec.expectedBody);
    expect(result.response_payload).toMatchObject({ success: true, message_sent: true });
    expect(result.attempt.status).toBe("success");
    expect(JSON.stringify(result.attempt)).not.toContain(`http-${spec.provider}-token-secret`);
  });

  it("records a retryable 503 attempt without leaking tokens", async () => {
    const mock = await startMockMetaOrSkip((_request, response) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("unavailable");
    });
    if (!mock) return;

    const error = await spec.send(input(spec.provider, mock.origin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(spec.errorClass);
    const attempt = (error as InstagramLiveTransportError | MessengerLiveTransportError).attempt;
    expect(attempt.status_code).toBe(503);
    expect(attempt.error?.code).toBe("provider_http_error");
    expect(JSON.stringify(attempt)).not.toContain(`http-${spec.provider}-token-secret`);
  });

  it("aborts a hanging server with a timeout attempt", async () => {
    const mock = await startMockMetaOrSkip(() => {
      // never respond
    });
    if (!mock) return;

    const error = await spec.send(input(spec.provider, mock.origin, 200)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(spec.errorClass);
    expect((error as InstagramLiveTransportError | MessengerLiveTransportError).attempt.error?.code).toBe("timeout");
  });

  it("reports connection refused as a network error", async () => {
    const mock = await startMockMetaOrSkip(() => undefined);
    if (!mock) return;
    const closedOrigin = mock.origin;
    const current = server;
    server = null;
    current?.closeAllConnections();
    await new Promise<void>((resolve) => current?.close(() => resolve()));

    const error = await spec.send(input(spec.provider, closedOrigin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(spec.errorClass);
    expect((error as InstagramLiveTransportError | MessengerLiveTransportError).attempt.error?.code).toBe("network_error");
  });
});
