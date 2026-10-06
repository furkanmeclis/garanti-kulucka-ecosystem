import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import type { AppBindings } from "./types.js";
import { clientIp, rateLimit } from "./rate-limit.js";
import { IvrWebhookRepository, ivrPayloadFrom, parseIvrWebhook } from "../orders/ivr-webhook.js";

/**
 * Public NetGSM teyit (IVR) callback, kept on the legacy path the worker already registers with NetGSM
 * (`${app_url}/api/netgsm/webhook/sesli-mesaj`, GET or POST). NetGSM does not sign callbacks: when the
 * global setting `netgsm.ivr_webhook_token` is set, the callback URL must carry `?token=<value>`.
 * Like the legacy handler it always answers 200 so NetGSM never retries into a loop.
 */

function tokensMatch(expected: string, received: string | undefined) {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(context: Context<AppBindings>): Promise<unknown> {
  if (context.req.method !== "POST") return undefined;
  const type = context.req.header("content-type") ?? "";
  try {
    if (type.includes("application/json")) return await context.req.json();
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      const form = await context.req.parseBody();
      return Object.fromEntries(Object.entries(form).map(([key, value]) => [key, typeof value === "string" ? value : ""]));
    }
    const raw = (await context.req.text()).trim();
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

export function createNetgsmWebhookRoutes() {
  const routes = new Hono<AppBindings>();

  const handler = async (context: Context<AppBindings>) => {
    const db = context.get("db");
    if (!db) return context.json({ ok: true, processed: false });
    const repository = new IvrWebhookRepository(db);
    const query = Object.fromEntries(new URL(context.req.url).searchParams);
    const expectedToken = await repository.webhookToken();
    if (expectedToken && !tokensMatch(expectedToken, query.token)) {
      return context.json({ ok: false, error: "invalid_token" }, 401);
    }
    const { token: _token, ...queryWithoutToken } = query;
    const payload = ivrPayloadFrom(await readBody(context), queryWithoutToken);
    const result = parseIvrWebhook(payload);
    try {
      if (!result) {
        await repository.recordEvent(payload, "ignored");
        return context.json({ ok: true, processed: false });
      }
      const order = await repository.apply(result);
      await repository.recordEvent(payload, order ? "processed" : "ignored");
      if (order) {
        context.get("realtimePublisher").broadcast({
          event: "order.updated",
          id: `evt_ivr_${result.bulkId}_${Date.now()}`,
          occurred_at: new Date().toISOString(),
          payload: { order_public_id: order.public_id, status: order.status },
        });
      }
      return context.json({ ok: true, processed: Boolean(order), order_public_id: order?.public_id ?? null, confirmation_status: result.confirmationStatus });
    } catch {
      // Legacy: never let NetGSM see a failure (it would retry the same callback).
      return context.json({ ok: true, processed: false });
    }
  };

  const limiter = rateLimit({ namespace: "webhook:netgsm-ivr", limit: (context) => context.get("config").webhookRateLimitPerMinute ?? 600, windowMs: 60_000, key: (context) => clientIp(context) });
  routes.get("/sesli-mesaj", limiter, handler);
  routes.post("/sesli-mesaj", limiter, handler);
  return routes;
}
