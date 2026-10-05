import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { NetgsmLiveTransportError, sendNetgsmLiveRequest } from "../src/providers/netgsm.js";

const now = "2026-01-01T00:00:00.000Z";

interface ReceivedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void;

let server: Server | null = null;

async function startMockNetgsm(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] }> {
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

async function startMockNetgsmOrSkip(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] } | null> {
  try {
    return await startMockNetgsm(handler);
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

function smsEnvelope(): ProviderRequestEnvelope {
  return {
    request_id: "req_netgsm_http_sms",
    provider: "netgsm",
    operation: "sms.send",
    direction: "outbound",
    channel: "sms",
    account_public_id: "iac_netgsm_live",
    occurred_at: now,
    payload: {
      idempotency_key: "sms-http-1",
      recipient_phone: "+90 555 123 45 67",
      message: "Merhaba şube bildirimi",
    },
  };
}

function input(origin: string, timeoutMs = 2_000) {
  const envelope = smsEnvelope();
  return {
    envelope,
    job: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: "netgsm.sms.send",
      requested_at: now,
      payload: { envelope },
    },
    accountConfig: {
      provider: "netgsm" as const,
      account_public_id: "iac_netgsm_live",
      live_mode: true,
      tokens: {
        sms_usercode: "3229110532",
        sms_password: "http-netgsm-password-secret",
      },
      settings: {
        live_mode: true,
        api_url: origin,
        msgheader: "GARANTIKLC",
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

describe("NetGSM live adapter over a local HTTP server", () => {
  it("sends the legacy XML request over real HTTP", async () => {
    const mock = await startMockNetgsmOrSkip((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("00 123456789");
    });
    if (!mock) return;

    const result = await sendNetgsmLiveRequest(input(mock.origin));

    expect(mock.received).toHaveLength(1);
    expect(mock.received[0]?.method).toBe("POST");
    expect(mock.received[0]?.url).toBe("/sms/send/xml/");
    expect(mock.received[0]?.headers["content-type"]).toBe("text/xml; charset=utf-8");
    expect(mock.received[0]?.body).toContain("<company dil=\"TR\">Netgsm</company>");
    expect(mock.received[0]?.body).toContain("<usercode>3229110532</usercode>");
    expect(mock.received[0]?.body).toContain("<password>http-netgsm-password-secret</password>");
    expect(mock.received[0]?.body).toContain("<msgheader>GARANTIKLC</msgheader>");
    expect(mock.received[0]?.body).toContain("<msg><![CDATA[Merhaba şube bildirimi]]></msg>");
    expect(mock.received[0]?.body).toContain("<no>905551234567</no>");
    expect(result.response_payload).toMatchObject({ success: true, sms_sent: true, bulkId: "123456789" });
    expect(result.attempt.status).toBe("success");
    expect(JSON.stringify(result.attempt)).not.toContain("3229110532");
    expect(JSON.stringify(result.attempt)).not.toContain("http-netgsm-password-secret");
  });

  it("records a retryable 503 attempt without leaking credentials", async () => {
    const mock = await startMockNetgsmOrSkip((_request, response) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("unavailable");
    });
    if (!mock) return;

    const error = await sendNetgsmLiveRequest(input(mock.origin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetgsmLiveTransportError);
    const attempt = (error as NetgsmLiveTransportError).attempt;
    expect(attempt.status_code).toBe(503);
    expect(attempt.error?.code).toBe("provider_http_error");
    expect(JSON.stringify(attempt)).not.toContain("3229110532");
    expect(JSON.stringify(attempt)).not.toContain("http-netgsm-password-secret");
  });

  it("aborts a hanging server with a timeout attempt", async () => {
    const mock = await startMockNetgsmOrSkip(() => {
      // never respond
    });
    if (!mock) return;

    const error = await sendNetgsmLiveRequest(input(mock.origin, 200)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetgsmLiveTransportError);
    expect((error as NetgsmLiveTransportError).attempt.error?.code).toBe("timeout");
  });

  it("reports connection refused as a network error", async () => {
    const mock = await startMockNetgsmOrSkip(() => undefined);
    if (!mock) return;
    const closedOrigin = mock.origin;
    const current = server;
    server = null;
    current?.closeAllConnections();
    await new Promise<void>((resolve) => current?.close(() => resolve()));

    const error = await sendNetgsmLiveRequest(input(closedOrigin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetgsmLiveTransportError);
    expect((error as NetgsmLiveTransportError).attempt.error?.code).toBe("network_error");
  });
});
