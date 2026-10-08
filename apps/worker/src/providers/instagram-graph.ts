import type { JobEnvelope, ProviderAttempt, ProviderOperation, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptSchema } from "@garanti-kulucka/shared";
import type { ProviderAccountConfig } from "./account-config.js";
import { providerAttemptCorrelationMetadata } from "./correlation.js";
import { InstagramLiveTransportError } from "./instagram.js";
import { MessengerLiveTransportError } from "./messenger.js";
import { failureCode, failureMessage, fetchLiveHttpTransport } from "./live-http.js";
import {
  hasMetaGraphError,
  isMetaRateLimitError,
  isMetaTokenError,
  isRecord,
  metaGraphResponseMetadata,
  parseMetaJson,
  payloadString,
  redactMetaHeaders,
  stringSetting,
  stringToken,
  stringValue,
} from "./meta-graph.js";
import { decideProviderRetry, type ProviderRetryDecision } from "./retry.js";
import type { LiveProviderTransportPolicy } from "./transport-policy.js";

/**
 * Instagram content publishing and comment moderation, reproducing the legacy wire format:
 * - server.js /api/instagram/publish/{photo,video}: POST /{ig_user_id}/media, (video) poll
 *   GET /{creation_id}?fields=status_code, then POST /{ig_user_id}/media_publish.
 * - routes/commentAiRouter.js publicReply / privateReply / hideComment / deleteComment: the
 *   Instagram Graph host first, falling back to the Facebook Graph host on an error response.
 * - server.js /api/instagram/insights/account: GET /{ig_user_id}?fields=followers_count,media_count and
 *   GET /{ig_user_id}/insights?metric=impressions,reach,profile_views&period=day&since&until.
 * - server.js /api/instagram/subscribe-webhook + disconnect and the Messenger ensure-ready /
 *   disconnect flows: POST / DELETE /{id}/subscribed_apps (`webhook.subscribe|unsubscribe`).
 * - server.js Instagram lab + Messenger thread control: GET /{id}/thread_owner?recipient=,
 *   POST /{id}/take_thread_control and /{id}/release_thread_control (`thread.owner|take|release`).
 * The same adapter serves the `messenger` provider for the webhook/thread operations, reading the
 * Page token / Page ID and always calling the Facebook Graph host (legacy GRAPH_API_URL).
 * Legacy sends the token as `access_token` in the JSON body (query string for DELETE/GET); attempt
 * metadata only ever stores redacted copies.
 */

export type InstagramGraphOperation = Extract<
  ProviderOperation,
  | "media.publish"
  | "comment.reply"
  | "comment.private_reply"
  | "comment.hide"
  | "comment.delete"
  | "insights.account"
  | "webhook.subscribe"
  | "webhook.unsubscribe"
  | "thread.owner"
  | "thread.take"
  | "thread.release"
>;

export const instagramGraphOperations: readonly InstagramGraphOperation[] = [
  "media.publish",
  "comment.reply",
  "comment.private_reply",
  "comment.hide",
  "comment.delete",
  "insights.account",
  "webhook.subscribe",
  "webhook.unsubscribe",
  "thread.owner",
  "thread.take",
  "thread.release",
];

/** Operations the adapter also runs for the `messenger` provider (Page token + Facebook Graph host). */
export const metaPageGraphOperations: readonly InstagramGraphOperation[] = [
  "webhook.subscribe",
  "webhook.unsubscribe",
  "thread.owner",
  "thread.take",
  "thread.release",
];

export function isMetaPageGraphOperation(operation: ProviderOperation): operation is InstagramGraphOperation {
  return (metaPageGraphOperations as readonly string[]).includes(operation);
}

export type InstagramGraphEndpoint =
  | "media"
  | "media_status"
  | "media_publish"
  | "comment_replies"
  | "comment_private_reply"
  | "comment_hide"
  | "comment_delete"
  | "account_fields"
  | "account_insights"
  | "subscribed_apps"
  | "thread_owner"
  | "take_thread_control"
  | "release_thread_control";

export interface InstagramGraphTransportRequest {
  method: "GET" | "POST" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeout_ms: number;
  instagram_endpoint: InstagramGraphEndpoint;
}

export interface InstagramGraphTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type InstagramGraphFetchTransport = (
  request: InstagramGraphTransportRequest,
) => Promise<InstagramGraphTransportResponse>;

export interface InstagramGraphLiveAdapterInput {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  accountConfig: ProviderAccountConfig;
  policy: LiveProviderTransportPolicy;
  attemptNumber: number;
  maxAttempts: number;
  transport?: InstagramGraphFetchTransport;
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
}

export interface InstagramGraphLiveAdapterResult {
  attempt: ProviderAttempt;
  response_payload: Record<string, unknown>;
}

const defaultFacebookGraphUrl = "https://graph.facebook.com/v26.0";
const defaultInstagramGraphUrl = "https://graph.instagram.com/v26.0";
const redacted = "[redacted]";

export function isInstagramGraphOperation(operation: ProviderOperation): operation is InstagramGraphOperation {
  return (instagramGraphOperations as readonly string[]).includes(operation);
}

function graphUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

interface InstagramGraphCredentials {
  igGraphUrl: string;
  fbGraphUrl: string;
  igUserId: string;
  accessToken: string;
}

function credentials(accountConfig: ProviderAccountConfig, provider: string): InstagramGraphCredentials {
  const { settings, tokens } = accountConfig;
  if (provider === "messenger") {
    const pageToken = stringToken(
      tokens,
      ["page_access_token", "MESSENGER_PAGE_ACCESS_TOKEN", "access_token", "token"],
      stringSetting(settings, ["page_access_token", "MESSENGER_PAGE_ACCESS_TOKEN", "access_token", "token"]),
    );
    const pageId = stringSetting(
      settings,
      ["page_id", "messenger.page_id", "MESSENGER_PAGE_ID"],
      stringToken(tokens, ["page_id", "messenger.page_id", "MESSENGER_PAGE_ID"]),
    );
    const pageGraphUrl = graphUrl(
      stringSetting(settings, ["graph_url", "messenger.graph_url", "api_url", "messenger.api_url", "GRAPH_API_URL"]) || defaultFacebookGraphUrl,
    );
    return { igGraphUrl: pageGraphUrl, fbGraphUrl: pageGraphUrl, igUserId: pageId, accessToken: pageToken };
  }
  const accessToken = stringToken(
    tokens,
    ["access_token", "INSTAGRAM_ACCESS_TOKEN", "token"],
    stringSetting(settings, ["access_token", "INSTAGRAM_ACCESS_TOKEN", "token"]),
  );
  const igUserId = stringSetting(
    settings,
    ["ig_user_id", "instagram.ig_user_id", "page_id", "INSTAGRAM_PAGE_ID"],
    stringToken(tokens, ["ig_user_id", "instagram.ig_user_id", "page_id", "INSTAGRAM_PAGE_ID"]),
  );
  const configuredIgGraph = stringSetting(settings, ["ig_graph_url", "instagram.ig_graph_url", "IG_GRAPH_API_URL"]);
  const configuredApiUrl = stringSetting(settings, ["api_url", "instagram.api_url", "INSTAGRAM_API_URL"]);
  const configuredFbGraph = stringSetting(settings, ["graph_url", "instagram.graph_url", "GRAPH_API_URL"]);
  const igGraphUrl = graphUrl(configuredIgGraph || configuredApiUrl || defaultInstagramGraphUrl);
  // Never fall back to the public Facebook host when only a custom api_url is configured.
  const fbGraphUrl = graphUrl(configuredFbGraph || configuredApiUrl || defaultFacebookGraphUrl);
  return { igGraphUrl, fbGraphUrl, igUserId, accessToken };
}

function idempotencyKey(envelope: ProviderRequestEnvelope): string | null {
  return typeof envelope.payload.idempotency_key === "string" ? envelope.payload.idempotency_key : null;
}

function jsonRequest(
  base: string,
  path: string,
  body: Record<string, unknown>,
  endpoint: InstagramGraphEndpoint,
  policy: LiveProviderTransportPolicy,
): InstagramGraphTransportRequest {
  return {
    method: "POST",
    url: `${base}${path}`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeout_ms: policy.timeout_ms,
    instagram_endpoint: endpoint,
  };
}

function queryTokenRequest(
  method: "GET" | "DELETE",
  base: string,
  path: string,
  query: string,
  accessToken: string,
  endpoint: InstagramGraphEndpoint,
  policy: LiveProviderTransportPolicy,
): InstagramGraphTransportRequest {
  const separator = query ? `${query}&` : "";
  return {
    method,
    url: `${base}${path}?${separator}access_token=${encodeURIComponent(accessToken)}`,
    headers: {},
    body: "",
    timeout_ms: policy.timeout_ms,
    instagram_endpoint: endpoint,
  };
}

function redactBody(body: string): unknown {
  if (!body) return null;
  const parsed = parseMetaJson(body);
  if (!parsed) return "[unparseable-json]";
  return Object.hasOwn(parsed, "access_token") ? { ...parsed, access_token: redacted } : parsed;
}

function redactRequest(request: InstagramGraphTransportRequest): Record<string, unknown> {
  const url = new URL(request.url);
  const query = Object.fromEntries(
    [...url.searchParams.entries()].map(([key, value]) => [key, key === "access_token" ? redacted : value]),
  );
  return {
    method: request.method,
    meta_provider: request.url.includes("/thread_") || request.url.includes("/subscribed_apps") ? "meta-page" : "instagram",
    instagram_endpoint: request.instagram_endpoint,
    origin: url.origin,
    path: url.pathname,
    ...(Object.keys(query).length > 0 ? { query } : {}),
    headers: redactMetaHeaders(request.headers),
    body_bytes: Buffer.byteLength(request.body, "utf8"),
    body: redactBody(request.body),
    timeout_ms: request.timeout_ms,
  };
}

function retryMetadata(decision: ProviderRetryDecision): Record<string, unknown> {
  return {
    reason: decision.reason,
    attempts_remaining: decision.attempts_remaining,
    retry_delay_ms: decision.retry_delay_ms,
    error_retryable: decision.error_retryable,
  };
}

function retryDecision(
  input: InstagramGraphLiveAdapterInput,
  endedAt: Date,
  statusCode?: number | null,
  errorCode?: string,
): ProviderRetryDecision {
  return decideProviderRetry(
    {
      operation: input.envelope.operation,
      ...(typeof statusCode === "number" ? { status_code: statusCode } : {}),
      ...(errorCode ? { error_code: errorCode } : {}),
      attempt_number: input.attemptNumber,
      max_attempts: input.maxAttempts,
      idempotency_key: idempotencyKey(input.envelope),
    },
    endedAt,
  );
}

interface GraphCallRecord {
  request: InstagramGraphTransportRequest;
  response: InstagramGraphTransportResponse | null;
}

function callsMetadata(calls: GraphCallRecord[]): Array<Record<string, unknown>> {
  return calls.map((call) => ({
    request: redactRequest(call.request),
    response: call.response ? metaGraphResponseMetadata(call.response) : { live_call_performed: true, accepted: false },
  }));
}

function createAttempt(input: {
  adapter: InstagramGraphLiveAdapterInput;
  startedAt: Date;
  endedAt: Date;
  statusCode: number | null;
  decision: ProviderRetryDecision | null;
  calls: GraphCallRecord[];
  error: ProviderAttempt["error"];
}): ProviderAttempt {
  const { envelope, job } = input.adapter;
  const last = input.calls[input.calls.length - 1];
  return providerAttemptSchema.parse({
    provider: envelope.provider,
    operation: envelope.operation,
    direction: envelope.direction,
    request_id: envelope.request_id,
    account_public_id: envelope.account_public_id,
    started_at: input.startedAt.toISOString(),
    duration_ms: Math.max(0, input.endedAt.getTime() - input.startedAt.getTime()),
    status: input.decision ? input.decision.status : "success",
    status_code: input.statusCode,
    retry_decision: input.decision ? input.decision.retry_decision : "none",
    next_retry_at: input.decision ? input.decision.next_retry_at : null,
    idempotency_key: idempotencyKey(envelope),
    request_metadata: {
      ...providerAttemptCorrelationMetadata(job, envelope),
      queue: job.queue,
      channel: envelope.channel,
      live_call_performed: input.calls.length > 0,
      transport: "instagram-graph",
      ...(last ? { request: redactRequest(last.request) } : {}),
      graph_calls: callsMetadata(input.calls),
      ...(input.decision ? { retry: retryMetadata(input.decision) } : {}),
    },
    response_metadata: last?.response
      ? metaGraphResponseMetadata(last.response)
      : { live_call_performed: input.calls.length > 0, accepted: false },
    error: input.error,
  });
}

async function defaultInstagramGraphFetchTransport(
  request: InstagramGraphTransportRequest,
): Promise<InstagramGraphTransportResponse> {
  return fetchLiveHttpTransport(request, "Instagram");
}

class GraphCallFailure extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
    readonly statusCode: number | null,
  ) {
    super(message);
  }
}

function graphFailure(response: InstagramGraphTransportResponse, parsed: Record<string, unknown> | null): GraphCallFailure | null {
  if (isMetaTokenError(response, parsed)) {
    return new GraphCallFailure("Instagram access token was rejected by Meta", "instagram_token_error", 401);
  }
  if (isMetaRateLimitError(response, parsed)) {
    return new GraphCallFailure("Instagram Graph API rate limit was reached", "graph_rate_limit", response.status);
  }
  if (response.status >= 400 || hasMetaGraphError(parsed)) {
    return new GraphCallFailure(`Instagram returned HTTP ${response.status}`, "provider_http_error", response.status);
  }
  return null;
}

class GraphSession {
  readonly calls: GraphCallRecord[] = [];

  constructor(private readonly transport: InstagramGraphFetchTransport) {}

  async call(request: InstagramGraphTransportRequest): Promise<Record<string, unknown> | null> {
    const record: GraphCallRecord = { request, response: null };
    this.calls.push(record);
    let response: InstagramGraphTransportResponse;
    try {
      response = await this.transport(request);
    } catch (error) {
      throw new GraphCallFailure(failureMessage(error, "Instagram transport failed"), failureCode(error), null);
    }
    record.response = response;
    const parsed = parseMetaJson(response.body);
    const failure = graphFailure(response, parsed);
    if (failure) throw failure;
    return parsed;
  }

  /** Legacy commentAiRouter: try the Instagram host, on an error response retry on the Facebook host. */
  async callWithHostFallback(
    creds: InstagramGraphCredentials,
    build: (base: string) => InstagramGraphTransportRequest,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await this.call(build(creds.igGraphUrl));
    } catch (error) {
      const respondedWithError =
        error instanceof GraphCallFailure && error.statusCode !== null && this.calls.at(-1)?.response;
      if (!respondedWithError || creds.fbGraphUrl === creds.igGraphUrl) throw error;
      return this.call(build(creds.fbGraphUrl));
    }
  }
}

function numberSetting(settings: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = Number(settings[key]);
    if (settings[key] !== undefined && settings[key] !== "" && Number.isFinite(value) && value >= 0) return value;
  }
  return fallback;
}

function requirePayload(value: string, name: string): string {
  if (!value) throw new GraphCallFailure(`Instagram ${name} is required`, "invalid_payload", null);
  return value;
}

async function publishMedia(
  input: InstagramGraphLiveAdapterInput,
  session: GraphSession,
  creds: InstagramGraphCredentials,
): Promise<Record<string, unknown>> {
  const payload = input.envelope.payload;
  const policy = input.policy;
  const igUserId = requirePayload(creds.igUserId, "ig_user_id");
  const caption = payloadString(payload, ["caption"]);
  if (caption.length > 2200) {
    throw new GraphCallFailure("Caption 2200 karakterden uzun olamaz", "invalid_payload", null);
  }
  const videoUrl = payloadString(payload, ["video_url"]);
  const imageUrl = payloadString(payload, ["image_url"]);
  const isVideo = videoUrl.length > 0;
  if (!isVideo) requirePayload(imageUrl, "image_url");

  const containerBody: Record<string, unknown> = isVideo
    ? {
        media_type: payloadString(payload, ["media_type"], "REELS"),
        video_url: videoUrl,
        caption: caption || "",
        access_token: creds.accessToken,
      }
    : { image_url: imageUrl, caption: caption || "", access_token: creds.accessToken };
  const container = await session.call(
    jsonRequest(creds.igGraphUrl, `/${igUserId}/media`, containerBody, "media", policy),
  );
  const creationId = stringValue(container?.id);
  if (!creationId) throw new GraphCallFailure("Container olusturulamadi", "malformed_response", 200);

  if (isVideo) {
    const settings = input.accountConfig.settings;
    const interval = numberSetting(settings, ["publish_poll_interval_ms", "instagram.publish_poll_interval_ms"], 5_000);
    const maxPolls = Math.max(1, numberSetting(settings, ["publish_max_polls", "instagram.publish_max_polls"], 30));
    const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let statusCode = "IN_PROGRESS";
    let tries = 0;
    while (statusCode === "IN_PROGRESS" && tries < maxPolls) {
      await sleep(interval);
      tries++;
      const status = await session.call(
        queryTokenRequest("GET", creds.igGraphUrl, `/${creationId}`, "fields=status_code", creds.accessToken, "media_status", policy),
      );
      statusCode = stringValue(status?.status_code) || "ERROR";
    }
    if (statusCode !== "FINISHED") {
      throw new GraphCallFailure(`Container hazirlanamadi: ${statusCode}`, "media_container_not_ready", null);
    }
  }

  const published = await session.call(
    jsonRequest(
      creds.igGraphUrl,
      `/${igUserId}/media_publish`,
      { creation_id: creationId, access_token: creds.accessToken },
      "media_publish",
      policy,
    ),
  );
  const mediaId = stringValue(published?.id);
  if (!mediaId) throw new GraphCallFailure("Yayinlama basarisiz", "malformed_response", 200);
  return { success: true, media_id: mediaId, creation_id: creationId };
}

async function commentAction(
  input: InstagramGraphLiveAdapterInput,
  session: GraphSession,
  creds: InstagramGraphCredentials,
): Promise<Record<string, unknown>> {
  const payload = input.envelope.payload;
  const policy = input.policy;
  const commentId = requirePayload(payloadString(payload, ["comment_id"]), "comment_id");
  const text = payloadString(payload, ["message", "text"]).trim();

  switch (input.envelope.operation) {
    case "comment.reply": {
      requirePayload(text, "reply message");
      const data = await session.callWithHostFallback(creds, (base) =>
        jsonRequest(base, `/${commentId}/replies`, { message: text, access_token: creds.accessToken }, "comment_replies", policy),
      );
      return { success: true, data, reply_id: stringValue(data?.id) || null };
    }
    case "comment.private_reply": {
      requirePayload(text, "reply message");
      const igUserId = requirePayload(creds.igUserId || payloadString(payload, ["ig_account_id"]), "ig_user_id");
      const data = await session.callWithHostFallback(creds, (base) =>
        jsonRequest(
          base,
          `/${igUserId}/messages`,
          { recipient: { comment_id: commentId }, message: { text }, access_token: creds.accessToken },
          "comment_private_reply",
          policy,
        ),
      );
      return { success: true, data, message_sent: true };
    }
    case "comment.hide": {
      const data = await session.callWithHostFallback(creds, (base) =>
        jsonRequest(base, `/${commentId}`, { hide: true, access_token: creds.accessToken }, "comment_hide", policy),
      );
      return { success: true, data, hidden: true };
    }
    case "comment.delete": {
      const data = await session.callWithHostFallback(creds, (base) =>
        queryTokenRequest("DELETE", base, `/${commentId}`, "", creds.accessToken, "comment_delete", policy),
      );
      return { success: true, data, deleted: true };
    }
    default:
      throw new Error(`Unsupported Instagram comment operation: ${input.envelope.operation}`);
  }
}

const defaultSubscribedFields = ["messages", "messaging_postbacks", "message_reactions", "comments", "live_comments"];
const defaultMessengerSubscribedFields = [
  "messages",
  "messaging_postbacks",
  "messaging_optins",
  "messaging_referrals",
  "message_deliveries",
  "message_reads",
  "messaging_handovers",
  "feed",
];

/** Legacy subscribe-webhook / disconnect: POST or DELETE /{id}/subscribed_apps, then list the subscriptions. */
async function webhookSubscription(
  input: InstagramGraphLiveAdapterInput,
  session: GraphSession,
  creds: InstagramGraphCredentials,
): Promise<Record<string, unknown>> {
  const policy = input.policy;
  const id = requirePayload(creds.igUserId, input.envelope.provider === "messenger" ? "page_id" : "ig_user_id");
  requirePayload(creds.accessToken, "access_token");
  if (input.envelope.operation === "webhook.unsubscribe") {
    const data = await session.callWithHostFallback(creds, (base) =>
      queryTokenRequest("DELETE", base, `/${id}/subscribed_apps`, "", creds.accessToken, "subscribed_apps", policy),
    );
    return { success: true, subscribed: false, data };
  }
  const requested = Array.isArray(input.envelope.payload.subscribed_fields)
    ? input.envelope.payload.subscribed_fields.map(stringValue).filter((field) => /^[a-z_]+$/.test(field))
    : [];
  const fields = requested.length > 0
    ? requested
    : input.envelope.provider === "messenger" ? defaultMessengerSubscribedFields : defaultSubscribedFields;
  const data = await session.call(
    jsonRequest(creds.igGraphUrl, `/${id}/subscribed_apps`, { subscribed_fields: fields, access_token: creds.accessToken }, "subscribed_apps", policy),
  );
  if (data?.success !== true) throw new GraphCallFailure("Subscription basarisiz", "malformed_response", 200);
  const listed = await session.call(
    queryTokenRequest("GET", creds.igGraphUrl, `/${id}/subscribed_apps`, "", creds.accessToken, "subscribed_apps", policy),
  );
  return { success: true, subscribed: true, subscribed_fields: fields, subscriptions: Array.isArray(listed?.data) ? listed.data : [] };
}

function threadOwnerFrom(data: Record<string, unknown> | null): { app_id: string | null; expiration: string | null } {
  const first = Array.isArray(data?.data) && isRecord(data.data[0]) ? data.data[0] : data;
  const owner = isRecord(first?.thread_owner) ? first.thread_owner : null;
  return { app_id: stringValue(owner?.app_id) || null, expiration: stringValue(owner?.expiration) || null };
}

/** Legacy Handover Protocol helpers: thread_owner lookup, take_thread_control, release_thread_control. */
async function threadControl(
  input: InstagramGraphLiveAdapterInput,
  session: GraphSession,
  creds: InstagramGraphCredentials,
): Promise<Record<string, unknown>> {
  const policy = input.policy;
  const id = requirePayload(creds.igUserId, input.envelope.provider === "messenger" ? "page_id" : "ig_user_id");
  requirePayload(creds.accessToken, "access_token");
  const recipient = requirePayload(payloadString(input.envelope.payload, ["recipient_id", "psid"]), "recipient_id");
  if (input.envelope.operation === "thread.owner") {
    const data = await session.call(
      queryTokenRequest("GET", creds.igGraphUrl, `/${id}/thread_owner`, `recipient=${encodeURIComponent(recipient)}`, creds.accessToken, "thread_owner", policy),
    );
    return { success: true, recipient_id: recipient, thread_owner: threadOwnerFrom(data), data };
  }
  const take = input.envelope.operation === "thread.take";
  const metadata = payloadString(input.envelope.payload, ["metadata"], take ? "garanti_kulucka_panel" : "garanti_kulucka_lab_release");
  const data = await session.call(
    jsonRequest(
      creds.igGraphUrl,
      `/${id}/${take ? "take_thread_control" : "release_thread_control"}`,
      { recipient: { id: recipient }, metadata, access_token: creds.accessToken },
      take ? "take_thread_control" : "release_thread_control",
      policy,
    ),
  );
  return { success: true, recipient_id: recipient, action: take ? "take" : "release", data };
}

const defaultInsightMetrics = "impressions,reach,profile_views";

/**
 * Legacy account insights: followers/media count (best effort, as in legacy) and daily metrics for the
 * last `days` days. Graph caps a `period=day` window at 30 days.
 */
async function accountInsights(
  input: InstagramGraphLiveAdapterInput,
  session: GraphSession,
  creds: InstagramGraphCredentials,
  startedAt: Date,
): Promise<Record<string, unknown>> {
  const policy = input.policy;
  const igUserId = requirePayload(creds.igUserId, "ig_user_id");
  const requestedDays = Math.trunc(Number(input.envelope.payload.days ?? 30));
  const days = Math.min(30, Math.max(1, Number.isFinite(requestedDays) ? requestedDays : 30));
  const metrics = stringSetting(input.accountConfig.settings, ["insights_metrics", "instagram.insights_metrics"], defaultInsightMetrics)
    .split(",")
    .map((metric) => metric.trim())
    .filter((metric) => /^[a-z_]+$/.test(metric))
    .join(",") || defaultInsightMetrics;

  let followers: { followers_count: number; media_count: number } | null = null;
  try {
    const fields = await session.call(
      queryTokenRequest("GET", creds.igGraphUrl, `/${igUserId}`, "fields=followers_count,media_count", creds.accessToken, "account_fields", policy),
    );
    followers = { followers_count: Number(fields?.followers_count ?? 0) || 0, media_count: Number(fields?.media_count ?? 0) || 0 };
  } catch (error) {
    // Legacy swallowed this lookup; a rejected token still fails the whole job.
    if (!(error instanceof GraphCallFailure) || error.errorCode === "instagram_token_error") throw error;
  }

  const until = Math.floor(startedAt.getTime() / 1000);
  const since = until - days * 86_400;
  const insights = await session.call(
    queryTokenRequest(
      "GET",
      creds.igGraphUrl,
      `/${igUserId}/insights`,
      `metric=${metrics}&period=day&since=${since}&until=${until}`,
      creds.accessToken,
      "account_insights",
      policy,
    ),
  );
  const data = Array.isArray(insights?.data) ? insights.data : [];
  return { success: true, data, followers, period: { days, since, until }, synced_at: startedAt.toISOString() };
}

export async function sendInstagramGraphLiveRequest(
  input: InstagramGraphLiveAdapterInput,
): Promise<InstagramGraphLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  if (!isInstagramGraphOperation(input.envelope.operation)) {
    throw new Error(`Unsupported Instagram Graph operation: ${input.envelope.operation}`);
  }

  if (input.envelope.provider === "messenger" && !isMetaPageGraphOperation(input.envelope.operation)) {
    throw new Error(`Unsupported Messenger Graph operation: ${input.envelope.operation}`);
  }

  const creds = credentials(input.accountConfig, input.envelope.provider);
  const session = new GraphSession(input.transport ?? defaultInstagramGraphFetchTransport);
  const TransportError = input.envelope.provider === "messenger" ? MessengerLiveTransportError : InstagramLiveTransportError;
  let payload: Record<string, unknown>;
  try {
    payload = input.envelope.operation === "media.publish"
      ? await publishMedia(input, session, creds)
      : input.envelope.operation === "insights.account"
        ? await accountInsights(input, session, creds, startedAt)
        : input.envelope.operation === "webhook.subscribe" || input.envelope.operation === "webhook.unsubscribe"
          ? await webhookSubscription(input, session, creds)
          : input.envelope.operation.startsWith("thread.")
            ? await threadControl(input, session, creds)
            : await commentAction(input, session, creds);
  } catch (error) {
    if (!(error instanceof GraphCallFailure)) throw error;
    const endedAt = input.now ? new Date(input.now) : new Date();
    const decision = retryDecision(
      input,
      endedAt,
      error.statusCode,
      error.statusCode === null || error.errorCode === "malformed_response" || error.errorCode === "graph_rate_limit"
        ? error.errorCode
        : undefined,
    );
    const lastResponse = session.calls.at(-1)?.response ?? null;
    throw new TransportError(
      error.message,
      createAttempt({
        adapter: input,
        startedAt,
        endedAt,
        statusCode: lastResponse?.status ?? null,
        decision,
        calls: session.calls,
        error: { code: error.errorCode, message: error.message },
      }),
    );
  }

  const endedAt = input.now ? new Date(input.now) : new Date();
  return {
    response_payload: isRecord(payload) ? payload : { success: true },
    attempt: createAttempt({
      adapter: input,
      startedAt,
      endedAt,
      statusCode: session.calls.at(-1)?.response?.status ?? null,
      decision: null,
      calls: session.calls,
      error: null,
    }),
  };
}
