import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { InstagramLiveTransportError } from "../src/providers/instagram.js";
import { sendInstagramGraphLiveRequest } from "../src/providers/instagram-graph.js";
import type { ProviderMediaFileResolver } from "../src/providers/media-files.js";
import { sendWhatsappLiveRequest } from "../src/providers/whatsapp.js";

const now = "2026-01-01T00:00:00.000Z";

interface ReceivedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void;

let server: Server | null = null;

async function startMockGraph(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] }> {
  const received: ReceivedRequest[] = [];
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const entry = { method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks) };
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

async function startMockGraphOrSkip(handler: Handler): Promise<{ origin: string; received: ReceivedRequest[] } | null> {
  try {
    return await startMockGraph(handler);
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

function reply(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

describe("WhatsApp media upload over a local HTTP server", () => {
  it("sends a real multipart upload, then the media message by id", async () => {
    const mock = await startMockGraphOrSkip((request, response) => {
      if (request.url?.endsWith("/media")) reply(response, 200, { id: "wamedia_http" });
      else reply(response, 200, { messaging_product: "whatsapp", messages: [{ id: "wamid.http_media" }] });
    });
    if (!mock) return;

    const resolver: ProviderMediaFileResolver = {
      resolve: async (filePublicId) => ({
        file_public_id: filePublicId,
        bytes: new Uint8Array(Buffer.from("fake-jpeg-bytes")),
        mime_type: "image/jpeg",
        file_name: "kulucka.jpg",
        byte_size: 15,
      }),
    };
    const envelope: ProviderRequestEnvelope = {
      request_id: "req_wa_http_media",
      provider: "whatsapp",
      operation: "message.send",
      direction: "outbound",
      channel: "whatsapp",
      account_public_id: "iac_whatsapp_live",
      occurred_at: now,
      payload: { idempotency_key: "wa-http-media-1", to: "905551234567", attachment: { file_public_id: "fil_http", caption: "Foto" } },
    };

    const result = await sendWhatsappLiveRequest({
      envelope,
      job: job(envelope),
      accountConfig: {
        provider: "whatsapp",
        account_public_id: "iac_whatsapp_live",
        live_mode: true,
        tokens: { access_token: "http-wa-media-token-secret" },
        settings: { api_url: mock.origin, phone_number_id: "123456789" },
      },
      policy,
      attemptNumber: 1,
      maxAttempts: 3,
      mediaFileResolver: resolver,
    });

    expect(mock.received.map((request) => [request.method, request.url])).toEqual([
      ["POST", "/v26.0/123456789/media"],
      ["POST", "/v26.0/123456789/messages"],
    ]);
    const upload = mock.received[0];
    expect(upload?.headers.authorization).toBe("Bearer http-wa-media-token-secret");
    expect(upload?.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    const form = await new Request("http://local/", {
      method: "POST",
      headers: { "content-type": String(upload?.headers["content-type"]) },
      body: upload?.body ? new Uint8Array(upload.body) : null,
    }).formData();
    const file = form.get("file") as File;
    expect(file.name).toBe("kulucka.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("fake-jpeg-bytes");
    expect(form.get("type")).toBe("image/jpeg");
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(JSON.parse(mock.received[1]?.body.toString() ?? "{}")).toEqual({
      messaging_product: "whatsapp",
      to: "905551234567",
      type: "image",
      image: { id: "wamedia_http", caption: "Foto" },
    });
    expect(result.response_payload).toMatchObject({ success: true, media_id: "wamedia_http", media_type: "image" });
    expect(JSON.stringify(result.attempt)).not.toContain("http-wa-media-token-secret");
  });
});

describe("Instagram content publish and comment actions over a local HTTP server", () => {
  function igInput(origin: string, operation: ProviderRequestEnvelope["operation"], payload: Record<string, unknown>) {
    const envelope: ProviderRequestEnvelope = {
      request_id: `req_ig_http_${operation}`,
      provider: "instagram",
      operation,
      direction: "outbound",
      channel: "instagram",
      account_public_id: "iac_instagram_live",
      occurred_at: now,
      payload,
    };
    return {
      envelope,
      job: job(envelope),
      accountConfig: {
        provider: "instagram" as const,
        account_public_id: "iac_instagram_live",
        live_mode: true,
        tokens: { access_token: "http-ig-token-secret" },
        settings: { api_url: origin, ig_user_id: "17841400000000000" },
      },
      policy,
      attemptNumber: 1,
      maxAttempts: 3,
    };
  }

  it("publishes a photo through /media and /media_publish", async () => {
    const mock = await startMockGraphOrSkip((request, response) => {
      if (request.url?.endsWith("/media_publish")) reply(response, 200, { id: "media_http" });
      else reply(response, 200, { id: "creation_http" });
    });
    if (!mock) return;

    const result = await sendInstagramGraphLiveRequest(
      igInput(mock.origin, "media.publish", { image_url: "https://cdn.test/a.jpg", caption: "Merhaba", idempotency_key: "pub-http" }),
    );

    expect(mock.received.map((request) => [request.method, request.url])).toEqual([
      ["POST", "/v26.0/17841400000000000/media"],
      ["POST", "/v26.0/17841400000000000/media_publish"],
    ]);
    expect(mock.received[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(mock.received[0]?.body.toString() ?? "{}")).toEqual({
      image_url: "https://cdn.test/a.jpg",
      caption: "Merhaba",
      access_token: "http-ig-token-secret",
    });
    expect(JSON.parse(mock.received[1]?.body.toString() ?? "{}")).toEqual({
      creation_id: "creation_http",
      access_token: "http-ig-token-secret",
    });
    expect(result.response_payload).toEqual({ success: true, media_id: "media_http", creation_id: "creation_http" });
    expect(JSON.stringify(result.attempt)).not.toContain("http-ig-token-secret");
  });

  it("deletes a comment with a bodyless DELETE request", async () => {
    const mock = await startMockGraphOrSkip((_request, response) => reply(response, 200, { success: true }));
    if (!mock) return;

    const result = await sendInstagramGraphLiveRequest(igInput(mock.origin, "comment.delete", { comment_id: "1789" }));

    expect(mock.received[0]?.method).toBe("DELETE");
    expect(mock.received[0]?.url).toBe("/v26.0/1789?access_token=http-ig-token-secret");
    expect(mock.received[0]?.body.length).toBe(0);
    expect(result.response_payload).toMatchObject({ success: true, deleted: true });
    expect(JSON.stringify(result.attempt)).not.toContain("http-ig-token-secret");
  });

  it("records a token error from a hide request without leaking the token", async () => {
    const mock = await startMockGraphOrSkip((_request, response) =>
      reply(response, 400, { error: { message: "Invalid OAuth access token", code: 190, type: "OAuthException" } }),
    );
    if (!mock) return;

    const error = await sendInstagramGraphLiveRequest(igInput(mock.origin, "comment.hide", { comment_id: "1790" })).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(InstagramLiveTransportError);
    const attempt = (error as InstagramLiveTransportError).attempt;
    expect(mock.received).toHaveLength(1);
    expect(JSON.parse(mock.received[0]?.body.toString() ?? "{}")).toEqual({ hide: true, access_token: "http-ig-token-secret" });
    expect(attempt).toMatchObject({ status: "terminal_failure", status_code: 400, error: { code: "instagram_token_error" } });
    expect(JSON.stringify(attempt)).not.toContain("http-ig-token-secret");
  });
});
