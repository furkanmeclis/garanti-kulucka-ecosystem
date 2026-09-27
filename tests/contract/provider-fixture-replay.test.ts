import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type JobEnvelope,
  type ProviderRequestEnvelope,
  providerRequestEnvelopeSchema,
} from "../../packages/shared/src/index.js";
import {
  handleProviderDeliveryJob,
  handleProviderWebhookJob,
} from "../../apps/worker/src/providers/handlers.js";

const providerFixtureRoot = new URL("../../contracts/providers", import.meta.url);
const providerCoveragePath = new URL("../../contracts/providers/coverage.json", import.meta.url);

const providerCoverageSchema = z.object({
  entries: z.array(
    z.discriminatedUnion("status", [
      z.object({
        status: z.literal("covered"),
        fixture_file: z.string().min(1),
      }),
      z.object({
        status: z.literal("pending_legacy_fixture"),
      }),
    ]),
  ),
});

function coveredFixturePaths(): string[] {
  return providerCoverageSchema
    .parse(JSON.parse(readFileSync(providerCoveragePath, "utf8")) as unknown)
    .entries
    .filter((entry): entry is Extract<typeof entry, { status: "covered" }> => entry.status === "covered")
    .map((entry) => join(providerFixtureRoot.pathname, entry.fixture_file))
    .sort();
}

function fixtureName(path: string): string {
  return path.slice(providerFixtureRoot.pathname.length + 1);
}

function readFixture(path: string): ProviderRequestEnvelope {
  return providerRequestEnvelopeSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

function jobForFixture(envelope: ProviderRequestEnvelope, path: string): JobEnvelope {
  const queue = envelope.direction === "inbound" ? "provider-webhooks" : "provider-delivery";
  return {
    job_id: `fixture_replay:${fixtureName(path)}`,
    queue,
    name: `${envelope.provider}.${envelope.operation}`,
    requested_at: envelope.occurred_at,
    payload: {
      envelope,
    },
  };
}

describe("provider fixture replay gate", () => {
  it.each(coveredFixturePaths().map((path) => [fixtureName(path), path]))(
    "replays %s through the fixture-only worker handler",
    (_name, path) => {
      const fixture = readFixture(path);
      const job = jobForFixture(fixture, path);
      const result = fixture.direction === "inbound"
        ? handleProviderWebhookJob(job)
        : handleProviderDeliveryJob(job);

      expect(result).toMatchObject({
        provider: fixture.provider,
        request_id: fixture.request_id,
        queue: job.queue,
        status: "accepted_fixture",
        live_call_performed: false,
        attempt: {
          provider: fixture.provider,
          operation: fixture.operation,
          direction: fixture.direction,
          request_id: fixture.request_id,
          status: "success",
          status_code: 202,
          retry_decision: "none",
          response_metadata: {
            accepted: true,
            live_call_performed: false,
          },
        },
      });
      expect(result.attempt.request_metadata).toMatchObject({
        queue: job.queue,
        job_id: job.job_id,
        channel: fixture.channel,
        fixture_only: true,
        transport_payload: {
          provider: fixture.provider,
          operation: fixture.operation,
          direction: fixture.direction,
          channel: fixture.channel,
          request_id: fixture.request_id,
        },
      });
    },
  );
});
