#!/usr/bin/env node
// Webhook ingress load: signed Meta-style POSTs with unique payloads plus an optional replay share
// that must be absorbed by idempotency (same payload hash => duplicate, not a new job).
// Usage: LOAD_TARGET_URL=http://localhost:3000 LOAD_WEBHOOK_SECRET=... node tools/load/webhook-ingress.mjs --provider=meta
import { createHmac, randomUUID } from "node:crypto";
import { numberArg, parseArgs, printReport, resolveTarget, runClosedLoop, summarize, timedFetch } from "./lib.mjs";

const metaSignatureProviders = new Set(["meta", "instagram", "messenger", "whatsapp"]);

const args = parseArgs();
const target = resolveTarget(args);
const provider = args.provider ?? process.env.LOAD_WEBHOOK_PROVIDER ?? "meta";
const secret = args.secret ?? process.env.LOAD_WEBHOOK_SECRET ?? "";
const durationMs = numberArg(args, "duration", "LOAD_DURATION_SECONDS", 30) * 1000;
const concurrency = numberArg(args, "concurrency", "LOAD_CONCURRENCY", 10);
const replayPercent = Number(args["replay-percent"] ?? process.env.LOAD_REPLAY_PERCENT ?? 10);
const url = new URL(`/webhooks/${provider}`, target);

function buildPayload(n) {
  const id = `loadtest-${randomUUID()}`;
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "loadtest-account",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "loadtest-phone" },
              messages: [{ id, from: "900000000000", timestamp: `${Math.floor(Date.now() / 1000)}`, type: "text", text: { body: `load ${n}` } }],
            },
          },
        ],
      },
    ],
  });
}

function headersFor(body) {
  const headers = { "content-type": "application/json" };
  if (secret && metaSignatureProviders.has(provider)) {
    headers["x-hub-signature-256"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  } else if (secret) {
    headers["x-webhook-token"] = secret;
  }
  return headers;
}

const replayPool = [];
const samples = await runClosedLoop({
  durationMs,
  concurrency,
  task: async (n) => {
    const replay = replayPool.length > 0 && Math.random() * 100 < replayPercent;
    const body = replay ? replayPool[n % replayPool.length] : buildPayload(n);
    if (!replay && replayPool.length < 100) replayPool.push(body);
    const result = await timedFetch(url, { method: "POST", headers: headersFor(body), body });
    return { ...result, replay };
  },
});

const fresh = samples.filter((s) => !s.replay);
const replays = samples.filter((s) => s.replay);
printReport(
  {
    target: target.origin,
    provider,
    duration_ms: durationMs,
    concurrency,
    replay_percent: replayPercent,
    scenarios: [
      summarize(`POST /webhooks/${provider} (unique)`, fresh, durationMs),
      summarize(`POST /webhooks/${provider} (replay)`, replays, durationMs),
    ],
  },
  { p95: numberArg(args, "max-p95", "LOAD_MAX_P95_MS", 300), errorRate: 0.01 },
);
