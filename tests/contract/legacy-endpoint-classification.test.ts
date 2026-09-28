import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("contracts/legacy/endpoint-classification.json", "utf8")) as {
  groups: Array<{
    inventory_heading: string;
    classification: string;
    target_boundary: string;
    migration_policy: string;
  }>;
};

describe("legacy endpoint classification", () => {
  it("keeps all inventoried API groups classified", () => {
    const headings = manifest.groups.map((group) => group.inventory_heading);

    expect(headings).toEqual([
      "KolayBi",
      "PTT",
      "Surat",
      "Messaging And Admin",
      "AI Agent",
      "Social Comments",
      "Vapi",
      "Meta WhatsApp Cloud",
      "Instagram",
      "Messenger",
      "NetGSM IVR",
      "Vapi Webhook",
    ]);
    expect(manifest.groups.every((group) => group.classification !== "unclassified")).toBe(true);
  });

  it("keeps every classification mapped to a concrete target boundary", () => {
    expect(manifest.groups.every((group) => group.target_boundary.length > 0)).toBe(true);
    expect(manifest.groups.every((group) => group.migration_policy.length > 0)).toBe(true);
  });

  it("covers provider, domain/admin, worker, voice, and webhook surfaces", () => {
    const classifications = new Set(manifest.groups.map((group) => group.classification));

    expect(classifications).toContain("provider_integration");
    expect(classifications).toContain("backend_domain_and_admin_api");
    expect(classifications).toContain("worker_ai_and_admin_settings");
    expect(classifications).toContain("voice_provider_and_webphone");
    expect(classifications).toContain("webhook_callback");
  });
});
