import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { createClient } from "redis";
import { io as connectClient, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachRealtime, type RealtimeHandle } from "../../apps/api/src/realtime.js";
import { signAccessToken } from "../../apps/api/src/auth/tokens.js";
import type { ApiConfig } from "../../apps/api/src/config.js";

/**
 * P6 Redis fanout proof: Redis runs in Docker (or REDIS_FANOUT_URL), two independent API realtime
 * instances (separate HTTP servers, Socket.IO servers and Redis streams adapter connections) attach to
 * it, one client connects to each, and an envelope published on instance A must reach the client on B.
 */

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const externalRedisUrl = process.env.REDIS_FANOUT_URL ?? null;
const canRun = externalRedisUrl !== null || dockerAvailable();
const redisImage = process.env.REDIS_FANOUT_IMAGE ?? "redis:8-alpine";

let containerId: string | null = null;
let redisUrl = "";
const instances: Array<{ server: ServerType; realtime: RealtimeHandle; url: string }> = [];
const clients: Socket[] = [];

function baseConfig(): ApiConfig {
  return {
    databaseUrl: null,
    jwtSecret: "redis-fanout-test-secret",
    encryptionKey: "redis-fanout-test-encryption-key",
    encryptionKeyId: "default",
    accessTokenTtlSeconds: 300,
    refreshTokenTtlDays: 1,
    redisUrl,
    corsOrigin: null,
  };
}

async function waitForRedis(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = createClient({ url });
    client.on("error", () => undefined);
    try {
      await client.connect();
      await client.ping();
      await client.quit();
      return;
    } catch (error) {
      lastError = error;
      await client.disconnect().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Redis did not become ready: ${String(lastError)}`);
}

async function startInstance(): Promise<{ server: ServerType; realtime: RealtimeHandle; url: string }> {
  const app = new Hono();
  app.get("/health/live", (context) => context.json({ status: "ok" }));
  const server = await new Promise<ServerType>((resolve) => {
    const started = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(started));
  });
  const realtime = await attachRealtime(server, baseConfig(), { db: null, staleSessionSweepIntervalMs: 0 });
  const { port } = server.address() as AddressInfo;
  return { server, realtime, url: `http://127.0.0.1:${port}` };
}

async function connect(url: string, userPublicId: string): Promise<Socket> {
  const token = await signAccessToken(
    { user_public_id: userPublicId, session_public_id: `ses_${userPublicId}`, role: "agent" },
    baseConfig(),
  );
  const socket = connectClient(url, { auth: { token }, transports: ["websocket"], reconnection: false });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  return socket;
}

async function waitForRoomMembers(handle: RealtimeHandle, room: string, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const sockets = await handle.io.in(room).fetchSockets();
    if (sockets.length >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Room ${room} did not reach ${expected} members across instances`);
}

describe.skipIf(!canRun)("P6 Redis streams fanout across two API instances", () => {
  beforeAll(async () => {
    if (externalRedisUrl) {
      redisUrl = externalRedisUrl;
    } else {
      containerId = execFileSync(
        "docker",
        ["run", "-d", "--rm", "--label", "gke.test=redis-fanout", "-p", "127.0.0.1::6379", redisImage],
        { encoding: "utf8", timeout: 120_000 },
      ).trim();
      const mapping = execFileSync("docker", ["port", containerId, "6379/tcp"], { encoding: "utf8" }).trim().split("\n")[0] ?? "";
      const port = mapping.split(":").pop();
      redisUrl = `redis://127.0.0.1:${port}`;
    }
    await waitForRedis(redisUrl);
    instances.push(await startInstance(), await startInstance());
  }, 180_000);

  afterAll(async () => {
    for (const client of clients) {
      client.disconnect();
    }
    for (const instance of instances) {
      await instance.realtime.close();
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
    if (containerId) {
      execFileSync("docker", ["rm", "-f", containerId], { stdio: "ignore" });
    }
  }, 60_000);

  it("delivers a conversation envelope published on instance A to a client on instance B", async () => {
    const [instanceA, instanceB] = instances;
    if (!instanceA || !instanceB) throw new Error("instances not started");
    expect(instanceA.url).not.toBe(instanceB.url);

    const clientA = await connect(instanceA.url, "usr_fanout_a");
    const clientB = await connect(instanceB.url, "usr_fanout_b");
    const conversationPublicId = "cnv_redis_fanout";
    clientA.emit("conversation.join", conversationPublicId);
    clientB.emit("conversation.join", conversationPublicId);
    await waitForRoomMembers(instanceA.realtime, `conversation:${conversationPublicId}`, 2);

    const receivedOnB = new Promise<unknown>((resolve) => clientB.once("message.created", resolve));
    const receivedOnA = new Promise<unknown>((resolve) => clientA.once("message.created", resolve));
    const envelope = {
      event: "message.created" as const,
      id: "evt_redis_fanout",
      occurred_at: new Date().toISOString(),
      payload: {
        message_public_id: "msg_redis_fanout",
        conversation_public_id: conversationPublicId,
        sender_type: "customer",
      },
    };
    instanceA.realtime.publisher.publishToConversation(conversationPublicId, envelope);

    const timeout = (label: string) =>
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), 10_000));
    await expect(Promise.race([receivedOnB, timeout("instance B delivery")])).resolves.toMatchObject({
      event: "message.created",
      id: "evt_redis_fanout",
      payload: { conversation_public_id: conversationPublicId },
    });
    await expect(Promise.race([receivedOnA, timeout("instance A delivery")])).resolves.toMatchObject({
      id: "evt_redis_fanout",
    });
  }, 60_000);

  it("delivers user-room envelopes across instances and does not leak to other users", async () => {
    const [instanceA, instanceB] = instances;
    if (!instanceA || !instanceB) throw new Error("instances not started");
    const target = await connect(instanceB.url, "usr_fanout_target");
    const bystander = await connect(instanceB.url, "usr_fanout_bystander");
    await waitForRoomMembers(instanceA.realtime, "user:usr_fanout_target", 1);

    let leaked = false;
    bystander.on("message.read", () => {
      leaked = true;
    });
    const received = new Promise<unknown>((resolve) => target.once("message.read", resolve));
    instanceA.realtime.publisher.publishToUser("usr_fanout_target", {
      event: "message.read",
      id: "evt_user_fanout",
      occurred_at: new Date().toISOString(),
      payload: { message_public_id: "msg_user_fanout", conversation_public_id: "cnv_user_fanout", reader_user_public_id: "usr_fanout_target" },
    });

    await expect(
      Promise.race([received, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10_000))]),
    ).resolves.toMatchObject({ id: "evt_user_fanout" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(leaked).toBe(false);
  }, 60_000);
});
