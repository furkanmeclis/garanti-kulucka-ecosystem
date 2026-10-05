import { Hono } from "hono";
import type { Context } from "hono";
import type { ProviderName } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { DatabaseWebhookEventRepository, type WebhookEventRepository } from "../webhooks/repository.js";
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

export interface CreateWebhookRoutesOptions {
  repository?: WebhookEventRepository;
  queuePublisher?: WebhookQueuePublisher;
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

export function createWebhookRoutes(options: CreateWebhookRoutesOptions = {}) {
  const routes = new Hono<AppBindings>();
  const queuePublisher = options.queuePublisher ?? noopWebhookQueuePublisher;

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

    routes.post(callback.path, async (context) => {
      const repository = getRepository(context, options.repository);
      if (!repository) {
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

      const rawPayload = {
        provider: callback.provider,
        channel: callback.channel,
        body,
        query: sanitizedQuery(context.req.url),
      };
      const payloadHash = hashWebhookPayload(rawPayload);
      const eventType = inferEventType(body);
      const externalEventId = inferExternalEventId(body);
      const event = await repository.storeReceivedEvent({
        provider: callback.provider,
        accountPublicId: resolution.accountPublicId,
        eventType,
        externalEventId,
        payloadHash,
        rawPayload,
      });
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

      return context.json(
        acceptedResponse({
          provider: callback.provider,
          eventPublicId: event.public_id,
          payloadHash,
          queuedJobId,
        }),
        202,
      );
    });
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
