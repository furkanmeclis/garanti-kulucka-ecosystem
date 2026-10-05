import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { assertProviderEnvelope } from "./registry.js";

export interface FixtureProviderTransportPolicy {
  contract_mode: "fixture_only";
  live_call_permitted: false;
  reason: "legacy_fixture_replay_required";
}

export interface LiveProviderTransportPolicy {
  contract_mode: "live";
  live_call_permitted: true;
  reason: "account_live_mode_enabled";
  timeout_ms: number;
  max_attempts: number;
}

export type ProviderTransportPolicy = FixtureProviderTransportPolicy | LiveProviderTransportPolicy;

export interface ProviderTransportPolicyInput {
  liveModeEnabled?: boolean;
  timeoutMs?: number | null;
  maxAttempts?: number | null;
}

export function providerTransportPolicyFor(
  envelope: ProviderRequestEnvelope,
  input: ProviderTransportPolicyInput = {},
): ProviderTransportPolicy {
  const adapter = assertProviderEnvelope(
    envelope,
    envelope.direction === "inbound" ? "webhook" : "delivery",
  );

  if (adapter.live_calls_enabled && input.liveModeEnabled === true) {
    return {
      contract_mode: "live",
      live_call_permitted: true,
      reason: "account_live_mode_enabled",
      timeout_ms: Math.max(1, input.timeoutMs ?? 30_000),
      max_attempts: Math.max(1, input.maxAttempts ?? 3),
    };
  }

  return {
    contract_mode: "fixture_only",
    live_call_permitted: false,
    reason: "legacy_fixture_replay_required",
  };
}

export function assertLiveProviderCallAllowed(envelope: ProviderRequestEnvelope): never {
  const policy = providerTransportPolicyFor(envelope);

  throw new Error(
    `Live provider calls are disabled for ${envelope.provider}.${envelope.operation}: ${policy.reason}`,
  );
}
