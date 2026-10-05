import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { PttLiveTransportError, sendPttLiveRequest } from "../src/providers/ptt.js";

const now = "2026-01-01T00:00:00.000Z";

interface ReceivedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void;

let server: Server | null = null;

async function startMockPtt(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] }> {
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
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
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

function trackEnvelope(): ProviderRequestEnvelope {
  return {
    request_id: "req_ptt_http_track",
    provider: "ptt",
    operation: "shipment.track",
    direction: "outbound",
    channel: "cargo",
    account_public_id: "iac_ptt_live",
    occurred_at: now,
    payload: { tracking_number: "2791727900015" },
  };
}

function input(origin: string, timeoutMs = 2_000) {
  const envelope = trackEnvelope();
  return {
    envelope,
    job: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: "ptt.shipment.track",
      requested_at: now,
      payload: { envelope },
    },
    accountConfig: {
      provider: "ptt" as const,
      account_public_id: "iac_ptt_live",
      live_mode: true,
      tokens: {},
      settings: {
        live_mode: true,
        musteri_no: "100589048",
        sifre: "ptt-secret",
        gonderi_takip_url: `${origin}/GonderiTakipV2/services/Sorgu`,
        veri_yukleme_url: `${origin}/PttVeriYukleme/services/Sorgu`,
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

const trackSuccessXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope><soap:Body><gonderiSorgu2Response><return><sonucKodu>0</sonucKodu><sonucAciklama>BASARILI</sonucAciklama><BARNO>2791727900015</BARNO><IMERK>KADIKOY</IMERK><VMERK>ANKARA</VMERK></return></gonderiSorgu2Response></soap:Body></soap:Envelope>`;

describe("PTT live adapter over a local HTTP server", () => {
  it("sends the legacy SOAP request over real HTTP and normalizes the response", async () => {
    const mock = await startMockPtt((_request, response) => {
      response.writeHead(200, { "content-type": "application/soap+xml" });
      response.end(trackSuccessXml);
    });

    const result = await sendPttLiveRequest(input(mock.origin));

    expect(mock.received).toHaveLength(1);
    const received = mock.received[0];
    expect(received?.method).toBe("POST");
    expect(received?.url).toBe("/GonderiTakipV2/services/Sorgu");
    expect(received?.headers["content-type"]).toBe('application/soap+xml; charset=utf-8; action="gonderiSorgu2"');
    expect(received?.body).toContain("<tak:gonderiSorgu2>");
    expect(received?.body).toContain("<barkod>2791727900015</barkod>");
    expect(received?.body).toContain("<kullanici>100589048</kullanici>");
    expect(received?.body).toContain("<sifre>ptt-secret</sifre>");
    expect(result.response_payload).toMatchObject({ success: true, barkodNo: "2791727900015" });
    expect(result.attempt.status).toBe("success");
    expect(JSON.stringify(result.attempt)).not.toContain("ptt-secret");
  });

  it("falls back to gonderiSorgu over real HTTP after a SOAP fault", async () => {
    const mock = await startMockPtt((request, response) => {
      response.writeHead(200, { "content-type": "application/soap+xml" });
      response.end(
        request.body.includes("<tak:gonderiSorgu2>")
          ? `<soap:Envelope><soap:Body><soap:Fault><faultstring>x</faultstring></soap:Fault></soap:Body></soap:Envelope>`
          : trackSuccessXml,
      );
    });

    await expect(sendPttLiveRequest(input(mock.origin))).resolves.toMatchObject({
      response_payload: { success: true },
    });
    expect(mock.received.map((request) => request.headers["content-type"])).toEqual([
      'application/soap+xml; charset=utf-8; action="gonderiSorgu2"',
      'application/soap+xml; charset=utf-8; action="gonderiSorgu"',
    ]);
  });

  it("records a retryable 503 attempt without leaking credentials", async () => {
    const mock = await startMockPtt((_request, response) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("unavailable");
    });

    const error = await sendPttLiveRequest(input(mock.origin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PttLiveTransportError);
    const attempt = (error as PttLiveTransportError).attempt;
    expect(attempt.status_code).toBe(503);
    expect(attempt.error?.code).toBe("provider_http_error");
    expect(JSON.stringify(attempt)).not.toContain("ptt-secret");
  });

  it("aborts a hanging server with a timeout attempt", async () => {
    const mock = await startMockPtt(() => {
      // never respond
    });

    const error = await sendPttLiveRequest(input(mock.origin, 200)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PttLiveTransportError);
    expect((error as PttLiveTransportError).attempt.error?.code).toBe("timeout");
  });

  it("reports connection refused as a network error", async () => {
    const mock = await startMockPtt(() => undefined);
    const closedOrigin = mock.origin;
    const current = server;
    server = null;
    current?.closeAllConnections();
    await new Promise<void>((resolve) => current?.close(() => resolve()));

    const error = await sendPttLiveRequest(input(closedOrigin)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PttLiveTransportError);
    expect((error as PttLiveTransportError).attempt.error?.code).toBe("network_error");
  });
});
