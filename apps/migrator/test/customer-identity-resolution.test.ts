import { describe, expect, it } from "vitest";
import {
  assertVerifiedIntegrationAccounts,
  resolveCustomerExternalIdentities,
  transformLegacyCustomer,
} from "../src/index.js";
import type {
  UnresolvedCustomerExternalIdentity,
  VerifiedIntegrationAccount,
} from "../src/index.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import type { LegacyRecord } from "../src/types.js";

const customerId = "0a32ce63-4c3b-4fd4-917d-726d540a7216";

function fixture(overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id: customerId,
    ad: "Çağrı",
    soyad: "Işık",
    email: "c.agri@example.test",
    telefon: "ig_cagri.isik",
    adres: null,
    il: null,
    ilce: null,
    posta_kodu: null,
    notlar: null,
    woocommerce_id: 900719,
    kolaybi_id: "kb-42",
    olusturma_tarihi: "2024-01-02T03:04:05Z",
    guncelleme_tarihi: null,
    username: null,
    ...overrides,
  };
  return {
    sourceSystem: "legacy_supabase",
    sourceTable: "public.musteriler",
    sourceId: customerId,
    checksum: calculateSourcePayloadChecksum(payload),
    payload,
  };
}

function candidates(): readonly UnresolvedCustomerExternalIdentity[] {
  return transformLegacyCustomer(fixture()).externalIdentityCandidates;
}

function account(
  publicId: string,
  providerKey: VerifiedIntegrationAccount["providerKey"],
  status: VerifiedIntegrationAccount["status"] = "active",
): VerifiedIntegrationAccount {
  return { publicId, providerKey, status };
}

function captureError(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected resolution to fail");
}

describe("resolveCustomerExternalIdentities", () => {
  it("resolves a candidate whose provider has exactly one active account", () => {
    const input = candidates();
    const result = resolveCustomerExternalIdentities(input, [
      account("iac_woo_main", "woocommerce"),
      account("iac_kolaybi_old", "kolaybi", "inactive"),
    ]);

    expect(result.resolved).toEqual([
      {
        kind: "legacy_customer_external_identity_draft",
        targetTable: "customer_external_identities",
        publicId: expect.stringMatching(/^cext_[0-9a-f]{24}$/),
        mappingRole: "external_identity:woocommerce",
        customerPublicId: input[0]!.customerPublicId,
        integrationAccountPublicId: "iac_woo_main",
        externalId: "900719",
        legacyTimestamps: input[0]!.legacyTimestamps,
      },
    ]);
    for (const draft of result.resolved) {
      expect(draft).not.toHaveProperty("checksum");
      expect(draft).not.toHaveProperty("targetId");
      expect(draft).not.toHaveProperty("payload");
    }
    expect(result.unresolved).toEqual([input[1], input[2]]);
    for (const candidate of result.unresolved) expect(candidate).not.toHaveProperty("mappingRole");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.resolved)).toBe(true);
    expect(Object.isFrozen(result.unresolved)).toBe(true);
    expect(Object.isFrozen(result.resolved[0])).toBe(true);
    expect(Object.isFrozen(result.resolved[0]!.legacyTimestamps)).toBe(true);
  });

  it("keeps resolved drafts and unresolved candidates in input order", () => {
    const input = candidates();
    const result = resolveCustomerExternalIdentities(input, [
      account("iac_instagram", "instagram"),
      account("iac_woo", "woocommerce"),
    ]);

    expect(result.resolved.map((draft) => draft.mappingRole)).toEqual([
      "external_identity:woocommerce",
      "external_identity:instagram",
    ]);
    expect(result.resolved.map((draft) => draft.externalId)).toEqual(["900719", "cagri.isik"]);
    expect(result.unresolved.map((candidate) => candidate.providerKey)).toEqual(["kolaybi"]);
  });

  it("never resolves against an inactive account", () => {
    const input = candidates();
    const result = resolveCustomerExternalIdentities(input, [
      account("iac_woo_old", "woocommerce", "inactive"),
      account("iac_kolaybi_old", "kolaybi", "inactive"),
      account("iac_ig_old", "instagram", "inactive"),
    ]);

    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual(input);
  });

  it("leaves every candidate unresolved for an empty snapshot", () => {
    const input = candidates();
    const result = resolveCustomerExternalIdentities(input, []);

    expect(result).toEqual({ resolved: [], unresolved: input });
    expect(Object.isFrozen(result.unresolved)).toBe(true);
  });

  it("throws when more than one active account exists for a provider", () => {
    const message = captureError(() => resolveCustomerExternalIdentities(candidates(), [
      account("iac_woo_a", "woocommerce"),
      account("iac_woo_b", "woocommerce"),
    ]));

    expect(message).toBe("Invalid integration account snapshot: provider woocommerce has more than one active account");
  });

  it("throws on an ambiguous snapshot even when no candidate uses that provider", () => {
    expect(() => resolveCustomerExternalIdentities([], [
      account("iac_msg_a", "messenger"),
      account("iac_msg_b", "messenger"),
    ])).toThrow(/^Invalid integration account snapshot:/);
  });

  it("throws on a duplicate public id even when statuses differ", () => {
    const message = captureError(() => resolveCustomerExternalIdentities(candidates(), [
      account("iac_shared", "woocommerce"),
      account("iac_shared", "kolaybi", "inactive"),
    ]));

    expect(message).toBe("Invalid integration account snapshot: account at index 1 duplicates a public id");
  });

  it.each([
    ["blank public id", { publicId: "", providerKey: "woocommerce", status: "active" }, "has a blank or illegal public id"],
    ["illegal public id", { publicId: "IAC_Upper", providerKey: "woocommerce", status: "active" }, "has a blank or illegal public id"],
    ["overlong public id", { publicId: `iac_${"a".repeat(65)}`, providerKey: "woocommerce", status: "active" }, "has a blank or illegal public id"],
    ["unknown provider", { publicId: "iac_x", providerKey: "shopify", status: "active" }, "has an unknown provider"],
    ["unknown status", { publicId: "iac_x", providerKey: "woocommerce", status: "paused" }, "has an unknown status"],
  ])("throws on a %s", (_label, invalid, reason) => {
    const message = captureError(() => resolveCustomerExternalIdentities(candidates(), [
      account("iac_ok", "kolaybi"),
      invalid as unknown as VerifiedIntegrationAccount,
    ]));

    expect(message).toBe(`Invalid integration account snapshot: account at index 1 ${reason}`);
  });

  it("validates the whole snapshot before resolving any candidate", () => {
    expect(() => resolveCustomerExternalIdentities(candidates(), [
      account("iac_woo", "woocommerce"),
      { publicId: "iac_bad", providerKey: "woocommerce", status: "paused" } as unknown as VerifiedIntegrationAccount,
    ])).toThrow(/unknown status/);
  });

  it("produces stable public ids from the same inputs", () => {
    const accounts = [account("iac_woo", "woocommerce"), account("iac_kb", "kolaybi")];
    const first = resolveCustomerExternalIdentities(candidates(), accounts);
    const second = resolveCustomerExternalIdentities(candidates(), accounts);

    expect(second).toEqual(first);
    expect(new Set(first.resolved.map((draft) => draft.publicId)).size).toBe(2);

    const otherAccount = resolveCustomerExternalIdentities(candidates(), [account("iac_woo_2", "woocommerce")]);
    expect(otherAccount.resolved[0]!.publicId).not.toBe(first.resolved[0]!.publicId);

    const otherCustomerId = "1b43df74-5d4c-4ae5-a28e-837e651b8327";
    const otherCustomer = transformLegacyCustomer({
      ...fixture({ id: otherCustomerId }),
      sourceId: otherCustomerId,
    }).externalIdentityCandidates;
    const otherResult = resolveCustomerExternalIdentities(otherCustomer, accounts);
    expect(otherResult.resolved[0]!.publicId).not.toBe(first.resolved[0]!.publicId);
  });

  it("does not mutate the candidates or the account snapshot", () => {
    const input = candidates().map((candidate) => ({
      ...candidate,
      source: { ...candidate.source },
      legacyTimestamps: { ...candidate.legacyTimestamps },
    }));
    const accounts = [account("iac_woo", "woocommerce"), account("iac_kb", "kolaybi", "inactive")];
    const inputSnapshot = structuredClone(input);
    const accountsSnapshot = structuredClone(accounts);

    resolveCustomerExternalIdentities(input, accounts);

    expect(input).toEqual(inputSnapshot);
    expect(accounts).toEqual(accountsSnapshot);
    expect(Object.isFrozen(input[0])).toBe(false);
    expect(Object.isFrozen(accounts[0])).toBe(false);
    expect(Object.isFrozen(accounts)).toBe(false);
  });

  it("never includes a public id or external id in snapshot errors", () => {
    const secrets = ["iac_secret_woo", "iac_secret_dup", "900719", "kb-42", "cagri.isik"];
    for (const accounts of [
      [account("iac_secret_woo", "woocommerce"), account("iac_secret_dup", "woocommerce")],
      [account("iac_secret_dup", "woocommerce"), account("iac_secret_dup", "kolaybi", "inactive")],
      [{ publicId: "iac_secret_woo", providerKey: "900719", status: "active" }],
      [{ publicId: "iac_secret_woo", providerKey: "woocommerce", status: "kb-42" }],
      [{ publicId: "iac_secret woo 900719", providerKey: "woocommerce", status: "active" }],
    ] as unknown as VerifiedIntegrationAccount[][]) {
      const message = captureError(() => resolveCustomerExternalIdentities(candidates(), accounts));
      expect(message).toMatch(/^Invalid integration account snapshot:/);
      for (const secret of secrets) expect(message).not.toContain(secret);
    }
  });

  it("copies only declared fields into unresolved candidates", () => {
    const input = candidates().map((candidate) => ({
      ...candidate,
      token: "tok_secret",
      mappingRole: "external_identity:kolaybi",
      source: { ...candidate.source, payload: { email: "c.agri@example.test" } },
      legacyTimestamps: { ...candidate.legacyTimestamps, checksum: "sha256:x" },
    })) as unknown as UnresolvedCustomerExternalIdentity[];

    const result = resolveCustomerExternalIdentities(input, []);

    expect(result.unresolved).toEqual(candidates());
    for (const candidate of result.unresolved) {
      expect(Object.keys(candidate).sort()).toEqual([
        "customerPublicId",
        "externalId",
        "kind",
        "legacyTimestamps",
        "providerKey",
        "source",
      ]);
      expect(Object.keys(candidate.source).sort()).toEqual(["field", "table"]);
      expect(Object.keys(candidate.legacyTimestamps).sort()).toEqual(["createdAt", "updatedAt"]);
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(Object.isFrozen(candidate.source)).toBe(true);
      expect(Object.isFrozen(candidate.legacyTimestamps)).toBe(true);
    }
  });

  it("copies only declared timestamp fields into resolved drafts", () => {
    const input = candidates().map((candidate) => ({
      ...candidate,
      legacyTimestamps: { ...candidate.legacyTimestamps, checksum: "sha256:x" },
    }));

    const result = resolveCustomerExternalIdentities(input, [account("iac_woo", "woocommerce")]);

    expect(Object.keys(result.resolved[0]!.legacyTimestamps).sort()).toEqual(["createdAt", "updatedAt"]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an object", { 0: "900719", length: 1 }],
    ["a string", "900719"],
  ])("rejects %s candidates without echoing values", (_label, invalid) => {
    const message = captureError(() => resolveCustomerExternalIdentities(
      invalid as unknown as UnresolvedCustomerExternalIdentity[],
      [],
    ));

    expect(message).toBe("Invalid customer external identity candidates: candidates must be an array");
  });

  it("rejects a non-object candidate by index without echoing its value", () => {
    const message = captureError(() => resolveCustomerExternalIdentities(
      [...candidates(), "tok_secret 900719"] as unknown as UnresolvedCustomerExternalIdentity[],
      [],
    ));

    expect(message).toBe("Invalid customer external identity candidates: candidate at index 3 must be an object");
  });
});

describe("assertVerifiedIntegrationAccounts", () => {
  it("accepts an empty or valid snapshot", () => {
    expect(() => assertVerifiedIntegrationAccounts([])).not.toThrow();
    expect(() => assertVerifiedIntegrationAccounts([
      account("iac_woo", "woocommerce"),
      account("iac_woo_old", "woocommerce", "inactive"),
      account("iac_kb", "kolaybi"),
    ])).not.toThrow();
  });

  it.each([
    ["a non-array", { length: 0 }, "accounts must be an array"],
    ["an ambiguous provider", [
      account("iac_secret_a", "messenger"),
      account("iac_secret_b", "messenger"),
    ], "provider messenger has more than one active account"],
    ["a duplicate public id", [
      account("iac_secret_a", "woocommerce"),
      account("iac_secret_a", "kolaybi", "inactive"),
    ], "account at index 1 duplicates a public id"],
  ])("rejects %s without echoing public ids", (_label, invalid, reason) => {
    const message = captureError(() => assertVerifiedIntegrationAccounts(invalid));

    expect(message).toBe(`Invalid integration account snapshot: ${reason}`);
    expect(message).not.toContain("iac_secret");
  });
});
