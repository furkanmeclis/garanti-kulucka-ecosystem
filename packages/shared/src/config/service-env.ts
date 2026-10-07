import { z } from "zod";

/**
 * Startup environment validation for long-running services (api, worker) and the migrator CLI.
 *
 * Design rules:
 * - Fail fast at process start, before any connection is opened.
 * - Error messages list variable names and rule violations only; values are never echoed,
 *   so secrets cannot leak into logs or crash reports.
 * - `APP_ENV` selects strictness. `staging` and `production` are strict: required infrastructure
 *   variables must be present and security roots must be long and must not be development defaults.
 *   When `APP_ENV` is unset it falls back to `production` if `NODE_ENV=production` (container images),
 *   otherwise `local`. Local compose sets `APP_ENV=local` explicitly.
 */

export const serviceNames = ["api", "worker", "migrator"] as const;
export type ServiceName = (typeof serviceNames)[number];

export const appEnvironments = ["local", "test", "staging", "production"] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

export const strictAppEnvironments: readonly AppEnvironment[] = ["staging", "production"];

export const minimumSecretLength = 32;

const developmentSecretMarkers = ["change-me", "changeme", "local-dev", "local-development"];

type EnvSource = Record<string, string | undefined>;

export interface ServiceEnvIssue {
  variable: string;
  message: string;
}

export class ServiceConfigError extends Error {
  readonly service: ServiceName;
  readonly appEnv: AppEnvironment;
  readonly issues: readonly ServiceEnvIssue[];

  constructor(service: ServiceName, appEnv: AppEnvironment, issues: readonly ServiceEnvIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`);
    super(
      `Invalid ${service} configuration for APP_ENV=${appEnv} (${issues.length} issue${
        issues.length === 1 ? "" : "s"
      }):\n${lines.join("\n")}`,
    );
    this.name = "ServiceConfigError";
    this.service = service;
    this.appEnv = appEnv;
    this.issues = issues;
  }
}

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

function optionalUrl(protocols: readonly string[], label: string) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .superRefine((value, ctx) => {
        if (value === undefined) return;
        let parsed: URL;
        try {
          parsed = new URL(value);
        } catch {
          ctx.addIssue({ code: "custom", message: `must be a valid ${label} URL` });
          return;
        }
        if (!protocols.includes(parsed.protocol)) {
          ctx.addIssue({
            code: "custom",
            message: `must use one of the protocols: ${protocols.map((p) => p.replace(/:$/, "")).join(", ")}`,
          });
        }
      }),
  );
}

function optionalPositiveInt(max = Number.MAX_SAFE_INTEGER) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d+$/, "must be a positive integer")
      .transform((value) => Number.parseInt(value, 10))
      .refine((value) => value > 0 && value <= max, `must be between 1 and ${max}`)
      .optional(),
  );
}

function optionalPositiveNumber() {
  return z.preprocess(
    emptyToUndefined,
    z
      .string()
      .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "must be a positive number")
      .transform((value) => Number(value))
      .optional(),
  );
}

function optionalBooleanFlag() {
  return z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional());
}

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const postgresUrl = optionalUrl(["postgres:", "postgresql:"], "PostgreSQL");
const redisUrl = optionalUrl(["redis:", "rediss:"], "Redis");
const httpUrl = optionalUrl(["http:", "https:"], "HTTP(S)");

const sharedShape = {
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(["development", "test", "production"]).optional()),
  APP_ENV: z.preprocess(emptyToUndefined, z.enum(appEnvironments).optional()),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  ),
};

const metricsShape = {
  METRICS_ENABLED: optionalBooleanFlag(),
  METRICS_BEARER_TOKEN: optionalString,
  METRICS_PORT: optionalPositiveInt(65_535),
  METRICS_HOST: optionalString,
};

const storageShape = {
  S3_ENDPOINT: httpUrl,
  S3_REGION: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_BUCKET_MEDIA: optionalString,
};

export const apiEnvSchema = z.object({
  ...sharedShape,
  ...storageShape,
  ...metricsShape,
  PORT: optionalPositiveInt(65_535),
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
  APP_ENCRYPTION_KEY: optionalString,
  APP_ENCRYPTION_KEY_ID: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/, "must be 1-64 characters of letters, digits, '.', '_' or '-'")
      .optional(),
  ),
  JWT_ACCESS_SECRET: optionalString,
  JWT_SECRET: optionalString,
  JWT_REFRESH_SECRET: optionalString,
  COOKIE_SECRET: optionalString,
  CORS_ORIGIN: httpUrl,
  ACCESS_TOKEN_TTL_SECONDS: optionalPositiveInt(86_400),
  REFRESH_TOKEN_TTL_DAYS: optionalPositiveInt(365),
  WEBHOOK_RATE_LIMIT_PER_MINUTE: optionalPositiveInt(),
  API_SHUTDOWN_TIMEOUT_MS: optionalPositiveInt(600_000),
});

export const workerEnvSchema = z.object({
  ...sharedShape,
  ...storageShape,
  ...metricsShape,
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
  APP_ENCRYPTION_KEY: optionalString,
  APP_ENCRYPTION_KEY_ID: apiEnvSchema.shape.APP_ENCRYPTION_KEY_ID,
  WORKER_HTTP_PORT: optionalPositiveInt(65_535),
  WORKER_HTTP_HOST: optionalString,
  WORKER_CONCURRENCY: optionalPositiveInt(1_000),
  WORKER_SHUTDOWN_TIMEOUT_MS: optionalPositiveInt(600_000),
  STORAGE_ORPHAN_DELETE_ENABLED: optionalBooleanFlag(),
  STORAGE_ORPHAN_RECONCILIATION_LIMIT: optionalPositiveInt(100_000),
  STORAGE_ORPHAN_RECONCILIATION_INTERVAL_MS: optionalPositiveInt(),
  // Live Instagram statistics refresh (instagram.insights.account per active account); 0 disables.
  INSTAGRAM_INSIGHTS_INTERVAL_MS: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^\d+$/, "must be 0 or a positive integer").transform((value) => Number.parseInt(value, 10)).optional(),
  ),
});

export const migratorEnvSchema = z.object({
  ...sharedShape,
  DATABASE_URL: postgresUrl,
  TARGET_DATABASE_URL: postgresUrl,
  SOURCE_DATABASE_URL: postgresUrl,
  MIGRATION_APPLY_ENABLED: optionalBooleanFlag(),
  MIGRATION_BATCH_SIZE: optionalPositiveInt(),
  MIGRATION_BACKUP_MAX_AGE_HOURS: optionalPositiveNumber(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type MigratorEnv = z.infer<typeof migratorEnvSchema>;

interface ServiceEnvMap {
  api: ApiEnv;
  worker: WorkerEnv;
  migrator: MigratorEnv;
}

const schemas = {
  api: apiEnvSchema,
  worker: workerEnvSchema,
  migrator: migratorEnvSchema,
} as const;

interface StrictRules {
  required: readonly string[];
  /** At least one of each group must be present. */
  requiredOneOf: readonly (readonly string[])[];
  secrets: readonly string[];
}

const strictRules: Record<ServiceName, StrictRules> = {
  api: {
    required: ["DATABASE_URL", "REDIS_URL", "APP_ENCRYPTION_KEY", "JWT_ACCESS_SECRET"],
    requiredOneOf: [],
    secrets: [
      "APP_ENCRYPTION_KEY",
      "JWT_ACCESS_SECRET",
      "JWT_SECRET",
      "JWT_REFRESH_SECRET",
      "COOKIE_SECRET",
      "METRICS_BEARER_TOKEN",
    ],
  },
  worker: {
    required: ["DATABASE_URL", "REDIS_URL", "APP_ENCRYPTION_KEY"],
    requiredOneOf: [],
    secrets: ["APP_ENCRYPTION_KEY", "METRICS_BEARER_TOKEN"],
  },
  migrator: {
    required: [],
    requiredOneOf: [["TARGET_DATABASE_URL", "DATABASE_URL"]],
    secrets: [],
  },
};

export function resolveAppEnvironment(env: EnvSource): AppEnvironment {
  const explicit = env.APP_ENV?.trim();
  if (explicit && (appEnvironments as readonly string[]).includes(explicit)) {
    return explicit as AppEnvironment;
  }
  if (env.NODE_ENV === "production") return "production";
  if (env.NODE_ENV === "test") return "test";
  return "local";
}

function isPresent(env: EnvSource, name: string): boolean {
  return typeof env[name] === "string" && env[name]!.trim() !== "";
}

function looksLikeDevelopmentSecret(value: string): boolean {
  const lower = value.toLowerCase();
  return developmentSecretMarkers.some((marker) => lower.includes(marker));
}

function zodIssuesToServiceIssues(error: z.ZodError): ServiceEnvIssue[] {
  return error.issues.map((issue) => ({
    variable: issue.path.map(String).join(".") || "(root)",
    // Zod messages for these schemas describe the rule, never the received value.
    message: issue.message,
  }));
}

/**
 * Validates a service environment and returns the parsed values.
 * Throws {@link ServiceConfigError} with a secret-free message on failure.
 */
export function validateServiceEnv<S extends ServiceName>(
  service: S,
  env: EnvSource,
): ServiceEnvMap[S] & { appEnv: AppEnvironment } {
  const appEnv = resolveAppEnvironment(env);
  const issues: ServiceEnvIssue[] = [];

  const parsed = schemas[service].safeParse(env);
  if (!parsed.success) {
    issues.push(...zodIssuesToServiceIssues(parsed.error));
  }

  const rules = strictRules[service];
  const strict = strictAppEnvironments.includes(appEnv);

  if (strict) {
    for (const name of rules.required) {
      if (!isPresent(env, name)) {
        issues.push({ variable: name, message: `is required when APP_ENV=${appEnv}` });
      }
    }
    for (const group of rules.requiredOneOf) {
      if (!group.some((name) => isPresent(env, name))) {
        issues.push({
          variable: group.join(" | "),
          message: `one of these is required when APP_ENV=${appEnv}`,
        });
      }
    }
    for (const name of rules.secrets) {
      if (!isPresent(env, name)) continue;
      const value = env[name]!;
      if (value.length < minimumSecretLength) {
        issues.push({ variable: name, message: `must be at least ${minimumSecretLength} characters` });
      }
      if (looksLikeDevelopmentSecret(value)) {
        issues.push({ variable: name, message: "must not use a development default value" });
      }
    }
  }

  if (service !== "migrator" && env.METRICS_ENABLED === "true") {
    if (!isPresent(env, "METRICS_BEARER_TOKEN") && !isPresent(env, "METRICS_PORT")) {
      issues.push({
        variable: "METRICS_BEARER_TOKEN | METRICS_PORT",
        message: "one of these is required when METRICS_ENABLED=true (otherwise /metrics stays disabled)",
      });
    }
  }

  const s3Group = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_MEDIA"];
  if (service !== "migrator" && s3Group.some((name) => isPresent(env, name))) {
    for (const name of s3Group) {
      if (!isPresent(env, name)) {
        issues.push({ variable: name, message: "is required when any S3_* storage variable is set" });
      }
    }
  }

  if (issues.length > 0 || !parsed.success) {
    throw new ServiceConfigError(service, appEnv, issues);
  }

  return { ...(parsed.data as ServiceEnvMap[S]), appEnv };
}
