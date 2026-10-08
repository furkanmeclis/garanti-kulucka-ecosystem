import { describe, expect, it } from "vitest";
import type { ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import type {
  InstagramGraphFetchTransport,
  InstagramGraphTransportRequest,
  InstagramGraphTransportResponse,
} from "../src/providers/instagram-graph.js";
import { MessengerLiveTransportError } from "../src/providers/messenger.js";

/**
 * Legacy server.js webhook subscription (/api/instagram/subscribe-webhook, disconnect, Messenger
 * ensure-ready) and Handover Protocol lab calls (thread_owner / take_thread_control / release_thread_control)
 * as `provider-delivery` jobs for the instagram and messenger providers.
 */

const now = "2026-01-01T00:00:00.000Z";
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

function account(provider: "instagram" | "messenger", live = true): ProviderAccountConfigRepository {
  return {
    getAccountConfig: async () =>
      provider === "instagram"
        ? {
            provider,
            account_public_id: "iac_instagram_live",
            live_mode: live,
            tokens: { access_token: "ig-token-secret" },
            settings: { "providers.instagram.live_mode": live, ig_graph_url: igOrigin, graph_url: fbOrigin, ig_user_id: "17841400000000000" },
          }
        : {
            provider,
            account_public_id: "iac_messenger_live",
            live_mode: live,
            tokens: { page_access_token: "page-token-secret" },
            settings: { "providers.messenger.live_mode": live, graph_url: fbOrigin, page_id: "1122334455" },
          },
  };
}

function envelope(provider: "instagram" | "messenger", operation: ProviderRequestEnvelope["operation"], payload: Record<string, unknown>): ProviderRequestEnvelope {
  return {
    request_id: `req_${provider}_${operation}`,
    provider,
    operation,
    direction: "outbound",
    channel: provider,
    account_public_id: provider === "instagram" ? "iac_instagram_live" : "iac_messenger_live",
    occurred_at: now,
    payload,
  };
}

function job(env: ProviderRequestEnvelope) {
  return {
    id: `bull_${env.request_id}`,
    name: `${env.provider}.${env.operation}`,
    attemptsMade: 0,
    opts: { attempts: 3 },
    data: { job_id: `job_${env.request_id}`, queue: "provider-delivery" as const, name: `${env.provider}.${env.operation}`, requested_at: now, payload: { envelope: env } },
  };
}

function json(status: number, body: unknown): InstagramGraphTransportResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function run(env: ProviderRequestEnvelope, responses: InstagramGraphTransportResponse[], live = true) {
  const captured: InstagramGraphTransportRequest[] = [];
  const persisted: ProviderAttempt[] = [];
  const transport: InstagramGraphFetchTransport = async (request) => {
    captured.push(request);
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return next;
  };
  const registry = createWorkerProcessorRegistry({
    providerAccountConfigRepository: account(env.provider as "instagram" | "messenger", live),
    providerAttemptRepository: attemptRepository(persisted),
    instagramGraphTransport: transport,
  });
  const result = await registry.dispatch("provider-delivery", job(env)).catch((caught: unknown) => caught);
  return { captured, persisted, result };
}

describe("Meta page Graph operations (webhook subscription + thread control)", () => {
  it("subscribes the Instagram account with the legacy default fields and lists the subscriptions", async () => {
    const { captured, persisted, result } = await run(envelope("instagram", "webhook.subscribe", { idempotency_key: "s1" }), [
      json(200, { success: true }),
      json(200, { data: [{ id: "app_1", subscribed_fields: ["messages"] }] }),
    ]);
    expect(result).toMatchObject({ status: "accepted_live", response_payload: { success: true, subscribed: true, subscriptions: [{ id: "app_1" }] } });
    expect(captured.map((request) => [request.method, request.url])).toEqual([
      ["POST", `${igOrigin}/17841400000000000/subscribed_apps`],
      ["GET", `${igOrigin}/17841400000000000/subscribed_apps?access_token=ig-token-secret`],
    ]);
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({
      subscribed_fields: ["messages", "messaging_postbacks", "message_reactions", "comments", "live_comments"],
      access_token: "ig-token-secret",
    });
    const serialized = JSON.stringify(persisted[0]);
    expect(serialized).not.toContain("ig-token-secret");
    expect((persisted[0]?.response_metadata as Record<string, unknown>).result).toMatchObject({ subscribed: true });
  });

  it("uses the Page token, Page ID and Facebook host for Messenger with the legacy Messenger fields", async () => {
    const { captured, result } = await run(envelope("messenger", "webhook.subscribe", {}), [json(200, { success: true }), json(200, { data: [] })]);
    expect(result).toMatchObject({ status: "accepted_live" });
    expect(captured[0]).toMatchObject({ method: "POST", url: `${fbOrigin}/1122334455/subscribed_apps` });
    expect(JSON.parse(captured[0]?.body ?? "{}")).toMatchObject({ subscribed_fields: expect.arrayContaining(["messaging_handovers", "feed"]), access_token: "page-token-secret" });
  });

  it("unsubscribes with DELETE and falls back to the Facebook host on an Instagram host error", async () => {
    const { captured, result } = await run(envelope("instagram", "webhook.unsubscribe", { reason: "disconnect" }), [
      json(400, { error: { message: "unsupported", code: 100 } }),
      json(200, { success: true }),
    ]);
    expect(result).toMatchObject({ status: "accepted_live", response_payload: { subscribed: false } });
    expect(captured.map((request) => [request.method, request.url])).toEqual([
      ["DELETE", `${igOrigin}/17841400000000000/subscribed_apps?access_token=ig-token-secret`],
      ["DELETE", `${fbOrigin}/17841400000000000/subscribed_apps?access_token=ig-token-secret`],
    ]);
  });

  it("looks up the thread owner and normalizes the app id", async () => {
    const { captured, result } = await run(envelope("messenger", "thread.owner", { recipient_id: "2468" }), [
      json(200, { data: [{ thread_owner: { app_id: "9001", expiration: "2026-01-02T00:00:00+0000" } }] }),
    ]);
    expect(captured[0]).toMatchObject({ method: "GET", url: `${fbOrigin}/1122334455/thread_owner?recipient=2468&access_token=page-token-secret` });
    expect(result).toMatchObject({ response_payload: { recipient_id: "2468", thread_owner: { app_id: "9001", expiration: "2026-01-02T00:00:00+0000" } } });
  });

  it("takes and releases thread control with the legacy bodies", async () => {
    const take = await run(envelope("instagram", "thread.take", { recipient_id: "2468" }), [json(200, { success: true })]);
    expect(take.captured[0]).toMatchObject({ method: "POST", url: `${igOrigin}/17841400000000000/take_thread_control` });
    expect(JSON.parse(take.captured[0]?.body ?? "{}")).toEqual({ recipient: { id: "2468" }, metadata: "garanti_kulucka_panel", access_token: "ig-token-secret" });

    const release = await run(envelope("messenger", "thread.release", { recipient_id: "2468", metadata: "custom" }), [json(200, { success: true })]);
    expect(release.captured[0]).toMatchObject({ method: "POST", url: `${fbOrigin}/1122334455/release_thread_control` });
    expect(JSON.parse(release.captured[0]?.body ?? "{}")).toEqual({ recipient: { id: "2468" }, metadata: "custom", access_token: "page-token-secret" });
  });

  it("fails without a recipient before any live call and raises the Messenger transport error on Graph errors", async () => {
    const missing = await run(envelope("messenger", "thread.take", {}), []);
    expect(missing.captured).toHaveLength(0);
    expect(missing.persisted[0]).toMatchObject({ status: "terminal_failure", error: { code: "invalid_payload" } });

    const rejected = await run(envelope("messenger", "thread.take", { recipient_id: "2468" }), [json(401, { error: { message: "bad token", code: 190 } }), json(401, { error: { message: "bad token", code: 190 } })]);
    expect(rejected.result).toBeInstanceOf(MessengerLiveTransportError);
    expect(rejected.persisted[0]).toMatchObject({ provider: "messenger", status: "terminal_failure", error: { code: "instagram_token_error" } });
  });

  it("stays fixture-only unless providers.<provider>.live_mode is enabled", async () => {
    const { captured, result } = await run(envelope("messenger", "webhook.subscribe", {}), [], false);
    expect(captured).toHaveLength(0);
    expect(result).toMatchObject({ live_call_performed: false });
  });
});
