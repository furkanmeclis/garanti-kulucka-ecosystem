import { describe, expect, it } from "vitest";
import { apiProviderCatalog, getApiProviderCatalogItem } from "../src/providers/catalog.js";

describe("API provider catalog", () => {
  it("exposes provider contracts in fixture-only mode", () => {
    expect(apiProviderCatalog).toHaveLength(10);
    expect(apiProviderCatalog.every((item) => item.contract_mode === "fixture_only")).toBe(true);
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
});
