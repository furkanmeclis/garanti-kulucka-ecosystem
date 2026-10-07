import { sql, type AppDatabase } from "@garanti-kulucka/database";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema, type JobEnvelope, type ProviderRequestEnvelope } from "@garanti-kulucka/shared";

/**
 * Live Instagram account statistics (legacy server.js /api/instagram/insights/account, which called
 * Graph on every page view with a short in-memory cache). Here the worker refreshes each active
 * Instagram account on a schedule with `instagram.insights.account` provider-delivery jobs, and a live
 * result is stored as `integration_accounts.metadata.analytics`, the snapshot the API already serves
 * (`/api/instagram/insights/account`, `/admin/integrations/accounts/{id}/analytics-summary`).
 * Dry runs never reach the write-back (only results with `live_call_performed: true`).
 */

export interface InstagramAnalyticsSnapshot {
  insights: unknown[];
  followers: number | null;
  media_count: number | null;
  impressions: number;
  reach: number;
  profile_views: number;
  period: { days: number; since: number; until: number } | null;
  synced_at: string;
  source: "instagram_graph";
  request_id: string;
}

export interface InstagramAnalyticsRepository {
  store: (accountPublicId: string, snapshot: InstagramAnalyticsSnapshot) => Promise<boolean>;
  activeAccountPublicIds: () => Promise<string[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function metricTotal(insights: unknown[], name: string) {
  const metric = insights.find((entry) => isRecord(entry) && entry.name === name);
  if (!isRecord(metric) || !Array.isArray(metric.values)) return 0;
  return metric.values.reduce<number>((sum, entry) => {
    const value = isRecord(entry) ? Number(entry.value) : Number.NaN;
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

export function instagramAnalyticsFrom(envelope: ProviderRequestEnvelope, responsePayload: unknown): { accountPublicId: string; snapshot: InstagramAnalyticsSnapshot } | null {
  if (envelope.provider !== "instagram" || envelope.operation !== "insights.account" || !envelope.account_public_id) return null;
  if (!isRecord(responsePayload) || responsePayload.success !== true) return null;
  const insights = Array.isArray(responsePayload.data) ? responsePayload.data.filter(isRecord) : [];
  const followers = isRecord(responsePayload.followers) ? responsePayload.followers : null;
  const period = isRecord(responsePayload.period) ? responsePayload.period : null;
  return {
    accountPublicId: envelope.account_public_id,
    snapshot: {
      insights,
      followers: followers ? Number(followers.followers_count) || 0 : null,
      media_count: followers ? Number(followers.media_count) || 0 : null,
      impressions: metricTotal(insights, "impressions"),
      reach: metricTotal(insights, "reach"),
      profile_views: metricTotal(insights, "profile_views"),
      period: period ? { days: Number(period.days) || 0, since: Number(period.since) || 0, until: Number(period.until) || 0 } : null,
      synced_at: typeof responsePayload.synced_at === "string" ? responsePayload.synced_at : new Date().toISOString(),
      source: "instagram_graph",
      request_id: envelope.request_id,
    },
  };
}

export class DatabaseInstagramAnalyticsRepository implements InstagramAnalyticsRepository {
  constructor(private readonly db: AppDatabase) {}

  async store(accountPublicId: string, snapshot: InstagramAnalyticsSnapshot): Promise<boolean> {
    // Keeps fields the worker does not compute (e.g. engagement_rate) and a previous follower count
    // when the best-effort followers lookup failed this time.
    const patch = { ...snapshot, ...(snapshot.followers === null ? { followers: undefined, media_count: undefined } : {}) };
    const result = await this.db
      .updateTable("integration_accounts")
      .set({
        metadata: sql`jsonb_set(coalesce(metadata, '{}'::jsonb), '{analytics}', coalesce(metadata->'analytics', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
        updated_at: new Date(),
      })
      .where("public_id", "=", accountPublicId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0) > 0;
  }

  async activeAccountPublicIds(): Promise<string[]> {
    const rows = await this.db
      .selectFrom("integration_accounts")
      .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
      .select("integration_accounts.public_id")
      .where("integration_providers.key", "=", "instagram")
      .where("integration_providers.is_active", "=", true)
      .where("integration_accounts.status", "=", "active")
      .orderBy("integration_accounts.id", "asc")
      .execute();
    return rows.map((row) => row.public_id);
  }
}

/**
 * One `instagram.insights.account` job per active account and interval bucket. The job id carries the
 * bucket, so several worker replicas ticking at once still enqueue each refresh only once.
 */
export function instagramInsightsJobs(accountPublicIds: string[], now: Date, intervalMs: number, days = 30): JobEnvelope[] {
  const bucket = Math.floor(now.getTime() / Math.max(60_000, intervalMs));
  const occurredAt = now.toISOString();
  return accountPublicIds.map((accountPublicId) => {
    const key = `${accountPublicId.replace(/[^A-Za-z0-9_]/g, "_")}_${bucket}`;
    return jobEnvelopeSchema.parse({
      job_id: `job_instagram_insights_${key}`,
      queue: "provider-delivery",
      name: "instagram.insights.account",
      payload: providerDeliveryJobPayloadSchema.parse({
        envelope: {
          request_id: `req_instagram_insights_${key}`,
          provider: "instagram",
          operation: "insights.account",
          direction: "outbound",
          channel: "instagram",
          account_public_id: accountPublicId,
          occurred_at: occurredAt,
          payload: { days, reason: "scheduled" },
          legacy_contract: { source: "server.js GET /api/instagram/insights/account", legacy_event: "instagram_insights_account" },
        },
      }),
      requested_at: occurredAt,
      request_id: `req_instagram_insights_${key}`,
    });
  });
}

export function instagramInsightsIntervalMs(env: NodeJS.ProcessEnv = process.env) {
  const value = Number.parseInt(env.INSTAGRAM_INSIGHTS_INTERVAL_MS ?? "", 10);
  if (!Number.isFinite(value)) return 6 * 60 * 60 * 1000;
  return value <= 0 ? 0 : Math.max(60_000, value);
}

/** Enqueues the current bucket's refresh jobs; failures are reported, never thrown into the timer. */
export async function enqueueInstagramInsights(input: {
  repository: InstagramAnalyticsRepository;
  publish: (job: JobEnvelope) => Promise<unknown>;
  now?: Date;
  intervalMs: number;
}): Promise<number> {
  const accounts = await input.repository.activeAccountPublicIds();
  const jobs = instagramInsightsJobs(accounts, input.now ?? new Date(), input.intervalMs);
  for (const job of jobs) await input.publish(job);
  return jobs.length;
}
