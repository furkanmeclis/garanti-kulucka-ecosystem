import { describe, expect, it } from "vitest";
import type { ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import { InstagramLiveTransportError } from "../src/providers/instagram.js";
import type {
  InstagramGraphFetchTransport,
  InstagramGraphTransportRequest,
  InstagramGraphTransportResponse,
} from "../src/providers/instagram-graph.js";
import { ProviderMediaFileError, type ProviderMediaFileResolver } from "../src/providers/media-files.js";
import {
  WhatsappLiveTransportError,
  whatsappMediaTypeForMime,
  whatsappSafeFileName,
  type WhatsappFetchTransport,
  type WhatsappTransportRequest,
  type WhatsappTransportResponse,
} from "../src/providers/whatsapp.js";

const now = "2026-01-01T00:00:00.000Z";
const waOrigin = "https://graph.test/v26.0";
const igOrigin = "https://ig-graph.test/v26.0";
const fbOrigin = "https://fb-graph.test/v26.0";

function attemptRepository(persisted: ProviderAttempt[]): ProviderAttemptRepository {
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

function deliveryJob(envelope: ProviderRequestEnvelope, attempts = 3) {
  return {
    id: `bull_${envelope.request_id}`,
    name: `${envelope.provider}.${envelope.operation}`,
    attemptsMade: 0,
    opts: { attempts },
    data: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: `${envelope.provider}.${envelope.operation}`,
      requested_at: now,
      payload: { envelope },
    },
  };
}

function json(status: number, body: unknown) {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("WhatsApp media upload (two-step legacy send-media)", () => {
  const waAccount: ProviderAccountConfigRepository = {
    getAccountConfig: async () => ({
      provider: "whatsapp",
      account_public_id: "iac_whatsapp_live",
      live_mode: true,
      tokens: { access_token: "wa-media-token-secret" },
      settings: {
        "providers.whatsapp.live_mode": true,
        api_url: waOrigin,
        phone_number_id: "123456789",
      },
    }),
  };

  function resolver(mime = "application/pdf", name: string | null = "fatura.pdf"): ProviderMediaFileResolver {
    return {
      resolve: async (filePublicId) => {
        if (filePublicId !== "fil_demo") throw new ProviderMediaFileError(`Media file not found: ${filePublicId}`);
        return {
          file_public_id: filePublicId,
          bytes: new Uint8Array([37, 80, 68, 70]),
          mime_type: mime,
          file_name: name,
          byte_size: 4,
        };
      },
    };
  }

  function envelope(payload: Record<string, unknown> = {}): ProviderRequestEnvelope {
    return {
      request_id: "req_wa_media",
      provider: "whatsapp",
      operation: "message.send",
      direction: "outbound",
      channel: "whatsapp",
      account_public_id: "iac_whatsapp_live",
      occurred_at: now,
      payload: {
        idempotency_key: "wa-media-1",
        to: "+90 555 123 45 67",
        attachment: { file_public_id: "fil_demo", caption: "Faturaniz" },
        ...payload,
      },
    };
  }

  function sequence(captured: WhatsappTransportRequest[], responses: WhatsappTransportResponse[]): WhatsappFetchTransport {
    return async (request) => {
      captured.push(request);
      const next = responses.shift();
      if (!next) throw new Error("unexpected call");
      return next;
    };
  }

  it("uploads the stored file to /{phone_number_id}/media and sends it by id", async () => {
    const captured: WhatsappTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: waAccount,
      providerAttemptRepository: attemptRepository(persisted),
      mediaFileResolver: resolver(),
      whatsappTransport: sequence(captured, [
        json(200, { id: "wamedia_1" }),
        json(200, { messaging_product: "whatsapp", messages: [{ id: "wamid.media" }] }),
      ]),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(envelope()))).resolves.toMatchObject({
      status: "accepted_live",
    });

    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      method: "POST",
      url: `${waOrigin}/123456789/media`,
      headers: { Authorization: "Bearer wa-media-token-secret" },
      whatsapp_endpoint: "media",
    });
    expect(captured[0]?.headers).not.toHaveProperty("Content-Type");
    expect(captured[0]?.multipart?.file).toMatchObject({ field: "file", filename: "fatura.pdf", mime_type: "application/pdf" });
    expect(captured[0]?.multipart?.fields).toEqual([
      ["type", "application/pdf"],
      ["messaging_product", "whatsapp"],
    ]);
    expect(captured[1]?.url).toBe(`${waOrigin}/123456789/messages`);
    expect(JSON.parse(captured[1]?.body ?? "{}")).toEqual({
      messaging_product: "whatsapp",
      to: "905551234567",
      type: "document",
      document: { id: "wamedia_1", caption: "Faturaniz", filename: "fatura.pdf" },
    });
    expect(persisted[0]).toMatchObject({ status: "success", status_code: 200 });
    expect(persisted[0]?.request_metadata.media_upload).toMatchObject({
      file_public_id: "fil_demo",
      uploaded: true,
      media_id: "wamedia_1",
    });
    expect(JSON.stringify(persisted[0])).not.toContain("wa-media-token-secret");
  });

  it("maps mime types and file names like legacy", () => {
    expect(whatsappMediaTypeForMime("image/jpeg")).toBe("image");
    expect(whatsappMediaTypeForMime("video/mp4")).toBe("video");
    expect(whatsappMediaTypeForMime("audio/ogg")).toBe("audio");
    expect(whatsappMediaTypeForMime("application/pdf")).toBe("document");
    expect(whatsappSafeFileName(null, "image/jpeg")).toBe("media.jpeg");
    expect(whatsappSafeFileName("a.png", "image/png")).toBe("a.png");
  });

  it("drops the caption for audio media", async () => {
    const captured: WhatsappTransportRequest[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: waAccount,
      mediaFileResolver: resolver("audio/ogg", null),
      whatsappTransport: sequence(captured, [
        json(200, { id: "wamedia_audio" }),
        json(200, { messages: [{ id: "wamid.audio" }] }),
      ]),
    });
    await registry.dispatch("provider-delivery", deliveryJob(envelope()));
    expect(captured[0]?.multipart?.file.filename).toBe("media.ogg");
    expect(JSON.parse(captured[1]?.body ?? "{}")).toEqual({
      messaging_product: "whatsapp",
      to: "905551234567",
      type: "audio",
      audio: { id: "wamedia_audio" },
    });
  });

  it("fails terminally without a live call when the file cannot be resolved", async () => {
    const captured: WhatsappTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: waAccount,
      providerAttemptRepository: attemptRepository(persisted),
      mediaFileResolver: resolver(),
      whatsappTransport: sequence(captured, []),
    });
    const error = await registry
      .dispatch("provider-delivery", deliveryJob(envelope({ attachment: { file_public_id: "fil_missing" } })))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WhatsappLiveTransportError);
    expect(captured).toHaveLength(0);
    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      error: { code: "media_file_unavailable" },
    });
    expect(persisted[0]?.request_metadata.live_call_performed).toBe(false);
  });

  it("stops before /messages when the upload fails and never retries without an idempotency key", async () => {
    const captured: WhatsappTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: waAccount,
      providerAttemptRepository: attemptRepository(persisted),
      mediaFileResolver: resolver(),
      whatsappTransport: sequence(captured, [json(503, { error: { message: "down", code: 2 } })]),
    });
    await expect(
      registry.dispatch("provider-delivery", deliveryJob(envelope({ idempotency_key: undefined }))),
    ).rejects.toBeInstanceOf(WhatsappLiveTransportError);
    expect(captured).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ status: "terminal_failure", status_code: 503, error: { code: "provider_http_error" } });
    expect((persisted[0]?.request_metadata.retry as Record<string, unknown>).reason).toBe("missing_idempotency_key");
  });

  it("treats an upload response without id as malformed", async () => {
    const captured: WhatsappTransportRequest[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: waAccount,
      mediaFileResolver: resolver(),
      whatsappTransport: sequence(captured, [json(200, { ok: true })]),
    });
    const error = await registry.dispatch("provider-delivery", deliveryJob(envelope())).catch((caught: unknown) => caught);
    expect((error as WhatsappLiveTransportError).attempt.error?.code).toBe("malformed_response");
    expect(captured).toHaveLength(1);
  });
});

describe("Instagram content publish and comment actions", () => {
  function igAccount(settings: Record<string, unknown> = {}): ProviderAccountConfigRepository {
    return {
      getAccountConfig: async () => ({
        provider: "instagram",
        account_public_id: "iac_instagram_live",
        live_mode: true,
        tokens: { access_token: "ig-graph-token-secret" },
        settings: {
          "providers.instagram.live_mode": true,
          ig_graph_url: igOrigin,
          graph_url: fbOrigin,
          ig_user_id: "17841400000000000",
          publish_poll_interval_ms: 0,
          ...settings,
        },
      }),
    };
  }

  function envelope(operation: ProviderRequestEnvelope["operation"], payload: Record<string, unknown>): ProviderRequestEnvelope {
    return {
      request_id: `req_ig_${operation}`,
      provider: "instagram",
      operation,
      direction: "outbound",
      channel: "instagram",
      account_public_id: "iac_instagram_live",
      occurred_at: now,
      payload,
    };
  }

  function sequence(
    captured: InstagramGraphTransportRequest[],
    responses: InstagramGraphTransportResponse[],
  ): InstagramGraphFetchTransport {
    return async (request) => {
      captured.push(request);
      const next = responses.shift();
      if (!next) throw new Error("unexpected call");
      return next;
    };
  }

  async function run(
    env: ProviderRequestEnvelope,
    responses: InstagramGraphTransportResponse[],
    settings: Record<string, unknown> = {},
  ) {
    const captured: InstagramGraphTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: igAccount(settings),
      providerAttemptRepository: attemptRepository(persisted),
      instagramGraphTransport: sequence(captured, responses),
    });
    const result = await registry.dispatch("provider-delivery", deliveryJob(env)).catch((caught: unknown) => caught);
    return { captured, persisted, result };
  }

  it("publishes a photo via /media then /media_publish with the legacy JSON bodies", async () => {
    const { captured, persisted, result } = await run(
      envelope("media.publish", { image_url: "https://cdn.test/p.jpg", caption: "Yeni", idempotency_key: "pub-1" }),
      [json(200, { id: "creation_1" }), json(200, { id: "media_1" })],
    );
    expect(result).toMatchObject({ status: "accepted_live" });
    expect(captured.map((request) => [request.method, request.url])).toEqual([
      ["POST", `${igOrigin}/17841400000000000/media`],
      ["POST", `${igOrigin}/17841400000000000/media_publish`],
    ]);
    expect(captured[0]?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({
      image_url: "https://cdn.test/p.jpg",
      caption: "Yeni",
      access_token: "ig-graph-token-secret",
    });
    expect(JSON.parse(captured[1]?.body ?? "{}")).toEqual({ creation_id: "creation_1", access_token: "ig-graph-token-secret" });
    expect(persisted[0]).toMatchObject({ status: "success", operation: "media.publish" });
    expect((persisted[0]?.request_metadata.graph_calls as unknown[]).length).toBe(2);
    expect(JSON.stringify(persisted[0])).not.toContain("ig-graph-token-secret");
  });

  it("publishes a reel after polling the container status", async () => {
    const { captured, result } = await run(
      envelope("media.publish", { video_url: "https://cdn.test/v.mp4", idempotency_key: "pub-2" }),
      [
        json(200, { id: "creation_v" }),
        json(200, { status_code: "IN_PROGRESS" }),
        json(200, { status_code: "FINISHED" }),
        json(200, { id: "media_v" }),
      ],
    );
    expect(result).toMatchObject({ status: "accepted_live" });
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({
      media_type: "REELS",
      video_url: "https://cdn.test/v.mp4",
      caption: "",
      access_token: "ig-graph-token-secret",
    });
    expect(captured[1]).toMatchObject({
      method: "GET",
      url: `${igOrigin}/creation_v?fields=status_code&access_token=ig-graph-token-secret`,
      body: "",
    });
    expect(captured).toHaveLength(4);
  });

  it("fails publish terminally when the container never finishes", async () => {
    const { captured, persisted, result } = await run(
      envelope("media.publish", { video_url: "https://cdn.test/v.mp4", idempotency_key: "pub-3" }),
      [json(200, { id: "creation_x" }), json(200, { status_code: "ERROR" })],
    );
    expect(result).toBeInstanceOf(InstagramLiveTransportError);
    expect(captured).toHaveLength(2);
    expect(persisted[0]).toMatchObject({ status: "terminal_failure", error: { code: "media_container_not_ready" } });
    expect(JSON.stringify(persisted[0])).not.toContain("ig-graph-token-secret");
  });

  it("sends a public reply to /{comment_id}/replies", async () => {
    const { captured, result } = await run(
      envelope("comment.reply", { comment_id: "c1", message: " Tesekkurler ", idempotency_key: "r-1" }),
      [json(200, { id: "reply_1" })],
    );
    expect(result).toMatchObject({ status: "accepted_live" });
    expect(captured[0]).toMatchObject({ method: "POST", url: `${igOrigin}/c1/replies` });
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({ message: "Tesekkurler", access_token: "ig-graph-token-secret" });
  });

  it("falls back to the Facebook Graph host when the Instagram host returns an error", async () => {
    const { captured, persisted, result } = await run(
      envelope("comment.reply", { comment_id: "c1", message: "Merhaba", idempotency_key: "r-2" }),
      [json(400, { error: { message: "Unsupported", code: 100 } }), json(200, { id: "reply_fb" })],
    );
    expect(result).toMatchObject({ status: "accepted_live" });
    expect(captured.map((request) => request.url)).toEqual([`${igOrigin}/c1/replies`, `${fbOrigin}/c1/replies`]);
    expect((persisted[0]?.request_metadata.graph_calls as unknown[]).length).toBe(2);
  });

  it("sends a private reply with recipient.comment_id to /{ig_user_id}/messages", async () => {
    const { captured } = await run(
      envelope("comment.private_reply", { comment_id: "c2", message: "DM", idempotency_key: "p-1" }),
      [json(200, { recipient_id: "u", message_id: "m" })],
    );
    expect(captured[0]?.url).toBe(`${igOrigin}/17841400000000000/messages`);
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({
      recipient: { comment_id: "c2" },
      message: { text: "DM" },
      access_token: "ig-graph-token-secret",
    });
  });

  it("hides a comment with { hide: true }", async () => {
    const { captured } = await run(envelope("comment.hide", { comment_id: "c3" }), [json(200, { success: true })]);
    expect(captured[0]).toMatchObject({ method: "POST", url: `${igOrigin}/c3` });
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({ hide: true, access_token: "ig-graph-token-secret" });
  });

  it("deletes a comment with DELETE and the token in the query string", async () => {
    const { captured, persisted } = await run(envelope("comment.delete", { comment_id: "c4" }), [json(200, { success: true })]);
    expect(captured[0]).toMatchObject({
      method: "DELETE",
      url: `${igOrigin}/c4?access_token=ig-graph-token-secret`,
      body: "",
    });
    const request = persisted[0]?.request_metadata.request as Record<string, unknown>;
    expect(request.query).toEqual({ access_token: "[redacted]" });
    expect(JSON.stringify(persisted[0])).not.toContain("ig-graph-token-secret");
  });

  it("retries idempotent hide on 5xx but never retries a reply without an idempotency key", async () => {
    const hide = await run(envelope("comment.hide", { comment_id: "c5" }), [
      json(503, { error: { message: "x", code: 2 } }),
      json(503, { error: { message: "x", code: 2 } }),
    ]);
    expect(hide.persisted[0]).toMatchObject({ status: "retryable_failure", retry_decision: "retry" });

    const reply = await run(envelope("comment.reply", { comment_id: "c5", message: "x" }), [
      json(503, { error: { message: "x", code: 2 } }),
      json(503, { error: { message: "x", code: 2 } }),
    ]);
    expect(reply.persisted[0]).toMatchObject({ status: "terminal_failure", retry_decision: "dead_letter" });
    expect((reply.persisted[0]?.request_metadata.retry as Record<string, unknown>).reason).toBe("missing_idempotency_key");
  });

  it("stays fixture-only unless providers.instagram.live_mode is enabled", async () => {
    const captured: InstagramGraphTransportRequest[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: igAccount({ "providers.instagram.live_mode": false }),
      instagramGraphTransport: sequence(captured, []),
    });
    await expect(
      registry.dispatch("provider-delivery", deliveryJob(envelope("comment.hide", { comment_id: "c6" }))),
    ).resolves.toMatchObject({ status: "accepted_fixture", live_call_performed: false });
    expect(captured).toHaveLength(0);
  });
});
