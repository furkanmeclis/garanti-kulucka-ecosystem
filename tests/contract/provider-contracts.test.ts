import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { providerAttemptSchema, providerRequestEnvelopeSchema } from "../../packages/shared/src/index.js";
import { providerAdapters } from "../../apps/worker/src/providers/registry.js";

const providerFixtureRoot = new URL("../../contracts/providers", import.meta.url);
const providerCoveragePath = new URL("../../contracts/providers/coverage.json", import.meta.url);
const forbiddenSecretKeys = [
  "access_token",
  "refresh_token",
  "authorization",
  "api_key",
  "apikey",
  "password",
  "secret",
];

const providerCoverageEntrySchema = z.discriminatedUnion("status", [
  z.object({
    provider: z.string().min(1),
    operation: z.string().min(1),
    direction: z.enum(["inbound", "outbound"]),
    status: z.literal("covered"),
    fixture_file: z.string().min(1),
  }),
  z.object({
    provider: z.string().min(1),
    operation: z.string().min(1),
    direction: z.enum(["inbound", "outbound"]),
    status: z.literal("pending_legacy_fixture"),
    reason: z.string().min(1),
  }),
]);

const providerCoverageSchema = z.object({
  entries: z.array(providerCoverageEntrySchema).min(1),
});

function providerFixturePaths(): string[] {
  return readdirSync(providerFixtureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((providerDirectory) => {
      const fixtureDirectory = join(providerFixtureRoot.pathname, providerDirectory.name, "fixtures");
      return readdirSync(fixtureDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => join(fixtureDirectory, entry.name));
    })
    .sort();
}

function providerFixtureRelativePaths(): string[] {
  return providerFixturePaths().map((path) =>
    path.slice(providerFixtureRoot.pathname.length + 1),
  );
}

function parseJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function providerCoverage() {
  return providerCoverageSchema.parse(parseJsonFile(providerCoveragePath.pathname));
}

function coverageKey(input: { provider: string; operation: string; direction: string }): string {
  return `${input.provider}:${input.operation}:${input.direction}`;
}

function registeredProviderOperationKeys(): string[] {
  return providerAdapters
    .flatMap((adapter) => [
      ...adapter.webhook_operations.map((operation) =>
        coverageKey({ provider: adapter.provider, operation, direction: "inbound" }),
      ),
      ...adapter.delivery_operations.map((operation) =>
        coverageKey({ provider: adapter.provider, operation, direction: "outbound" }),
      ),
    ])
    .sort();
}

function collectForbiddenSecretKeys(input: unknown, path: string[] = []): string[] {
  if (Array.isArray(input)) {
    return input.flatMap((item, index) => collectForbiddenSecretKeys(item, [...path, String(index)]));
  }

  if (!input || typeof input !== "object") {
    return [];
  }

  return Object.entries(input).flatMap(([key, value]) => {
    const normalized = key.toLowerCase().replaceAll("-", "_");
    const currentPath = [...path, key];
    const ownFinding = forbiddenSecretKeys.includes(normalized) || normalized.endsWith("_token")
      ? [currentPath.join(".")]
      : [];
    return [...ownFinding, ...collectForbiddenSecretKeys(value, currentPath)];
  });
}

describe("provider contract gate", () => {
  it("validates every frozen provider fixture as a request envelope", () => {
    const paths = providerFixturePaths();

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(() => providerRequestEnvelopeSchema.parse(parseJsonFile(path)), path).not.toThrow();
    }
  });

  it("keeps frozen provider fixtures free of secret-looking keys", () => {
    for (const path of providerFixturePaths()) {
      expect(collectForbiddenSecretKeys(parseJsonFile(path)), path).toEqual([]);
    }
  });

  it("tracks every registered provider operation in the fixture coverage manifest", () => {
    const entries = providerCoverage().entries;

    expect(entries.map(coverageKey).sort()).toEqual(registeredProviderOperationKeys());
    expect(new Set(entries.map(coverageKey)).size).toBe(entries.length);
  });

  it("keeps covered fixture manifest entries aligned with frozen fixtures", () => {
    const referencedFixtures = providerCoverage().entries
      .filter((entry) => entry.status === "covered")
      .map((entry) => entry.fixture_file)
      .sort();

    expect(referencedFixtures).toEqual(providerFixtureRelativePaths());

    for (const entry of providerCoverage().entries) {
      if (entry.status !== "covered") {
        continue;
      }

      const fixture = providerRequestEnvelopeSchema.parse(
        parseJsonFile(join(providerFixtureRoot.pathname, entry.fixture_file)),
      );

      expect(fixture.provider).toBe(entry.provider);
      expect(fixture.operation).toBe(entry.operation);
      expect(fixture.direction).toBe(entry.direction);
    }
  });

  it("keeps provider attempts credential-free and fixture-driven", () => {
    const attempt = providerAttemptSchema.parse({
      provider: "ptt",
      operation: "shipment.create",
      direction: "outbound",
      request_id: "req_contract",
      started_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      duration_ms: 120,
      status: "success",
      status_code: 202,
      retry_decision: "none",
      next_retry_at: null,
      idempotency_key: "shipment_1",
      request_metadata: {
        fixture_only: true,
      },
      response_metadata: {
        accepted: true,
      },
      error: null,
    });

    expect(attempt).not.toHaveProperty("access_token");
    expect(attempt.request_metadata).not.toHaveProperty("access_token");
    expect(attempt.provider).toBe("ptt");
  });
});
