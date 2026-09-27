import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { assertProviderEnvelope } from "./registry.js";

export interface ProviderTransportPolicy {
  contract_mode: "fixture_only";
  live_call_permitted: false;
  reason: "legacy_fixture_replay_required";
}

export function providerTransportPolicyFor(envelope: ProviderRequestEnvelope): ProviderTransportPolicy {
  const adapter = assertProviderEnvelope(
    envelope,
    envelope.direction === "inbound" ? "webhook" : "delivery",
  );

  if (adapter.live_calls_enabled) {
    throw new Error(`Provider live-call policy is not implemented for ${envelope.provider}`);
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
