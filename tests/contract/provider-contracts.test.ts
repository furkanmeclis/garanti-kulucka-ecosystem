import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { providerAttemptSchema, providerRequestEnvelopeSchema } from "../../packages/shared/src/index.js";

const providerFixtureRoot = new URL("../../contracts/providers", import.meta.url);
const forbiddenSecretKeys = [
  "access_token",
  "refresh_token",
  "authorization",
  "api_key",
  "apikey",
  "password",
  "secret",
];

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

function parseJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
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
