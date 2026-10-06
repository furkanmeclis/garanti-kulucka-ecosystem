import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Server as SocketServer } from "socket.io";
import { io as connectSocket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drainHttpServer, InFlightRequestTracker } from "../src/http/graceful-drain.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

function startServer(delayMs: number) {
  const tracker = new InFlightRequestTracker();
  const app = new Hono();
  app.get("/slow", async (context) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return context.json({ ok: true });
  });
  app.get("/fast", (context) => context.json({ ok: true }));

  const server = serve({ fetch: tracker.wrap(app.fetch), port: 0, hostname: "127.0.0.1" }) as HttpServer;
  cleanups.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return { tracker, server };
}

async function baseUrl(server: HttpServer): Promise<string> {
  if (!server.listening) {
    await new Promise((resolve) => server.once("listening", resolve));
  }
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("API graceful drain", () => {
  it("finishes in-flight requests and refuses new ones while draining", async () => {
    const { tracker, server } = startServer(1_000);
    const url = await baseUrl(server);

    const inFlight = fetch(`${url}/slow`);
    await vi.waitFor(() => expect(tracker.activeCount).toBe(1), { timeout: 5_000, interval: 10 });

    const drain = drainHttpServer({ server, tracker, timeoutMs: 5_000 });

    const wrapped = tracker.wrap(async () => new Response("unexpected"));
    const refused = await wrapped(new Request(`${url}/fast`));
    expect(refused.status).toBe(503);
    expect(refused.headers.get("connection")).toBe("close");

    const response = await inFlight;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    await expect(drain).resolves.toEqual({ drained: true, abandonedRequests: 0 });
    expect(server.listening).toBe(false);
  });

  it("reports abandoned requests when the drain timeout elapses", async () => {
    const { tracker, server } = startServer(2_000);
    const url = await baseUrl(server);

    const inFlight = fetch(`${url}/slow`).catch(() => null);
    await vi.waitFor(() => expect(tracker.activeCount).toBe(1), { timeout: 5_000, interval: 10 });

    const result = await drainHttpServer({ server, tracker, timeoutMs: 100 });
    expect(result).toEqual({ drained: false, abandonedRequests: 1 });
    await inFlight;
  });

  it("disconnects Socket.IO clients and rejects new handshakes during drain", async () => {
    const { tracker, server } = startServer(10);
    const url = await baseUrl(server);
    const io = new SocketServer(server);
    let draining = false;
    io.use((_socket, next) => (draining ? next(new Error("server_draining")) : next()));
    cleanups.push(() => io.close());

    const client = connectSocket(url, { transports: ["websocket"], reconnection: false });
    cleanups.push(() => {
      client.disconnect();
    });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("connect_error", reject);
    });

    const disconnected = new Promise<string>((resolve) => client.once("disconnect", resolve));
    await drainHttpServer({
      server,
      tracker,
      timeoutMs: 1_000,
      realtime: {
        drain: () => {
          draining = true;
          io.disconnectSockets(true);
        },
      },
    });

    await expect(disconnected).resolves.toBe("io server disconnect");
    expect(io.sockets.sockets.size).toBe(0);
  });
});
