#!/usr/bin/env node
// Socket.IO fanout load: opens N authenticated clients, joins a conversation room, and measures
// handshake latency plus delivery latency (now - envelope.occurred_at) of every received event.
// Events are produced by normal traffic or by running webhook-ingress.mjs in parallel.
// Usage: LOAD_TARGET_URL=http://localhost:3000 LOAD_ACCESS_TOKEN=... node tools/load/socket-fanout.mjs --clients=200 --conversation=<public_id>
import { io } from "socket.io-client";
import { numberArg, parseArgs, percentile, printReport, resolveTarget } from "./lib.mjs";

const args = parseArgs();
const target = resolveTarget(args);
const token = args.token ?? process.env.LOAD_ACCESS_TOKEN;
if (!token) {
  throw new Error("Set LOAD_ACCESS_TOKEN to an access token of a dedicated load-test user");
}
const clients = numberArg(args, "clients", "LOAD_SOCKET_CLIENTS", 100);
const durationMs = numberArg(args, "duration", "LOAD_DURATION_SECONDS", 60) * 1000;
const rampMs = numberArg(args, "ramp", "LOAD_SOCKET_RAMP_MS", 5_000);
const conversation = args.conversation ?? process.env.LOAD_CONVERSATION_PUBLIC_ID;

const handshakeMs = [];
const deliveryMs = [];
const connectErrors = {};
let disconnects = 0;
let received = 0;
const sockets = [];

function connectOne() {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = io(target.origin, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: 10_000,
    });
    sockets.push(socket);
    socket.once("connect", () => {
      handshakeMs.push(performance.now() - started);
      if (conversation) socket.emit("conversation.join", conversation);
      resolve();
    });
    socket.once("connect_error", (error) => {
      connectErrors[error.message] = (connectErrors[error.message] ?? 0) + 1;
      resolve();
    });
    socket.on("disconnect", () => {
      disconnects += 1;
    });
    socket.onAny((_event, envelope) => {
      received += 1;
      const occurredAt = envelope && typeof envelope.occurred_at === "string" ? Date.parse(envelope.occurred_at) : NaN;
      if (Number.isFinite(occurredAt)) deliveryMs.push(Date.now() - occurredAt);
    });
  });
}

const connectStarted = Date.now();
const pending = [];
for (let i = 0; i < clients; i += 1) {
  pending.push(connectOne());
  await new Promise((resolve) => setTimeout(resolve, rampMs / clients));
}
await Promise.all(pending);
const connected = handshakeMs.length;
await new Promise((resolve) => setTimeout(resolve, durationMs));
for (const socket of sockets) socket.disconnect();

const sortedHandshake = handshakeMs.sort((a, b) => a - b);
const sortedDelivery = deliveryMs.sort((a, b) => a - b);
const round = (value) => Number(value.toFixed(1));

printReport(
  {
    name: "socket.io fanout",
    target: target.origin,
    clients,
    connected,
    connect_errors: connectErrors,
    ramp_ms: Date.now() - connectStarted - durationMs,
    observe_ms: durationMs,
    unexpected_disconnects: Math.max(0, disconnects - connected),
    events_received: received,
    events_per_client: connected > 0 ? round(received / connected) : 0,
    requests: clients,
    ok: connected,
    latency_ms: {
      p50: round(percentile(sortedHandshake, 50)),
      p95: round(percentile(sortedHandshake, 95)),
      p99: round(percentile(sortedHandshake, 99)),
      max: round(sortedHandshake.at(-1) ?? 0),
    },
    delivery_latency_ms: {
      p50: round(percentile(sortedDelivery, 50)),
      p95: round(percentile(sortedDelivery, 95)),
      p99: round(percentile(sortedDelivery, 99)),
    },
  },
  { p95: numberArg(args, "max-p95", "LOAD_MAX_P95_MS", 1_000), errorRate: 0.01 },
);
