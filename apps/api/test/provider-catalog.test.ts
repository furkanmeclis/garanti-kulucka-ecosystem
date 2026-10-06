import { describe, expect, it } from "vitest";
import { apiProviderCatalog, getApiProviderCatalogItem } from "../src/providers/catalog.js";

describe("API provider catalog", () => {
  it("exposes provider contracts in fixture-only mode", () => {
    expect(apiProviderCatalog).toHaveLength(10);
    expect(apiProviderCatalog.every((item) => item.contract_mode === "fixture_only")).toBe(true);
    expect(apiProviderCatalog.every((item) => item.live_call_permitted === false)).toBe(true);
    expect(apiProviderCatalog.every((item) => item.live_block_reason === "fixture_replay_contract_required")).toBe(true);
    expect(getApiProviderCatalogItem("ptt").live_feature_flag_key).toBe("providers.ptt.live_mode");
  });

  it("keeps Meta channels separate from direct channel providers", () => {
    expect(getApiProviderCatalogItem("meta").channels).toEqual([
      "whatsapp",
      "instagram",
      "messenger",
    ]);
    expect(getApiProviderCatalogItem("whatsapp").supported_operations).toContain("message.send");
  });

  it("keeps SIP scoped to config sync", () => {
    expect(getApiProviderCatalogItem("sip").supported_operations).toEqual(["sip.config.sync"]);
  });

  it("keeps VAPI test calls out of the provider contract", () => {
    expect(getApiProviderCatalogItem("vapi").supported_operations).toEqual(["call.webhook", "call.create", "call.get"]);
    expect(getApiProviderCatalogItem("vapi").supported_operations).not.toContain("call.test");
  });
});
