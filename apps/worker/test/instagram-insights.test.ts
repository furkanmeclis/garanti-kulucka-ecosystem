import { describe, expect, it, vi } from "vitest";
import type { ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import type { InstagramGraphFetchTransport, InstagramGraphTransportRequest, InstagramGraphTransportResponse } from "../src/providers/instagram-graph.js";
import {
  enqueueInstagramInsights,
  instagramAnalyticsFrom,
  instagramInsightsIntervalMs,
  instagramInsightsJobs,
  type InstagramAnalyticsRepository,
} from "../src/instagram-insights.js";

const now = "2026-10-07T09:00:00.000Z";
const igOrigin = "https://ig-graph.test/v26.0";

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

function igAccount(settings: Record<string, unknown> = {}): ProviderAccountConfigRepository {
  return {
    getAccountConfig: async () => ({
      provider: "instagram",
      account_public_id: "iac_instagram_live",
      live_mode: settings["providers.instagram.live_mode"] !== false,
      tokens: { access_token: "ig-graph-token-secret" },
      settings: { "providers.instagram.live_mode": true, ig_graph_url: igOrigin, ig_user_id: "17841400000000000", ...settings },
    }),
  };
}

const insightsEnvelope: ProviderRequestEnvelope = {
  request_id: "req_instagram_insights_iac_instagram_live_1",
  provider: "instagram",
  operation: "insights.account",
  direction: "outbound",
  channel: "instagram",
  account_public_id: "iac_instagram_live",
  occurred_at: now,
  payload: { days: 45, reason: "scheduled" },
};

const graphInsights = {
  data: [
    { name: "impressions", period: "day", values: [{ value: 120, end_time: "2026-10-05T07:00:00+0000" }, { value: 80, end_time: "2026-10-06T07:00:00+0000" }] },
    { name: "reach", period: "day", values: [{ value: 90, end_time: "2026-10-05T07:00:00+0000" }, { value: 60, end_time: "2026-10-06T07:00:00+0000" }] },
    { name: "profile_views", period: "day", values: [{ value: 7, end_time: "2026-10-06T07:00:00+0000" }] },
  ],
};

function analyticsRepository(): InstagramAnalyticsRepository & { stored: Array<[string, unknown]> } {
  const stored: Array<[string, unknown]> = [];
  return {
    stored,
    store: vi.fn(async (account: string, snapshot: unknown) => {
      stored.push([account, snapshot]);
      return true;
    }),
    activeAccountPublicIds: vi.fn(async () => ["iac_instagram_live", "iac_second"]),
  };
}

async function run(responses: InstagramGraphTransportResponse[], settings: Record<string, unknown> = {}) {
  const captured: InstagramGraphTransportRequest[] = [];
  const persisted: ProviderAttempt[] = [];
  const analytics = analyticsRepository();
  const transport: InstagramGraphFetchTransport = async (request) => {
    captured.push(request);
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return next;
  };
  const registry = createWorkerProcessorRegistry({
    providerAccountConfigRepository: igAccount(settings),
    providerAttemptRepository: attemptRepository(persisted),
    instagramGraphTransport: transport,
    instagramAnalyticsRepository: analytics,
  });
  const result = await registry.dispatch("provider-delivery", deliveryJob(insightsEnvelope) as never).catch((caught: unknown) => caught);
  return { captured, persisted, analytics, result };
}

describe("instagram.insights.account live statistics", () => {
  it("reads followers and 30 days of daily insights like legacy, then stores the account snapshot", async () => {
    const { captured, persisted, analytics, result } = await run([json(200, { followers_count: 1520, media_count: 87, id: "17841400000000000" }), json(200, graphInsights)]);
    expect(result).toMatchObject({ status: "accepted_live", instagram_analytics: "stored" });
    expect(captured.map((request) => request.method)).toEqual(["GET", "GET"]);
    expect(captured[0]?.url).toBe(`${igOrigin}/17841400000000000?fields=followers_count,media_count&access_token=ig-graph-token-secret`);
    const insightsUrl = new URL(captured[1]?.url ?? "");
    expect(insightsUrl.pathname).toBe("/v26.0/17841400000000000/insights");
    expect(insightsUrl.searchParams.get("metric")).toBe("impressions,reach,profile_views");
    expect(insightsUrl.searchParams.get("period")).toBe("day");
    // 45 requested days are clamped to Graph's 30-day window for period=day.
    expect(Number(insightsUrl.searchParams.get("until")) - Number(insightsUrl.searchParams.get("since"))).toBe(30 * 86_400);

    expect(persisted[0]).toMatchObject({ status: "success", operation: "insights.account" });
    expect(JSON.stringify(persisted[0]?.request_metadata)).not.toContain("ig-graph-token-secret");
    expect(analytics.stored).toHaveLength(1);
    expect(analytics.stored[0]?.[0]).toBe("iac_instagram_live");
    expect(analytics.stored[0]?.[1]).toMatchObject({ followers: 1520, media_count: 87, impressions: 200, reach: 150, profile_views: 7, source: "instagram_graph", period: { days: 30 } });
  });

  it("keeps going when the followers lookup fails, but a rejected token fails the job", async () => {
    const partial = await run([json(400, { error: { message: "Unsupported get request", code: 100 } }), json(200, graphInsights)]);
    expect(partial.result).toMatchObject({ status: "accepted_live", instagram_analytics: "stored" });
    expect(partial.analytics.stored[0]?.[1]).toMatchObject({ followers: null, reach: 150 });

    const rejected = await run([json(401, { error: { message: "Invalid OAuth access token", code: 190 } })]);
    expect(rejected.result).toBeInstanceOf(Error);
    expect(rejected.persisted[0]).toMatchObject({ operation: "insights.account" });
    expect(rejected.persisted[0]?.status).not.toBe("success");
    expect(rejected.analytics.stored).toHaveLength(0);
  });

  it("stays a dry run without providers.instagram.live_mode and stores nothing", async () => {
    const { captured, analytics, result } = await run([], { "providers.instagram.live_mode": false });
    expect(result).toMatchObject({ status: "accepted_fixture", live_call_performed: false });
    expect(captured).toHaveLength(0);
    expect(analytics.stored).toHaveLength(0);
  });

  it("maps only successful instagram insights results", () => {
    expect(instagramAnalyticsFrom(insightsEnvelope, { success: true, data: [], followers: null, period: { days: 7, since: 1, until: 2 }, synced_at: now })).toMatchObject({
      accountPublicId: "iac_instagram_live",
      snapshot: { insights: [], followers: null, impressions: 0, synced_at: now, request_id: insightsEnvelope.request_id },
    });
    expect(instagramAnalyticsFrom({ ...insightsEnvelope, operation: "comment.hide" }, { success: true })).toBeNull();
    const { account_public_id: _omit, ...withoutAccount } = insightsEnvelope;
    expect(instagramAnalyticsFrom(withoutAccount, { success: true })).toBeNull();
    expect(instagramAnalyticsFrom(insightsEnvelope, { success: false })).toBeNull();
  });
});

describe("scheduled instagram insights refresh", () => {
  it("enqueues one job per active account per interval bucket", async () => {
    const repository = analyticsRepository();
    const published: Array<{ job_id: string; name: string }> = [];
    const count = await enqueueInstagramInsights({ repository, publish: async (job) => published.push(job), now: new Date(now), intervalMs: 6 * 3_600_000 });
    expect(count).toBe(2);
    expect(published.map((job) => job.name)).toEqual(["instagram.insights.account", "instagram.insights.account"]);
    const sameBucket = instagramInsightsJobs(["iac_instagram_live"], new Date("2026-10-07T11:59:00.000Z"), 6 * 3_600_000);
    expect(sameBucket[0]?.job_id).toBe(published[0]?.job_id);
    const nextBucket = instagramInsightsJobs(["iac_instagram_live"], new Date("2026-10-07T12:00:00.000Z"), 6 * 3_600_000);
    expect(nextBucket[0]?.job_id).not.toBe(published[0]?.job_id);
    expect(sameBucket[0]?.payload).toMatchObject({ envelope: { provider: "instagram", operation: "insights.account", account_public_id: "iac_instagram_live", payload: { days: 30 } } });
  });

  it("reads INSTAGRAM_INSIGHTS_INTERVAL_MS (default 6 h, 0 disables, at least one minute)", () => {
    expect(instagramInsightsIntervalMs({})).toBe(21_600_000);
    expect(instagramInsightsIntervalMs({ INSTAGRAM_INSIGHTS_INTERVAL_MS: "0" })).toBe(0);
    expect(instagramInsightsIntervalMs({ INSTAGRAM_INSIGHTS_INTERVAL_MS: "5" })).toBe(60_000);
    expect(instagramInsightsIntervalMs({ INSTAGRAM_INSIGHTS_INTERVAL_MS: "3600000" })).toBe(3_600_000);
  });
});
