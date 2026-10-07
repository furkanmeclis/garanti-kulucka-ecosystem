import { describe, expect, it } from "vitest";
import { apiProviderCatalog } from "../../apps/api/src/providers/catalog.js";
import { providerAdapters } from "../../apps/worker/src/providers/registry.js";

function sorted(values: string[]): string[] {
  return [...values].sort();
}

describe("provider catalog parity", () => {
  it("keeps the API provider catalog aligned with worker adapter boundaries", () => {
    const apiCatalogByProvider = new Map(
      apiProviderCatalog.map((item) => [item.provider, item]),
    );
    const workerAdaptersByProvider = new Map(
      providerAdapters.map((adapter) => [adapter.provider, adapter]),
    );

    expect(sorted([...apiCatalogByProvider.keys()])).toEqual(
      sorted([...workerAdaptersByProvider.keys()]),
    );

    for (const [provider, apiItem] of apiCatalogByProvider) {
      const workerAdapter = workerAdaptersByProvider.get(provider);

      expect(workerAdapter, provider).toBeDefined();
      expect(sorted(apiItem.channels)).toEqual(sorted(workerAdapter?.channels ?? []));
      expect(sorted(apiItem.supported_operations)).toEqual(
        sorted([
          ...(workerAdapter?.webhook_operations ?? []),
          ...(workerAdapter?.delivery_operations ?? []),
        ]),
      );
      expect(apiItem.contract_mode).toBe("fixture_only");
      expect(apiItem.live_call_permitted).toBe(false);
      expect(workerAdapter?.live_calls_enabled).toBe(
        provider === "ptt" ||
          provider === "surat" ||
          provider === "kolaybi" ||
          provider === "whatsapp" ||
          provider === "instagram" ||
          provider === "messenger" ||
          provider === "netgsm" ||
          provider === "vapi" ||
          provider === "smtp",
      );
    }
  });
});
