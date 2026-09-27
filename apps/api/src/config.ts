export interface ApiConfig {
  databaseUrl: string | null;
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  redisUrl: string | null;
  corsOrigin: string | null;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function loadConfig(): ApiConfig {
  return {
    databaseUrl: process.env.DATABASE_URL ?? null,
    jwtSecret: process.env.JWT_SECRET ?? "local-development-jwt-secret-change-me",
    accessTokenTtlSeconds: numberFromEnv("ACCESS_TOKEN_TTL_SECONDS", 900),
    refreshTokenTtlDays: numberFromEnv("REFRESH_TOKEN_TTL_DAYS", 30),
    redisUrl: process.env.REDIS_URL ?? null,
    corsOrigin: process.env.CORS_ORIGIN ?? null,
  };
}
