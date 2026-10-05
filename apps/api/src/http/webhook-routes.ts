import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { createStructuredLog, type ProviderName } from "@garanti-kulucka/shared";
import type { AppDatabase } from "@garanti-kulucka/database";
import type { AppBindings } from "./types.js";
import { DatabaseWebhookEventRepository, type StoredWebhookEvent, type WebhookEventRepository } from "../webhooks/repository.js";
import { hashWebhookPayload } from "../webhooks/payload-hash.js";
import {
  inferEventType,
  inferExternalEventId,
  parseWebhookBody,
  pickFirstString,
  readPath,
} from "../webhooks/payload.js";
import { buildWebhookJob, noopWebhookQueuePublisher, type WebhookQueuePublisher } from "../webhooks/queue-publisher.js";
import { providerWebhookRoutes, type WebhookProvider } from "../webhooks/provider-routing.js";
import { clientIp, rateLimit } from "./rate-limit.js";
import type { EncryptedJsonEnvelope } from "../security/encryption.js";

export interface CreateWebhookRoutesOptions {
  repository?: WebhookEventRepository;
  queuePublisher?: WebhookQueuePublisher;
  signaturePolicyResolver?: (input: {
    context: Context<AppBindings>;
    providerId: number;
    accountId: number | null;
    provider: WebhookProvider;
  }) => Promise<WebhookSignaturePolicy>;
}

function getRepository(context: Context<AppBindings>, override?: WebhookEventRepository) {
  if (override) {
    return override;
  }

  const db = context.get("db");
  if (!db) {
    return null;
  }

  return new DatabaseWebhookEventRepository(db);
}

function resolveAccountPublicId(body: unknown, queryValue: string | undefined): string | null {
  return pickFirstString(
    queryValue,
    readPath(body, ["account_public_id"]),
    readPath(body, ["account", "public_id"]),
    readPath(body, ["metadata", "account_public_id"]),
  );
}

function acceptedResponse(input: {
  provider: ProviderName;
  eventPublicId: string;
  payloadHash: string;
  queuedJobId: string | null;
}) {
  return {
    status: "accepted",
    provider: input.provider,
    event_public_id: input.eventPublicId,
    payload_hash: input.payloadHash,
    queued: Boolean(input.queuedJobId),
    job_id: input.queuedJobId,
  };
}

function sanitizedQuery(url: string) {
  const sensitiveQueryKeys = new Set(["verify_token", "hub.verify_token", "token", "secret"]);
  return Object.fromEntries(
    [...new URL(url).searchParams.entries()].filter(([key]) => !sensitiveQueryKeys.has(key)),
  );
}

const metaSignatureProviders = new Set<WebhookProvider>(["meta", "instagram", "messenger", "whatsapp"]);
const replayWindowMs = 5 * 60 * 1000;
export type SignatureMode = "off" | "report_only" | "enforce";

interface AcceptedWebhookResponse {
  body: ReturnType<typeof acceptedResponse>;
  status: 202;
}

export interface WebhookSignaturePolicy {
  mode: SignatureMode;
  secret: string | null;
}

function isDuplicateKeyError(error: unknown) {
  return (
    error instanceof Error &&
    ("code" in error ? (error as { code?: unknown }).code === "23505" : /duplicate key|unique/i.test(error.message))
  );
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyMetaSignature(input: { rawBody: string; signature: string | undefined; secret: string | undefined }) {
  if (!input.signature || !input.secret) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", input.secret).update(input.rawBody).digest("hex")}`;
  return safeEqual(input.signature, expected);
}

function verifySharedToken(input: { token: string | undefined; secret: string | undefined }) {
  if (!input.token || !input.secret) {
    return false;
  }

  return safeEqual(input.token, input.secret);
}

class WebhookReplayCache {
  private readonly entries = new Map<string, { expiresAt: number; response: AcceptedWebhookResponse }>();

  get(key: string, now: number) {
    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(entryKey);
      }
    }

    return this.entries.get(key)?.response ?? null;
  }

  set(key: string, now: number, windowMs: number, response: AcceptedWebhookResponse) {
    this.entries.set(key, { expiresAt: now + windowMs, response });
  }
}

function encryptedSettingValue(value: unknown) {
  return (
    value &&
    typeof value === "object" &&
    (value as { alg?: unknown }).alg === "aes-256-gcm"
  );
}

function settingStringValue(context: Context<AppBindings>, value: unknown, isSecret: boolean) {
  const resolved = isSecret && encryptedSettingValue(value)
    ? context.get("encryptor").decryptJson(value as EncryptedJsonEnvelope)
    : value;
  return typeof resolved === "string" && resolved.trim().length > 0 ? resolved : null;
}

async function getWebhookSignaturePolicy(input: {
  context: Context<AppBindings>;
  db: AppDatabase;
  providerId: number;
  accountId: number | null;
  provider: WebhookProvider;
}): Promise<WebhookSignaturePolicy> {
  const secretKeys = metaSignatureProviders.has(input.provider)
    ? ["webhook.app_secret", "app_secret"]
    : ["webhook.shared_token"];
  const keys = [...secretKeys, "webhook.signature_mode"];
  const settings = await input.db
    .selectFrom("integration_settings")
    .select(["key", "value", "is_secret", "account_id"])
    .where("provider_id", "=", input.providerId)
    .where("key", "in", keys)
    .where((builder) =>
      input.accountId
        ? builder.or([builder("account_id", "=", input.accountId), builder("account_id", "is", null)])
        : builder("account_id", "is", null),
    )
    .orderBy("account_id", "desc")
    .execute();

  const byKey = new Map<string, { value: unknown; is_secret: boolean }>();
  for (const setting of settings) {
    if (!byKey.has(setting.key)) {
      byKey.set(setting.key, { value: setting.value, is_secret: setting.is_secret });
    }
  }

  const secret = secretKeys
    .map((key) => {
      const setting = byKey.get(key);
      return setting ? settingStringValue(input.context, setting.value, setting.is_secret) : null;
    })
    .find((value): value is string => Boolean(value)) ?? null;
  const modeSetting = byKey.get("webhook.signature_mode");
  const configuredMode = modeSetting ? settingStringValue(input.context, modeSetting.value, modeSetting.is_secret) : null;
  const mode = configuredMode === "off" || configuredMode === "report_only" || configuredMode === "enforce"
    ? configuredMode
    : secret
      ? "enforce"
      : "off";

  return { mode, secret };
}

function logSignatureWarning(input: {
  context: Context<AppBindings>;
  provider: WebhookProvider;
  accountPublicId: string | null;
  mode: SignatureMode;
  reason: "missing_secret" | "invalid_signature";
}) {
  input.context.get("logger").warn(
    createStructuredLog({
      level: "warn",
      service: "api",
      event: "webhook.signature_unverified",
      request_id: input.context.get("requestId"),
      msg: "Webhook signature was not enforced",
      context: {
        provider: input.provider,
        account_public_id: input.accountPublicId,
        signature_mode: input.mode,
        reason: input.reason,
      },
    }),
    "Webhook signature was not enforced",
  );
}

function signatureMatches(input: {
  provider: WebhookProvider;
  rawBody: string;
  metaSignature: string | undefined;
  sharedToken: string | undefined;
  secret: string;
}) {
  return metaSignatureProviders.has(input.provider)
    ? verifyMetaSignature({
        rawBody: input.rawBody,
        signature: input.metaSignature,
        secret: input.secret,
      })
    : verifySharedToken({ token: input.sharedToken, secret: input.secret });
}

function acceptedWebhookResponse(input: {
  provider: ProviderName;
  eventPublicId: string;
  payloadHash: string;
  queuedJobId: string | null;
}): AcceptedWebhookResponse {
  return {
    body: acceptedResponse(input),
    status: 202,
  };
}

function responseFromStoredEvent(event: StoredWebhookEvent): AcceptedWebhookResponse {
  return acceptedWebhookResponse({
    provider: event.provider_key,
    eventPublicId: event.public_id,
    payloadHash: event.payload_hash,
    queuedJobId: null,
  });
}

export function createWebhookRoutes(options: CreateWebhookRoutesOptions = {}) {
  const routes = new Hono<AppBindings>();
  const queuePublisher = options.queuePublisher ?? noopWebhookQueuePublisher;
  const replayCache = new WebhookReplayCache();

  for (const callback of providerWebhookRoutes) {
    routes.get(callback.path, async (context) => {
      const repository = getRepository(context, options.repository);
      if (!repository) {
        return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
      }

      const mode = context.req.query("hub.mode") ?? context.req.query("mode") ?? null;
      const challenge = context.req.query("hub.challenge") ?? context.req.query("challenge") ?? null;
      const verifyToken = context.req.query("hub.verify_token") ?? context.req.query("verify_token") ?? null;
      const accountPublicId = context.req.query("account_public_id") ?? null;

      const resolution = await repository.resolve({
        provider: callback.provider,
        accountPublicId,
        verifyToken,
        callbackPath: `/webhooks${callback.path}`,
      });

      if (!resolution.verifyTokenMatched) {
        return context.json({ error: { code: "webhook_verification_failed", message: "Webhook verification failed" } }, 403);
      }

      if (challenge) {
        return context.text(challenge);
      }

      return context.json({
        status: "ok",
        provider: callback.provider,
        mode,
        verification: resolution.verifyTokenRequired ? "verified" : "not_configured",
      });
    });

    routes.post(
      callback.path,
      rateLimit({
        namespace: `webhook:${callback.provider}`,
        limit: (context) => context.get("config").webhookRateLimitPerMinute ?? 600,
        windowMs: 60_000,
        key: (context) => clientIp(context),
      }),
      async (context) => {
        const repository = getRepository(context, options.repository);
        const db = context.get("db");
        if (!repository || (!db && !options.signaturePolicyResolver)) {
          return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
        }

        const rawBody = await context.req.text();
        let body: unknown;
        try {
          body = parseWebhookBody(rawBody, context.req.header("content-type") ?? null);
        } catch {
          return context.json({ error: { code: "invalid_payload", message: "Webhook payload is not valid JSON" } }, 400);
        }

        const accountPublicId = resolveAccountPublicId(body, context.req.query("account_public_id"));
        const verifyToken = context.req.query("verify_token") ?? context.req.header("x-webhook-token") ?? null;
        const resolution = await repository.resolve({
          provider: callback.provider,
          accountPublicId,
          verifyToken,
          callbackPath: `/webhooks${callback.path}`,
        });

        if (!resolution.verifyTokenMatched) {
          return context.json({ error: { code: "webhook_verification_failed", message: "Webhook verification failed" } }, 403);
        }

        const policy = options.signaturePolicyResolver
          ? await options.signaturePolicyResolver({
              context,
              providerId: resolution.providerId,
              accountId: resolution.accountId,
              provider: callback.provider,
            })
          : await getWebhookSignaturePolicy({
              context,
              db: db as AppDatabase,
              providerId: resolution.providerId,
              accountId: resolution.accountId,
              provider: callback.provider,
            });
        if (!policy.secret) {
          logSignatureWarning({
            context,
            provider: callback.provider,
            accountPublicId: resolution.accountPublicId,
            mode: policy.mode,
            reason: "missing_secret",
          });
        } else {
          const matches = signatureMatches({
            provider: callback.provider,
            rawBody,
            metaSignature: context.req.header("x-hub-signature-256"),
            sharedToken: context.req.header("x-webhook-token"),
            secret: policy.secret,
          });
          if (!matches && policy.mode === "enforce") {
            return context.json({ error: { code: "webhook_signature_invalid", message: "Webhook signature is missing or invalid" } }, 401);
          }
          if (!matches) {
            logSignatureWarning({
              context,
              provider: callback.provider,
              accountPublicId: resolution.accountPublicId,
              mode: policy.mode,
              reason: "invalid_signature",
            });
          }
        }

        const rawPayload = {
          provider: callback.provider,
          channel: callback.channel,
          body,
          query: sanitizedQuery(context.req.url),
        };
        const payloadHash = hashWebhookPayload(rawPayload);
        const eventType = inferEventType(body);
        const externalEventId = inferExternalEventId(body);
        const replayKey = externalEventId ? `${callback.provider}:event:${externalEventId}` : null;
        const now = Date.now();
        if (replayKey) {
          const replayed = replayCache.get(replayKey, now);
          if (replayed) {
            return context.json(replayed.body, replayed.status);
          }
        }

        let event;
        try {
          event = await repository.storeReceivedEvent({
            provider: callback.provider,
            accountPublicId: resolution.accountPublicId,
            eventType,
            externalEventId,
            payloadHash,
            rawPayload,
          });
        } catch (error) {
          if (isDuplicateKeyError(error) && externalEventId) {
            const existing = await repository.findReceivedEventByExternalId({
              provider: callback.provider,
              accountPublicId: resolution.accountPublicId,
              externalEventId,
            });
            if (existing) {
              const replayed = responseFromStoredEvent(existing);
              if (replayKey) {
                replayCache.set(replayKey, now, replayWindowMs, replayed);
              }
              return context.json(replayed.body, replayed.status);
            }
          }
          throw error;
        }
        const job = buildWebhookJob({
          eventPublicId: event.public_id,
          provider: callback.provider,
          accountPublicId: event.account_public_id,
          payloadHash,
          eventType,
          externalEventId,
          requestId: context.get("requestId"),
        });
        const queuedJobId = await queuePublisher.publish(job);
        const accepted = acceptedWebhookResponse({
          provider: callback.provider,
          eventPublicId: event.public_id,
          payloadHash,
          queuedJobId,
        });
        if (replayKey) {
          replayCache.set(replayKey, now, replayWindowMs, accepted);
        }

        return context.json(accepted.body, accepted.status);
      },
    );
  }

  routes.post("/:provider", (context) =>
    context.json(
      {
        error: {
          code: "unsupported_provider",
          message: `Webhook provider is not configured: ${context.req.param("provider")}`,
        },
      },
      404,
    ),
  );

  return routes;
}

export type { WebhookProvider };
