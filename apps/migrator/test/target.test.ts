import { describe, expect, it } from "vitest";
import { assertCanonicalTargetTable, mapCanonicalRecordToInsert } from "../src/target.js";

describe("database migration target", () => {
  it("maps canonical records to public_id keyed inserts", () => {
    expect(
      mapCanonicalRecordToInsert({
        targetTable: "customers",
        targetId: "cus_1",
        checksum: "sha256:customer",
        payload: {
          full_name: "Ada Lovelace",
          phone: null,
          email: "ada@example.com",
          username: null,
          notes: null,
        },
      }),
    ).toEqual({
      public_id: "cus_1",
      full_name: "Ada Lovelace",
      phone: null,
      email: "ada@example.com",
      username: null,
      notes: null,
    });
  });

  it("rejects unknown target tables before touching the database", () => {
    expect(() => assertCanonicalTargetTable("legacy_musteriler")).toThrow(
      "Unsupported canonical target table",
    );
  });

  it("rejects reserved canonical columns from migrated payloads", () => {
    expect(() =>
      mapCanonicalRecordToInsert({
        targetTable: "customers",
        targetId: "cus_1",
        checksum: "sha256:customer",
        payload: {
          id: 100,
          full_name: "Ada Lovelace",
        },
      }),
    ).toThrow("reserved columns");

    expect(() =>
      mapCanonicalRecordToInsert({
        targetTable: "customers",
        targetId: "cus_1",
        checksum: "sha256:customer",
        payload: {
          public_id: "legacy-controlled-id",
          full_name: "Ada Lovelace",
        },
      }),
    ).toThrow("reserved columns");
  });
});
