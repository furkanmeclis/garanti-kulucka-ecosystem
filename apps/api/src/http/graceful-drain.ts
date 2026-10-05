import type { Server as HttpServer } from "node:http";

/**
 * Tracks in-flight HTTP requests so SIGTERM can stop accepting new work
 * and wait for running requests before resources (DB, Redis, queues) are closed.
 */
export class InFlightRequestTracker {
  private active = 0;
  private draining = false;
  private idleWaiters: Array<() => void> = [];

  get activeCount(): number {
    return this.active;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  startDraining(): void {
    this.draining = true;
  }

  /** Wraps a fetch handler; requests that arrive while draining receive 503 + Connection: close. */
  wrap<Args extends unknown[]>(
    handler: (request: Request, ...rest: Args) => Response | Promise<Response>,
  ): (request: Request, ...rest: Args) => Promise<Response> {
    return async (request, ...rest) => {
      if (this.draining) {
        return new Response(JSON.stringify({ error: { code: "server_draining", message: "Server is shutting down" } }), {
          status: 503,
          headers: {
            "content-type": "application/json",
            connection: "close",
            "retry-after": "5",
          },
        });
      }

      this.active += 1;
      try {
        return await handler(request, ...rest);
      } finally {
        this.active -= 1;
        if (this.active === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          for (const resolve of waiters) resolve();
        }
      }
    };
  }

  /** Resolves true when no request is active, or false when the timeout elapses first. */
  waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.active === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.idleWaiters = this.idleWaiters.filter((waiter) => waiter !== onIdle);
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
      const onIdle = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.idleWaiters.push(onIdle);
    });
  }
}

export interface DrainableRealtime {
  /** Rejects new Socket.IO handshakes and asks connected clients to reconnect elsewhere. */
  drain: () => Promise<void> | void;
}

export interface DrainHttpServerOptions {
  server: Pick<HttpServer, "close"> & Partial<Pick<HttpServer, "closeIdleConnections" | "closeAllConnections">>;
  tracker: InFlightRequestTracker;
  realtime?: DrainableRealtime;
  timeoutMs: number;
}

export interface DrainResult {
  drained: boolean;
  abandonedRequests: number;
}

/**
 * Zero-downtime drain order:
 * 1. mark draining (new HTTP requests get 503, new Socket.IO handshakes are refused)
 * 2. stop listening for new TCP connections and close idle keep-alive sockets
 * 3. disconnect realtime clients so they reconnect to a healthy instance
 * 4. wait for in-flight requests up to `timeoutMs`, then force-close remaining connections
 */
export async function drainHttpServer(options: DrainHttpServerOptions): Promise<DrainResult> {
  const deadline = Date.now() + options.timeoutMs;
  options.tracker.startDraining();
  let serverClosed = false;
  const closed = new Promise<void>((resolve) => {
    options.server.close(() => {
      serverClosed = true;
      resolve();
    });
  });
  options.server.closeIdleConnections?.();
  await options.realtime?.drain();

  const drained = await options.tracker.waitForIdle(Math.max(0, deadline - Date.now()));
  const abandonedRequests = drained ? 0 : options.tracker.activeCount;

  if (drained && options.server.closeIdleConnections) {
    // Handlers have returned, but response bodies may still be flushing. Keep closing
    // connections as they become idle until the server reports closed or the deadline passes.
    while (!serverClosed && Date.now() < deadline) {
      options.server.closeIdleConnections();
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 25))]);
    }
  }

  options.server.closeAllConnections?.();
  return { drained, abandonedRequests };
}
