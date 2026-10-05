import { describe, expect, it } from "vitest";
import { ServiceConfigError, resolveAppEnvironment, validateServiceEnv } from "../src/index.js";

const strongEncryptionKey = "k9Vq2mXr7TzL4pWc8nJd3hYs6bFg1aQe-prod";
const strongJwtSecret = "Zt5Rk8mWq2Lp7Xc4Nv9Bj3Hd6Gf1Sa0Ey-prod";

const productionApiEnv = {
  APP_ENV: "production",
  DATABASE_URL: "postgres://app:supersecretdbpass@db.internal:5432/garanti",
  REDIS_URL: "rediss://:redispass@redis.internal:6380",
  APP_ENCRYPTION_KEY: strongEncryptionKey,
  JWT_ACCESS_SECRET: strongJwtSecret,
  PORT: "3000",
};

function captureError(fn: () => unknown): ServiceConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ServiceConfigError) return error;
    throw error;
  }
  throw new Error("expected ServiceConfigError");
}

describe("service env validation", () => {
  it("accepts a complete production api environment and parses numbers", () => {
    const env = validateServiceEnv("api", productionApiEnv);
    expect(env.appEnv).toBe("production");
    expect(env.PORT).toBe(3000);
  });

  it("is lenient for local environments without infrastructure variables", () => {
    expect(validateServiceEnv("api", {}).appEnv).toBe("local");
    expect(validateServiceEnv("worker", { NODE_ENV: "development" }).appEnv).toBe("local");
    expect(validateServiceEnv("migrator", {}).appEnv).toBe("local");
  });

  it("defaults to production strictness for NODE_ENV=production images", () => {
    expect(resolveAppEnvironment({ NODE_ENV: "production" })).toBe("production");
    expect(resolveAppEnvironment({ NODE_ENV: "production", APP_ENV: "local" })).toBe("local");
    const error = captureError(() => validateServiceEnv("worker", { NODE_ENV: "production" }));
    expect(error.issues.map((issue) => issue.variable)).toEqual(
      expect.arrayContaining(["DATABASE_URL", "REDIS_URL", "APP_ENCRYPTION_KEY"]),
    );
  });

  it("rejects weak and development secrets in strict environments without echoing values", () => {
    const error = captureError(() =>
      validateServiceEnv("api", {
        ...productionApiEnv,
        APP_ENV: "staging",
        APP_ENCRYPTION_KEY: "local-dev-change-me-32-bytes-minimum",
        JWT_ACCESS_SECRET: "short-secret",
      }),
    );
    expect(error.message).toContain("APP_ENCRYPTION_KEY: must not use a development default value");
    expect(error.message).toContain("JWT_ACCESS_SECRET: must be at least 32 characters");
    expect(error.message).not.toContain("short-secret");
    expect(error.message).not.toContain("local-dev-change-me");
  });

  it("rejects malformed URLs and numbers without leaking credentials", () => {
    const error = captureError(() =>
      validateServiceEnv("api", {
        ...productionApiEnv,
        DATABASE_URL: "mysql://root:topsecretpw@db:3306/app",
        REDIS_URL: "not a url",
        PORT: "70000",
        ACCESS_TOKEN_TTL_SECONDS: "abc",
      }),
    );
    const variables = error.issues.map((issue) => issue.variable);
    expect(variables).toEqual(
      expect.arrayContaining(["DATABASE_URL", "REDIS_URL", "PORT", "ACCESS_TOKEN_TTL_SECONDS"]),
    );
    expect(error.message).not.toContain("topsecretpw");
    expect(error.message).not.toContain("not a url");
  });

  it("requires the full S3 group when any storage variable is set", () => {
    const error = captureError(() =>
      validateServiceEnv("worker", { S3_ENDPOINT: "http://garage:3900", S3_ACCESS_KEY_ID: "garage" }),
    );
    expect(error.issues.map((issue) => issue.variable)).toEqual(["S3_SECRET_ACCESS_KEY", "S3_BUCKET_MEDIA"]);
  });

  it("requires a target database for the migrator in strict environments", () => {
    const error = captureError(() =>
      validateServiceEnv("migrator", { APP_ENV: "production", MIGRATION_APPLY_ENABLED: "yes" }),
    );
    const variables = error.issues.map((issue) => issue.variable);
    expect(variables).toContain("TARGET_DATABASE_URL | DATABASE_URL");
    expect(variables).toContain("MIGRATION_APPLY_ENABLED");
    expect(
      validateServiceEnv("migrator", {
        APP_ENV: "production",
        TARGET_DATABASE_URL: "postgresql://app:pw@db:5432/garanti",
      }).appEnv,
    ).toBe("production");
  });

  it("validates worker shutdown and concurrency tuning", () => {
    const env = validateServiceEnv("worker", { WORKER_CONCURRENCY: "8", WORKER_SHUTDOWN_TIMEOUT_MS: "45000" });
    expect(env.WORKER_CONCURRENCY).toBe(8);
    expect(env.WORKER_SHUTDOWN_TIMEOUT_MS).toBe(45000);
    expect(() => validateServiceEnv("worker", { WORKER_CONCURRENCY: "0" })).toThrow(ServiceConfigError);
  });

  it("validates metrics exposure and worker health listener settings", () => {
    const env = validateServiceEnv("worker", { WORKER_HTTP_PORT: "3001", METRICS_ENABLED: "true", METRICS_PORT: "9464" });
    expect(env.WORKER_HTTP_PORT).toBe(3001);
    expect(env.METRICS_PORT).toBe(9464);

    const disabledError = captureError(() => validateServiceEnv("api", { METRICS_ENABLED: "true" }));
    expect(disabledError.issues.map((issue) => issue.variable)).toEqual(["METRICS_BEARER_TOKEN | METRICS_PORT"]);

    const badPort = captureError(() => validateServiceEnv("worker", { WORKER_HTTP_PORT: "99999", METRICS_ENABLED: "on" }));
    expect(badPort.issues.map((issue) => issue.variable)).toEqual(expect.arrayContaining(["WORKER_HTTP_PORT", "METRICS_ENABLED"]));

    const weakToken = captureError(() =>
      validateServiceEnv("api", { ...productionApiEnv, METRICS_ENABLED: "true", METRICS_BEARER_TOKEN: "scrape-token-short" }),
    );
    expect(weakToken.message).toContain("METRICS_BEARER_TOKEN: must be at least 32 characters");
    expect(weakToken.message).not.toContain("scrape-token-short");
  });
});
