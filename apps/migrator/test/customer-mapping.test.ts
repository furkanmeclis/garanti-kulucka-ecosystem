import { describe, expect, it } from "vitest";
import { transformLegacyCustomer } from "../src/customer-mapping.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import type { LegacyRecord } from "../src/types.js";

const customerId = "0A32CE63-4C3B-4FD4-917D-726D540A7216";

function fixture(overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id: customerId,
    ad: "  Çağrı  ",
    soyad: "  IŞIK ",
    email: " c.agri@example.test ",
    telefon: " +90 555 000 00 01 ",
    adres: " Atatürk Cad. No: 1 ",
    il: " İstanbul ",
    ilce: " Kadıköy ",
    posta_kodu: " 34710 ",
    notlar: "  Karma müşteri notu  ",
    woocommerce_id: 900719,
    kolaybi_id: "kb-42",
    olusturma_tarihi: "2024-01-02T03:04:05+03:00",
    guncelleme_tarihi: new Date("2025-06-07T08:09:10.123Z"),
    username: "  cagri.isik  ",
    ...overrides,
  };
  return {
    sourceSystem: "legacy_supabase",
    sourceTable: "public.musteriler",
    sourceId: customerId.toLowerCase(),
    checksum: calculateSourcePayloadChecksum(payload),
    payload,
  };
}

describe("transformLegacyCustomer", () => {
  it("maps a Turkish/mixed customer, default address, and unresolved commerce facts", () => {
    const result = transformLegacyCustomer(fixture());

    expect(result.customer).toMatchObject({
      kind: "legacy_customer_draft",
      targetTable: "customers",
      publicId: expect.stringMatching(/^cus_[0-9a-f]{24}$/),
      mappingRole: "primary",
      full_name: "Çağrı IŞIK",
      phone: "+90 555 000 00 01",
      email: "c.agri@example.test",
      username: "cagri.isik",
      notes: "Karma müşteri notu",
      legacyTimestamps: {
        createdAt: "2024-01-02T00:04:05.000000Z",
        updatedAt: "2025-06-07T08:09:10.123000Z",
      },
    });
    expect(result.customer).not.toHaveProperty("checksum");
    expect(result.address).toMatchObject({
      kind: "legacy_customer_address_draft",
      targetTable: "customer_addresses",
      publicId: expect.stringMatching(/^caddr_[0-9a-f]{24}$/),
      mappingRole: "address:default",
      customerPublicId: result.customer.publicId,
      label: "Default",
      address_line: "Atatürk Cad. No: 1",
      district: "Kadıköy",
      city: "İstanbul",
      country: "TR",
      postal_code: "34710",
      is_default: true,
      legacyTimestamps: result.customer.legacyTimestamps,
    });
    expect(result.sourcePayloadChecksum).toBe(fixture().checksum);
    for (const draft of [result.customer, result.address]) {
      expect(draft).not.toHaveProperty("targetId");
      expect(draft).not.toHaveProperty("payload");
      expect(draft).not.toHaveProperty("checksum");
    }
    expect(result.externalIdentityCandidates).toEqual([
      {
        kind: "unresolved_customer_external_identity",
        customerPublicId: result.customer.publicId,
        providerKey: "woocommerce",
        externalId: "900719",
        source: { table: "public.musteriler", field: "woocommerce_id" },
        legacyTimestamps: result.customer.legacyTimestamps,
      },
      {
        kind: "unresolved_customer_external_identity",
        customerPublicId: result.customer.publicId,
        providerKey: "kolaybi",
        externalId: "kb-42",
        source: { table: "public.musteriler", field: "kolaybi_id" },
        legacyTimestamps: result.customer.legacyTimestamps,
      },
    ]);
    for (const candidate of result.externalIdentityCandidates) {
      expect(candidate).not.toHaveProperty("proposedPublicId");
      expect(candidate).not.toHaveProperty("mappingRole");
      expect(candidate).not.toHaveProperty("checksum");
    }
    expect(result.warnings).toEqual([]);
  });

  it("uses username and then a deterministic non-PII fallback for an empty name", () => {
    expect(transformLegacyCustomer(fixture({ ad: " ", soyad: null })).customer.full_name).toBe("cagri.isik");

    const first = transformLegacyCustomer(fixture({ ad: " ", soyad: " ", username: " " }));
    const second = transformLegacyCustomer(fixture({ ad: "", soyad: null, username: null }));
    expect(first.customer.full_name).toMatch(/^Legacy Customer [0-9a-f]{10}$/);
    expect(second.customer.full_name).toBe(first.customer.full_name);
    expect(first.warnings).toEqual([{
      code: "customer_name_fallback",
      message: "Customer name and username were blank; a deterministic non-PII fallback was used",
    }]);
    expect(first.warnings[0]?.message).not.toContain(customerId.toLowerCase());
  });

  it("omits an address when every address component is blank", () => {
    expect(transformLegacyCustomer(fixture({
      adres: "\u200B",
      il: null,
      ilce: "",
      posta_kodu: null,
    })).address).toBeNull();
  });

  it("builds a deterministic nonblank address line from partial components", () => {
    expect(transformLegacyCustomer(fixture({
      adres: null,
      il: " Ankara ",
      ilce: " Çankaya ",
      posta_kodu: "06420",
    })).address).toMatchObject({
      address_line: "Çankaya, Ankara, 06420",
      district: "Çankaya",
      city: "Ankara",
      postal_code: "06420",
    });
  });

  it.each([
    ["ig_178414000000001", "instagram", "178414000000001"],
    ["fb_987654321", "messenger", "987654321"],
  ])("extracts %s as an unresolved social identity and removes it from canonical phone", (
    telefon,
    providerKey,
    externalId,
  ) => {
    const result = transformLegacyCustomer(fixture({ telefon, woocommerce_id: null, kolaybi_id: null }));
    expect(result.customer.phone).toBeNull();
    expect(result.externalIdentityCandidates).toEqual([
      expect.objectContaining({
        kind: "unresolved_customer_external_identity",
        providerKey,
        externalId,
      }),
    ]);
  });

  it("covers all four provider candidate contracts", () => {
    const commerce = transformLegacyCustomer(fixture({ telefon: "+90555", woocommerce_id: 12, kolaybi_id: "K-12" }));
    const instagram = transformLegacyCustomer(fixture({ telefon: "ig_ig-user", woocommerce_id: null, kolaybi_id: null }));
    const messenger = transformLegacyCustomer(fixture({ telefon: "fb_psid-user", woocommerce_id: null, kolaybi_id: null }));
    expect([
      ...commerce.externalIdentityCandidates,
      ...instagram.externalIdentityCandidates,
      ...messenger.externalIdentityCandidates,
    ].map(({ providerKey }) => providerKey)).toEqual(["woocommerce", "kolaybi", "instagram", "messenger"]);
  });

  it("normalizes human text while preserving semantic joiners in opaque external IDs", () => {
    const result = transformLegacyCustomer(fixture({
      ad: "\u200B C\u0327ag\u0306rı \uFEFF",
      soyad: " Is\u0327ık ",
      email: "\u2060\u200Buser\u2060\u200B@example.test\uFEFF\u2060",
      username: "\u200Buser\u200Bname\uFEFF",
      telefon: "ig_account\u200D-1",
      woocommerce_id: null,
      kolaybi_id: "kb\u200C-42",
      notlar: "\u200BAile: 👨\u200D👩\u200D👧\uFEFF",
    }));

    expect(result.customer.full_name).toBe("Çağrı Işık");
    expect(result.customer.email).toBe("user@example.test");
    expect(result.customer.username).toBe("username");
    expect(result.customer.notes).toBe("Aile: 👨\u200D👩\u200D👧");
    expect(result.externalIdentityCandidates).toEqual([
      expect.objectContaining({ providerKey: "kolaybi", externalId: "kb\u200C-42" }),
      expect.objectContaining({ providerKey: "instagram", externalId: "account\u200D-1" }),
    ]);

    const zwnj = transformLegacyCustomer(fixture({
      telefon: "ig_account\u200C-2",
      woocommerce_id: null,
      kolaybi_id: null,
    }));
    expect(zwnj.externalIdentityCandidates[0]?.externalId).toBe("account\u200C-2");
  });

  it("preserves composed and decomposed provider IDs as distinct opaque values", () => {
    const decomposed = transformLegacyCustomer(fixture({
      telefon: "ig_e\u0301",
      woocommerce_id: null,
      kolaybi_id: "e\u0301",
    }));
    const composed = transformLegacyCustomer(fixture({
      telefon: "ig_é",
      woocommerce_id: null,
      kolaybi_id: "é",
    }));

    expect(decomposed.externalIdentityCandidates.map(({ externalId }) => externalId)).toEqual(["e\u0301", "e\u0301"]);
    expect(composed.externalIdentityCandidates.map(({ externalId }) => externalId)).toEqual(["é", "é"]);
    expect(decomposed.externalIdentityCandidates).not.toEqual(composed.externalIdentityCandidates);
    expect(decomposed.sourcePayloadChecksum).not.toBe(composed.sourcePayloadChecksum);
  });

  it.each(["\u200B", "\u2060", "\uFEFF"])(
    "rejects forbidden invisible %s in opaque external IDs without leaking the value",
    (mark) => {
      const secret = `account${mark}-ayse@example.test`;
      for (const record of [
        fixture({ telefon: `ig_${secret}`, woocommerce_id: null, kolaybi_id: null }),
        fixture({ telefon: "+90555", woocommerce_id: null, kolaybi_id: secret }),
      ]) {
        try {
          transformLegacyCustomer(record);
          throw new Error("Expected transformation to fail");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toContain("forbidden invisible characters");
          expect(message).not.toContain(secret);
          expect(message).not.toContain("ayse@example.test");
        }
      }
    },
  );

  it.each([
    { telefon: "ig_ account", kolaybi_id: null },
    { telefon: "ig_account ", kolaybi_id: null },
    { telefon: "+90555", kolaybi_id: " account" },
    { telefon: "+90555", kolaybi_id: "account " },
  ])("rejects boundary whitespace that would alter an opaque identity", (override) => {
    expect(() => transformLegacyCustomer(fixture({
      ...override,
      woocommerce_id: null,
    }))).toThrow("boundary whitespace");
  });

  it("preserves six timestamp digits while converting PostgreSQL and RFC3339 offsets to UTC", () => {
    const result = transformLegacyCustomer(fixture({
      olusturma_tarihi: "2024-01-02 03:04:05.123456+03",
      guncelleme_tarihi: "2024-01-02T03:04:05.9-02:30",
    }));

    expect(result.customer.legacyTimestamps).toEqual({
      createdAt: "2024-01-02T00:04:05.123456Z",
      updatedAt: "2024-01-02T05:34:05.900000Z",
    });
    expect(transformLegacyCustomer(fixture({
      olusturma_tarihi: new Date("2024-01-02T03:04:05.123Z"),
    })).customer.legacyTimestamps.createdAt).toBe("2024-01-02T03:04:05.123000Z");
  });

  it("validates the source payload checksum before transforming but leaves P3 snapshot identity deferred", () => {
    const record = fixture();
    record.payload.email = "changed-after-read@example.test";

    expect(() => transformLegacyCustomer(record)).toThrow("source payload checksum does not match payload");
    expect(() => transformLegacyCustomer({ ...fixture(), checksum: "sha256:legacy" })).toThrow(
      "source payload checksum is invalid",
    );
  });

  it("is deterministic across payload key order and equivalent Date/string timestamps", () => {
    const firstRecord = fixture();
    const reversedPayload = Object.fromEntries(Object.entries(firstRecord.payload).reverse());
    reversedPayload.guncelleme_tarihi = "2025-06-07T08:09:10.123Z";
    const secondRecord = {
      ...firstRecord,
      payload: reversedPayload,
      checksum: calculateSourcePayloadChecksum(reversedPayload),
    };
    expect(transformLegacyCustomer(secondRecord)).toEqual(transformLegacyCustomer(firstRecord));
  });

  it("rejects accessor-bearing payloads without invoking or leaking accessor errors", () => {
    const record = fixture();
    let invoked = false;
    Object.defineProperty(record.payload, "email", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("ayse@example.test");
      },
    });

    expect(() => transformLegacyCustomer(record)).toThrow("payload fields must be enumerable data properties");
    expect(invoked).toBe(false);
    try {
      transformLegacyCustomer(record);
    } catch (error) {
      expect(String(error)).not.toContain("ayse@example.test");
    }
  });

  it("rejects nested accessors at the scalar boundary without invoking them", () => {
    const record = fixture();
    let invoked = false;
    const email = {};
    Object.defineProperty(email, "raw", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("ayse@example.test");
      },
    });
    record.payload.email = email;

    expect(() => transformLegacyCustomer(record)).toThrow("field email must be a string or null");
    expect(invoked).toBe(false);
  });

  it("accepts the RFC3339 maximum offset and rejects offsets beyond it", () => {
    expect(transformLegacyCustomer(fixture({ olusturma_tarihi: "2025-01-01T00:00:00+14:00" }))
      .customer.legacyTimestamps.createdAt).toBe("2024-12-31T10:00:00.000000Z");
    expect(() => transformLegacyCustomer(fixture({ olusturma_tarihi: "2025-01-01T00:00:00+14:01" })))
      .toThrow("olusturma_tarihi");
    expect(() => transformLegacyCustomer(fixture({ olusturma_tarihi: "2025-01-01T00:00:00-15:00" })))
      .toThrow("olusturma_tarihi");
  });

  it("handles leap days, maximum offsets, and six-digit fractions at supported year boundaries", () => {
    expect(transformLegacyCustomer(fixture({
      olusturma_tarihi: "2024-03-01T00:00:00.000001+14:00",
      guncelleme_tarihi: "2024-02-29T23:59:59.999999-14:00",
    })).customer.legacyTimestamps).toEqual({
      createdAt: "2024-02-29T10:00:00.000001Z",
      updatedAt: "2024-03-01T13:59:59.999999Z",
    });

    expect(transformLegacyCustomer(fixture({
      olusturma_tarihi: "0001-01-01T14:00:00.123456+14:00",
      guncelleme_tarihi: "9999-12-31T09:59:59.654321-14:00",
    })).customer.legacyTimestamps).toEqual({
      createdAt: "0001-01-01T00:00:00.123456Z",
      updatedAt: "9999-12-31T23:59:59.654321Z",
    });
  });

  it("fails closed when offset conversion crosses the supported UTC year range", () => {
    for (const timestamp of [
      "0001-01-01T00:00:00.654321+14:00",
      "9999-12-31T23:59:59.123456-14:00",
    ]) {
      expect(() => transformLegacyCustomer(fixture({ olusturma_tarihi: timestamp })))
        .toThrow("olusturma_tarihi");
    }
    expect(() => transformLegacyCustomer(fixture({
      olusturma_tarihi: new Date("0000-12-31T23:59:59.999Z"),
    }))).toThrow("olusturma_tarihi");
  });

  it("rejects an own enumerable __proto__ field as unknown without losing it during inspection", () => {
    const record = fixture();
    Object.defineProperty(record.payload, "__proto__", {
      value: "must-not-disappear",
      enumerable: true,
      configurable: true,
    });
    record.checksum = calculateSourcePayloadChecksum(record.payload);

    expect(Object.keys(record.payload)).toContain("__proto__");
    expect(() => transformLegacyCustomer(record)).toThrow("payload contains unknown fields");
  });

  it.each([
    ["wrong table", () => ({ ...fixture(), sourceTable: "public.customers" }), "source table"],
    ["missing field", () => {
      const record = fixture();
      const { email: _email, ...payload } = record.payload;
      return { ...record, payload, checksum: calculateSourcePayloadChecksum(payload) };
    }, "missing required fields [email]"],
    ["unknown field", () => fixture({ gizli: "sensitive-value" }), "unknown fields"],
    ["invalid id", () => fixture({ id: "not-a-uuid" }), "field id must be a UUID"],
    ["invalid source id", () => ({ ...fixture(), sourceId: "not-a-uuid" }), "field sourceId must be a UUID"],
    ["mismatched id", () => fixture({ id: "df8136b4-1354-4ae6-9bfd-c885a004e585" }), "does not match"],
    ["invalid scalar", () => fixture({ email: 42 }), "field email"],
    ["unsafe integer", () => fixture({ woocommerce_id: Number.MAX_SAFE_INTEGER + 1 }), "PostgreSQL integer"],
    ["out-of-range integer", () => fixture({ woocommerce_id: 2_147_483_648 }), "PostgreSQL integer"],
    ["fractional integer", () => fixture({ woocommerce_id: 1.2 }), "PostgreSQL integer"],
    ["negative integer", () => fixture({ woocommerce_id: -1 }), "non-negative"],
    ["invalid created date", () => fixture({ olusturma_tarihi: "2025-13-01T00:00:00Z" }), "olusturma_tarihi"],
    ["invalid calendar date", () => fixture({ olusturma_tarihi: "2025-02-30T00:00:00Z" }), "olusturma_tarihi"],
    ["invalid updated date", () => fixture({ guncelleme_tarihi: "not-a-timestamp" }), "guncelleme_tarihi"],
    ["blank Instagram suffix", () => fixture({ telefon: "ig_" }), "suffix"],
    ["blank Messenger suffix", () => fixture({ telefon: "fb_" }), "suffix"],
  ])("fails closed for %s", (_label, createRecord, message) => {
    expect(() => transformLegacyCustomer(createRecord() as LegacyRecord)).toThrow(message);
  });

  it("never includes raw PII or malformed values in validation errors", () => {
    const pii = ["ayse@example.test", "+905551112233", "Ayşe Çok Gizli"];
    for (const record of [
      fixture({ email: { raw: pii[0] } }),
      fixture({ telefon: { raw: pii[1] } }),
      fixture({ ad: { raw: pii[2] } }),
      fixture({ [pii[0]!]: "unknown-key" }),
    ]) {
      try {
        transformLegacyCustomer(record);
        throw new Error("Expected transformation to fail");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const value of pii) expect(message).not.toContain(value);
        expect(message).toMatch(/^Invalid legacy customer row:/);
      }
    }
  });

  it("keeps external identities unresolved until a verified account snapshot is available", () => {
    const candidate = transformLegacyCustomer(fixture()).externalIdentityCandidates[0]!;
    expect(candidate).toMatchObject({
      kind: "unresolved_customer_external_identity",
      providerKey: "woocommerce",
      externalId: "900719",
    });
    expect(candidate).not.toHaveProperty("record");
    expect(candidate).not.toHaveProperty("targetId");
    expect(candidate).not.toHaveProperty("mappingRole");
    expect(candidate).not.toHaveProperty("checksum");
  });
});
