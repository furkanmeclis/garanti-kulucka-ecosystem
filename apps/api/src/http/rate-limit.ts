import { createClient, type RedisClientType } from "redis";
import type { Context, Next } from "hono";
import type { AppBindings } from "./types.js";
import type { ApiConfig } from "../config.js";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  increment: (key: string, windowMs: number) => Promise<{ count: number; resetAt: number }>;
}

export interface RateLimitPolicy {
  namespace: string;
  limit: number | ((context: Context<AppBindings>) => number);
  windowMs: number;
  key: (context: Context<AppBindings>) => string;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowMs: number) {
    const now = Date.now();
    const existing = this.entries.get(key);
    if (!existing || existing.resetAt <= now) {
      const next = { count: 1, resetAt: now + windowMs };
      this.entries.set(key, next);
      return next;
    }

    existing.count += 1;
    return existing;
  }
}

class RedisRateLimitStore implements RateLimitStore {
  private connected = false;

  constructor(private readonly client: RedisClientType, private readonly fallback: RateLimitStore) {}

  async increment(key: string, windowMs: number) {
    try {
      if (!this.connected) {
        await this.client.connect();
        this.connected = true;
      }
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.pExpire(key, windowMs);
      }
      const ttl = await this.client.pTTL(key);
      return { count, resetAt: Date.now() + Math.max(ttl, windowMs) };
    } catch {
      return this.fallback.increment(key, windowMs);
    }
  }
}

export function createRateLimitStore(config: ApiConfig): RateLimitStore {
  const fallback = new MemoryRateLimitStore();
  if (!config.redisUrl) {
    return fallback;
  }

  return new RedisRateLimitStore(
    createClient({ url: config.redisUrl }) as RedisClientType,
    fallback,
  );
}

export function rateLimit(policy: RateLimitPolicy) {
  return async (context: Context<AppBindings>, next: Next) => {
    const store = context.get("rateLimitStore");
    const limit = typeof policy.limit === "function" ? policy.limit(context) : policy.limit;
    const key = `rate-limit:${policy.namespace}:${policy.key(context)}`;
    const result = await store.increment(key, policy.windowMs);
    if (result.count > limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      context.header("Retry-After", String(retryAfterSeconds));
      return context.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many requests",
          },
        },
        429,
      );
    }

    return next();
  };
}

export function clientIp(context: Context<AppBindings>) {
  return (
    context.req.header("cf-connecting-ip") ??
    context.req.header("x-real-ip") ??
    context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
