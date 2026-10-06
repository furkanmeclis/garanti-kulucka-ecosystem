import { describe, expect, it } from "vitest";
import {
  assertApplyPrerequisites,
  createLegacyMappingCatalog,
  dryRunMigrationEntities,
  legacyMappingCatalog,
  mappingCatalogVersion,
  validateLegacySourceSnapshots,
  validateLegacyTableColumns,
} from "../src/mapping-catalog.js";
import type { LegacyMappingCatalog } from "../src/mapping-catalog.js";
import type { SourceColumnSnapshot, SourceTableSnapshot } from "../src/types.js";

describe("legacy mapping catalog", () => {
  const customerMapping = legacyMappingCatalog.tables[0]!;
  const conversationMapping = legacyMappingCatalog.tables[1]!;
  const messageMapping = legacyMappingCatalog.tables[2]!;
  const orderMapping = legacyMappingCatalog.tables[3]!;
  const orderItemMapping = legacyMappingCatalog.tables[4]!;
  const shipmentMapping = legacyMappingCatalog.tables[5]!;
  const productMapping = legacyMappingCatalog.tables[6]!;
  const shipmentTrackingEventMapping = legacyMappingCatalog.tables[7]!;

  it("accepts the exact real musteriler schema and declares all customer targets", () => {
    expect(() => validateLegacyTableColumns("public.musteriler", realMusterilerColumns(), customerMapping))
      .not.toThrow();
    expect(customerMapping.targetEntities).toEqual([
      { entity: "customers", mapping: "direct", readiness: "dry-run" },
      { entity: "customer_addresses", mapping: "synthetic", readiness: "apply-ready" },
      { entity: "customer_external_identities", mapping: "synthetic", readiness: "apply-ready" },
    ]);
    expect(customerMapping.columns.map((column) => column.name)).toEqual([
      "id",
      "ad",
      "soyad",
      "email",
      "telefon",
      "adres",
      "il",
      "ilce",
      "posta_kodu",
      "notlar",
      "woocommerce_id",
      "kolaybi_id",
      "olusturma_tarihi",
      "guncelleme_tarihi",
      "username",
    ]);
    expect(mappingCatalogVersion).toBe("p2-live-production-drift-v3");
  });

  it("declares konusmalar and mesajlar as direct dry-run tables after musteriler", () => {
    expect(legacyMappingCatalog.tables.map((table) => [table.sourceTable, table.idColumn])).toEqual([
      ["public.musteriler", "id"],
      ["public.konusmalar", "id"],
      ["public.mesajlar", "id"],
      ["public.siparisler", "id"],
      ["public.siparis_kalemleri", "id"],
      ["public.kargo_gonderimleri", "id"],
      ["public.urunler", "id"],
      ["public.kargo_takip", "id"],
    ]);
    expect(conversationMapping.targetEntities).toEqual([
      { entity: "conversations", mapping: "direct", readiness: "dry-run" },
    ]);
    expect(messageMapping.targetEntities).toEqual([
      { entity: "messages", mapping: "direct", readiness: "dry-run" },
    ]);
    expect(shipmentTrackingEventMapping.targetEntities).toEqual([
      { entity: "shipment_tracking_events", mapping: "direct", readiness: "dry-run" },
    ]);
  });

  it("declares siparisler as a direct dry-run table after mesajlar", () => {
    expect(orderMapping.sourceTable).toBe("public.siparisler");
    expect(orderMapping.idColumn).toBe("id");
    expect(orderMapping.targetEntities).toEqual([
      { entity: "orders", mapping: "direct", readiness: "dry-run" },
    ]);
  });

  it("declares siparis_kalemleri as a direct dry-run table after siparisler", () => {
    expect(orderItemMapping.sourceTable).toBe("public.siparis_kalemleri");
    expect(orderItemMapping.idColumn).toBe("id");
    expect(orderItemMapping.targetEntities).toEqual([
      { entity: "order_items", mapping: "direct", readiness: "dry-run" },
    ]);
  });

  it("declares kargo_gonderimleri as a direct dry-run table after siparis_kalemleri", () => {
    expect(shipmentMapping.sourceTable).toBe("public.kargo_gonderimleri");
    expect(shipmentMapping.idColumn).toBe("id");
    expect(shipmentMapping.targetEntities).toEqual([
      { entity: "shipments", mapping: "direct", readiness: "dry-run" },
    ]);
  });

  it("declares urunler as a direct dry-run table after kargo_gonderimleri", () => {
    expect(productMapping.sourceTable).toBe("public.urunler");
    expect(productMapping.idColumn).toBe("id");
    expect(productMapping.targetEntities).toEqual([
      { entity: "products", mapping: "direct", readiness: "dry-run" },
    ]);
    expect(productMapping.columns[0]).toEqual({
      name: "id",
      dataType: "integer",
      udtName: "int4",
      nullable: false,
      required: true,
    });
  });

  it("accepts the exact real konusmalar schema and requires every column", () => {
    expect(() => validateLegacyTableColumns("public.konusmalar", realKonusmalarColumns(), conversationMapping))
      .not.toThrow();
    expect(conversationMapping.columns).toEqual([
      ...realKonusmalarColumns().slice(0, -1).map(asRequiredContract),
      fullColumnContract("ig_login_type", "text", "text", true, false),
      asRequiredContract(realKonusmalarColumns().at(-1)!),
    ]);
  });

  it.each(["human_agent", "ig_account_id"])("rejects a konusmalar schema missing %s", (name) => {
    expect(() => validateLegacyTableColumns(
      "public.konusmalar",
      realKonusmalarColumns().filter((column) => column.name !== name),
      conversationMapping,
    )).toThrow(`Legacy source schema mismatch for public.konusmalar: missing required columns [${name}]`);
  });

  it("accepts the exact real mesajlar schema and requires every column", () => {
    expect(() => validateLegacyTableColumns("public.mesajlar", realMesajlarColumns(), messageMapping))
      .not.toThrow();
    expect(messageMapping.columns).toEqual([
      ...realMesajlarColumns().slice(0, 5).map(asRequiredContract),
      fullColumnContract("media_url", "text", "text", true, false),
      fullColumnContract("media_type", "text", "text", true, false),
      fullColumnContract("gonderici_adi", "text", "text", true, false),
      ...realMesajlarColumns().slice(5).map(asRequiredContract),
    ]);
  });

  it("accepts the exact real siparisler schema and requires every column", () => {
    expect(() => validateLegacyTableColumns("public.siparisler", realSiparislerColumns(), orderMapping))
      .not.toThrow();
    expect(orderMapping.columns).toEqual([
      ...realSiparislerColumns().slice(0, 10).map(asRequiredContract),
      fullColumnContract("musteri_ulke", "character varying", "varchar", true, false),
      ...realSiparislerColumns().slice(10).map((column) =>
        column.name === "efatura_durumu" ? fullColumnContract("efatura_durumu", column.dataType, column.udtName, column.nullable, false) : asRequiredContract(column),
      ),
    ]);
  });

  it.each(["mukerrer", "kaynak"])("rejects a siparisler schema missing %s", (name) => {
    expect(() => validateLegacyTableColumns(
      "public.siparisler",
      realSiparislerColumns().filter((column) => column.name !== name),
      orderMapping,
    )).toThrow(`Legacy source schema mismatch for public.siparisler: missing required columns [${name}]`);
  });

  it("rejects a boolean teyit_durumu instead of the live varchar column", () => {
    expect(() => validateLegacyTableColumns(
      "public.siparisler",
      replaceColumn(realSiparislerColumns(), "teyit_durumu", { dataType: "boolean", udtName: "bool" }),
      orderMapping,
    )).toThrow("column teyit_durumu expected type character varying/varchar, received boolean/bool");
  });

  it("accepts the exact real siparis_kalemleri schema and requires every column", () => {
    expect(() => validateLegacyTableColumns(
      "public.siparis_kalemleri",
      realSiparisKalemleriColumns(),
      orderItemMapping,
    )).not.toThrow();
    expect(orderItemMapping.columns).toEqual(realSiparisKalemleriColumns().map(asRequiredContract));
  });

  it("rejects a siparis_kalemleri schema missing kolaybi_product_id", () => {
    expect(() => validateLegacyTableColumns(
      "public.siparis_kalemleri",
      realSiparisKalemleriColumns().filter((column) => column.name !== "kolaybi_product_id"),
      orderItemMapping,
    )).toThrow(
      "Legacy source schema mismatch for public.siparis_kalemleri: missing required columns [kolaybi_product_id]",
    );
  });

  it("accepts the exact real kargo_gonderimleri schema and requires every column", () => {
    expect(() => validateLegacyTableColumns(
      "public.kargo_gonderimleri",
      realKargoGonderimleriColumns(),
      shipmentMapping,
    )).not.toThrow();
    expect(shipmentMapping.columns).toEqual(realKargoGonderimleriColumns().map(asRequiredContract));
  });

  it("rejects a kargo_gonderimleri schema missing surat_barkod_no", () => {
    expect(() => validateLegacyTableColumns(
      "public.kargo_gonderimleri",
      realKargoGonderimleriColumns().filter((column) => column.name !== "surat_barkod_no"),
      shipmentMapping,
    )).toThrow(
      "Legacy source schema mismatch for public.kargo_gonderimleri: missing required columns [surat_barkod_no]",
    );
  });

  it("accepts the exact real urunler schema and requires every column", () => {
    expect(() => validateLegacyTableColumns(
      "public.urunler",
      realUrunlerColumns(),
      productMapping,
    )).not.toThrow();
    expect(productMapping.columns).toEqual(realUrunlerColumns().map(asRequiredContract));
  });

  it("accepts the real kargo_takip schema and rejects tracking-number-shaped drift", () => {
    expect(() => validateLegacyTableColumns(
      "public.kargo_takip",
      realKargoTakipColumns(),
      shipmentTrackingEventMapping,
    )).not.toThrow();
    expect(shipmentTrackingEventMapping.columns).toEqual(realKargoTakipColumns().map(asRequiredContract));
    expect(() => validateLegacyTableColumns(
      "public.kargo_takip",
      [
        ...realKargoTakipColumns(),
        { name: "takip_no", ordinalPosition: 7, dataType: "character varying", udtName: "varchar", nullable: false },
      ],
      shipmentTrackingEventMapping,
    )).toThrow("Legacy source schema mismatch for public.kargo_takip: unexpected columns [takip_no]");
  });

  it("rejects a urunler schema missing kolaybi_product_id", () => {
    expect(() => validateLegacyTableColumns(
      "public.urunler",
      realUrunlerColumns().filter((column) => column.name !== "kolaybi_product_id"),
      productMapping,
    )).toThrow(
      "Legacy source schema mismatch for public.urunler: missing required columns [kolaybi_product_id]",
    );
  });

  it("rejects a uuid urunler id instead of the live serial integer", () => {
    expect(() => validateLegacyTableColumns(
      "public.urunler",
      replaceColumn(realUrunlerColumns(), "id", { dataType: "uuid", udtName: "uuid" }),
      productMapping,
    )).toThrow("column id expected type integer/int4, received uuid/uuid");
  });

  it("accepts live media_url/media_type aliases while still requiring Turkish fallback columns", () => {
    expect(() => validateLegacyTableColumns("public.mesajlar", [
      ...realMesajlarColumns(),
      { name: "media_url", ordinalPosition: 11, dataType: "text", udtName: "text", nullable: true },
      { name: "media_type", ordinalPosition: 12, dataType: "text", udtName: "text", nullable: true },
      { name: "gonderici_adi", ordinalPosition: 13, dataType: "text", udtName: "text", nullable: true },
    ], messageMapping)).not.toThrow();
    expect(() => validateLegacyTableColumns(
      "public.mesajlar",
      realMesajlarColumns().filter((column) => column.name !== "medya_url"),
      messageMapping,
    )).toThrow("Legacy source schema mismatch for public.mesajlar: missing required columns [medya_url]");
    expect(() => validateLegacyTableColumns(
      "public.mesajlar",
      [
        ...realMesajlarColumns(),
        { name: "unexpected_media", ordinalPosition: 11, dataType: "text", udtName: "text", nullable: true },
      ],
      messageMapping,
    )).toThrow("Legacy source schema mismatch for public.mesajlar: unexpected columns [unexpected_media]");
  });

  it("rejects a pre-username schema until a lossless row transform exists", () => {
    expect(() => validateLegacyTableColumns(
      "public.musteriler",
      realMusterilerColumns().filter((column) => column.name !== "username"),
      customerMapping,
    )).toThrow("missing required columns [username]");
  });

  it("selects only dry-run-ready targets", () => {
    expect(dryRunMigrationEntities(legacyMappingCatalog)).toEqual([
      "customers",
      "conversations",
      "messages",
      "products",
      "orders",
      "order_items",
      "shipments",
      "shipment_tracking_events",
    ]);
  });

  it("allows customer apply prerequisites only when external identities and addresses are apply-ready", () => {
    expect(() => assertApplyPrerequisites(legacyMappingCatalog, ["customers"])).not.toThrow();
    expect(() => assertApplyPrerequisites(createLegacyMappingCatalog({
      ...legacyMappingCatalog,
      tables: [{
        ...customerMapping,
        targetEntities: customerMapping.targetEntities.filter(
          (target) => target.entity !== "customer_external_identities",
        ),
      }],
    }), ["customers"])).toThrow(
      "Migration entity customers cannot be applied while customer_external_identities is undeclared in catalog",
    );
    expect(() => assertApplyPrerequisites(createLegacyMappingCatalog({
      ...legacyMappingCatalog,
      tables: [{
        ...customerMapping,
        targetEntities: customerMapping.targetEntities.map((target) => target.entity === "customer_external_identities"
          ? { ...target, readiness: "descriptive" as const }
          : target),
      }],
    }), ["customers"])).toThrow(
      "Migration entity customers cannot be applied while customer_external_identities is descriptive in catalog",
    );
    expect(() => assertApplyPrerequisites(createLegacyMappingCatalog({
      ...legacyMappingCatalog,
      tables: [{
        ...customerMapping,
        targetEntities: customerMapping.targetEntities.filter(
          (target) => target.entity !== "customer_addresses",
        ),
      }],
    }), ["customers"])).toThrow(
      "Migration entity customers cannot be applied while customer_addresses is undeclared in catalog",
    );
    expect(() => assertApplyPrerequisites(createLegacyMappingCatalog({
      ...legacyMappingCatalog,
      tables: [{
        ...customerMapping,
        targetEntities: customerMapping.targetEntities.map((target) => {
          if (target.entity === "customer_addresses") {
            return { ...target, readiness: "descriptive" as const };
          }
          return target;
        }),
      }],
    }), ["customers"])).toThrow(
      "Migration entity customers cannot be applied while customer_addresses is descriptive in catalog",
    );
  });

  it("declares FK-resolving apply prerequisites in dependency order", () => {
    expect(() => assertApplyPrerequisites(legacyMappingCatalog, ["conversations"])).not.toThrow();
    expect(() => assertApplyPrerequisites(legacyMappingCatalog, ["messages"])).not.toThrow();
    expect(() => assertApplyPrerequisites(legacyMappingCatalog, ["orders"])).not.toThrow();
    expect(() => assertApplyPrerequisites(legacyMappingCatalog, ["order_items"])).not.toThrow();
    expect(() => assertApplyPrerequisites(legacyMappingCatalog, ["shipments"])).not.toThrow();
    expect(() => assertApplyPrerequisites(createLegacyMappingCatalog({
      ...legacyMappingCatalog,
      tables: legacyMappingCatalog.tables.filter((table) => table.sourceTable !== "public.musteriler"),
    }), ["conversations"])).toThrow(
      "Migration entity conversations cannot be applied while customers is undeclared in catalog",
    );
    expect(() => assertApplyPrerequisites(createLegacyMappingCatalog({
      ...legacyMappingCatalog,
      tables: legacyMappingCatalog.tables.filter((table) => table.sourceTable !== "public.konusmalar"),
    }), ["messages"])).toThrow(
      "Migration entity messages cannot be applied while conversations is undeclared in catalog",
    );
    expect(() => assertApplyPrerequisites(createLegacyMappingCatalog({
      ...legacyMappingCatalog,
      tables: legacyMappingCatalog.tables.filter((table) => table.sourceTable !== "public.urunler"),
    }), ["order_items"])).toThrow(
      "Migration entity order_items cannot be applied while products is undeclared in catalog",
    );
    expect(() => assertApplyPrerequisites(createLegacyMappingCatalog({
      ...legacyMappingCatalog,
      tables: legacyMappingCatalog.tables.filter((table) => table.sourceTable !== "public.siparisler"),
    }), ["shipments"])).toThrow(
      "Migration entity shipments cannot be applied while orders is undeclared in catalog",
    );
  });

  it.each([
    ["source table", catalogWith({ sourceTable: "musteriler" }, { sourceTable: "public.musteriler" }),
      "duplicate source table public.musteriler"],
    ["target entity", catalogWith({}, { sourceTable: "public.other", targetEntity: "customers" }),
      "duplicate target entity customers"],
    ["column", catalogWith({ duplicateColumn: true }), "duplicate column public.musteriler.id"],
  ])("rejects a duplicate %s before lookup maps are built", (_label, catalog, message) => {
    expect(() => createLegacyMappingCatalog(catalog)).toThrow(message);
  });

  it("requires the id column to be declared, required, and non-nullable", () => {
    expect(() => createLegacyMappingCatalog(catalogWith({ omitIdColumn: true }))).toThrow(
      "id column public.musteriler.id is not declared",
    );
    expect(() => createLegacyMappingCatalog(catalogWith({ optionalIdColumn: true }))).toThrow(
      "id column public.musteriler.id must be required",
    );
    expect(() => createLegacyMappingCatalog(catalogWith({ nullableIdColumn: true }))).toThrow(
      "id column public.musteriler.id must not be nullable",
    );
  });

  it("returns a defensive deeply frozen catalog", () => {
    const input = catalogWith();
    const catalog = createLegacyMappingCatalog(input);

    expect(catalog).not.toBe(input);
    expect(catalog.tables[0]).not.toBe(input.tables[0]);
    expect(catalog.tables[0]!.targetEntities[0]).not.toBe(input.tables[0]!.targetEntities[0]);
    expect(catalog.tables[0]!.columns[0]).not.toBe(input.tables[0]!.columns[0]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.tables)).toBe(true);
    expect(Object.isFrozen(catalog.tables[0])).toBe(true);
    expect(Object.isFrozen(catalog.tables[0]!.targetEntities)).toBe(true);
    expect(Object.isFrozen(catalog.tables[0]!.targetEntities[0])).toBe(true);
    expect(Object.isFrozen(catalog.tables[0]!.columns)).toBe(true);
    expect(Object.isFrozen(catalog.tables[0]!.columns[0])).toBe(true);

    input.version = "mutated-v2";
    input.tables[0]!.sourceTable = "public.changed";
    input.tables[0]!.columns[0]!.dataType = "text";
    expect(catalog.version).toBe("test-v1");
    expect(catalog.tables[0]!.sourceTable).toBe("public.musteriler");
    expect(catalog.tables[0]!.columns[0]!.dataType).toBe("uuid");
  });

  it("requires every source table to declare a target", () => {
    const catalog = catalogWith();
    const table = catalog.tables[0]!;
    expect(() => createLegacyMappingCatalog({
      ...catalog,
      tables: [{ ...table, targetEntities: [] }],
    })).toThrow("source table public.musteriler must declare at least one target");
  });

  it("rejects an empty catalog", () => {
    expect(() => createLegacyMappingCatalog({ version: "test-v1", tables: [] })).toThrow(
      "Legacy mapping catalog must declare at least one target",
    );
  });

  it.each([
    ["synthetic dry-run", "synthetic", "dry-run", "synthetic target customers cannot be dry-run-ready"],
    ["direct descriptive", "direct", "descriptive", "direct target customers must be dry-run-ready"],
  ] as const)("rejects %s readiness", (_label, mapping, readiness, message) => {
    const catalog = catalogWith();
    const table = catalog.tables[0]!;
    expect(() => createLegacyMappingCatalog({
      ...catalog,
      tables: [{ ...table, targetEntities: [{ entity: "customers", mapping, readiness }] }],
    })).toThrow(message);
  });

  it.each([
    ["entity", { entity: "not_canonical" }, "target entity is invalid"],
    ["mapping", { mapping: "copied" }, "target customers mapping is invalid"],
    ["readiness", { readiness: "ready" }, "target customers readiness is invalid"],
  ])("rejects an invalid runtime target %s literal", (_label, targetOverride, message) => {
    const catalog = catalogWith();
    const table = catalog.tables[0]!;
    const target = table.targetEntities[0]!;
    const jsonLikeCatalog = {
      ...catalog,
      tables: [{ ...table, targetEntities: [{ ...target, ...targetOverride }] }],
    } as unknown as LegacyMappingCatalog;

    expect(() => createLegacyMappingCatalog(jsonLikeCatalog)).toThrow(message);
  });

  it("requires at least one dry-run-ready target", () => {
    const catalog = catalogWith();
    const table = catalog.tables[0]!;
    expect(() => createLegacyMappingCatalog({
      ...catalog,
      tables: [{
        ...table,
        targetEntities: [{ entity: "customer_addresses", mapping: "synthetic", readiness: "descriptive" }],
      }],
    })).toThrow("must declare at least one dry-run-ready target");
  });

  it.each([
    ["source table", { sourceTable: "public.bad-name" }, "source table public.bad-name is invalid"],
    ["id column", { idColumn: "bad id" }, "id column for public.musteriler bad id is invalid"],
  ])("rejects an invalid %s identifier", (_label, overrides, message) => {
    expect(() => createLegacyMappingCatalog(catalogWith(overrides))).toThrow(message);
  });

  it("rejects invalid column identifiers and blank database type names", () => {
    const catalog = catalogWith();
    const table = catalog.tables[0]!;
    const baseColumn = table.columns[0]!;
    expect(() => createLegacyMappingCatalog({
      ...catalog,
      tables: [{ ...table, columns: [{ ...baseColumn, name: "bad-name" }] }],
    })).toThrow("column name for public.musteriler bad-name is invalid");
    expect(() => createLegacyMappingCatalog({
      ...catalog,
      tables: [{ ...table, columns: [{ ...baseColumn, dataType: " " }] }],
    })).toThrow("data type for public.musteriler.id must not be blank");
    expect(() => createLegacyMappingCatalog({
      ...catalog,
      tables: [{ ...table, columns: [{ ...baseColumn, udtName: " " }] }],
    })).toThrow("UDT name for public.musteriler.id must not be blank");
  });

  it.each([
    ["missing required", { required: undefined }, "required for public.musteriler.id must be a boolean"],
    ["nonboolean required", { required: "true" }, "required for public.musteriler.id must be a boolean"],
    ["missing nullable", { nullable: undefined }, "nullable for public.musteriler.id must be a boolean"],
    ["nonboolean nullable", { nullable: 0 }, "nullable for public.musteriler.id must be a boolean"],
  ])("rejects a JSON-like catalog column with %s", (_label, columnOverride, message) => {
    const catalog = catalogWith();
    const table = catalog.tables[0]!;
    const jsonLikeCatalog = {
      ...catalog,
      tables: [{
        ...table,
        columns: [{ ...table.columns[0]!, ...columnOverride }],
      }],
    } as unknown as LegacyMappingCatalog;

    expect(() => createLegacyMappingCatalog(jsonLikeCatalog)).toThrow(message);
  });

  it.each([
    ["version", catalogWith({}, undefined, " "), "catalog version must not be blank"],
    ["source table", catalogWith({ sourceTable: " " }), "source table must not be blank"],
    ["id column", catalogWith({ idColumn: " " }), "id column for public.musteriler must not be blank"],
  ])("rejects a blank %s", (_label, catalog, message) => {
    expect(() => createLegacyMappingCatalog(catalog)).toThrow(message);
  });

  it("rejects a source table with a blank identity segment", () => {
    expect(() => createLegacyMappingCatalog(catalogWith({ sourceTable: "public." }))).toThrow(
      "source table public. is invalid",
    );
  });

  it("rejects unknown columns deterministically", () => {
    const columns = [
      ...realMusterilerColumns(),
      { ...snapshot("z_unknown", "text", "text", true), ordinalPosition: 16 },
      { ...snapshot("a_unknown", "text", "text", true), ordinalPosition: 17 },
    ];

    expect(() => validateLegacyTableColumns("public.musteriler", columns, customerMapping)).toThrow(
      "Legacy source schema mismatch for public.musteriler: unexpected columns [a_unknown, z_unknown]",
    );
  });

  it("rejects a missing required column", () => {
    const columns = realMusterilerColumns().filter((column) => column.name !== "telefon");

    expect(() => validateLegacyTableColumns("public.musteriler", columns, customerMapping)).toThrow(
      "Legacy source schema mismatch for public.musteriler: missing required columns [telefon]",
    );
  });

  it("rejects a missing source id column explicitly", () => {
    const columns = realMusterilerColumns().filter((column) => column.name !== "id");

    expect(() => validateLegacyTableColumns("public.musteriler", columns, customerMapping)).toThrow(
      "Legacy source schema mismatch for public.musteriler: missing id column id",
    );
  });

  it("rejects an incompatible data type and UDT", () => {
    const columns = replaceColumn(realMusterilerColumns(), "woocommerce_id", {
      dataType: "bigint",
      udtName: "int8",
    });

    expect(() => validateLegacyTableColumns("public.musteriler", columns, customerMapping)).toThrow(
      "column woocommerce_id expected type integer/int4, received bigint/int8",
    );
  });

  it("rejects incompatible nullability", () => {
    const columns = replaceColumn(realMusterilerColumns(), "telefon", { nullable: true });

    expect(() => validateLegacyTableColumns("public.musteriler", columns, customerMapping)).toThrow(
      "column telefon expected nullable=false, received nullable=true",
    );
  });

  it("rejects duplicate snapshot names before a later valid value can replace an invalid one", () => {
    const columns = [
      { ...realMusterilerColumns()[0]!, dataType: "bigint", udtName: "int8" },
      ...realMusterilerColumns(),
    ];

    expect(() => validateLegacyTableColumns("public.musteriler", columns, customerMapping)).toThrow(
      "Legacy source schema mismatch for public.musteriler: duplicate column name id",
    );
  });

  it("rejects duplicate snapshot ordinals", () => {
    const columns = replaceColumn(realMusterilerColumns(), "ad", { ordinalPosition: 1 });

    expect(() => validateLegacyTableColumns("public.musteriler", columns, customerMapping)).toThrow(
      "Legacy source schema mismatch for public.musteriler: duplicate ordinal position 1",
    );
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid snapshot ordinal %s",
    (ordinalPosition) => {
      const columns = replaceColumn(realMusterilerColumns(), "id", { ordinalPosition });

      expect(() => validateLegacyTableColumns("public.musteriler", columns, customerMapping)).toThrow(
        `Legacy source schema mismatch for public.musteriler: column id ordinal position ${String(ordinalPosition)} is invalid`,
      );
    },
  );

  it("rejects JSON-like snapshot nullability that is not boolean", () => {
    const columns = replaceColumn(realMusterilerColumns(), "id", {
      nullable: "false" as unknown as boolean,
    });

    expect(() => validateLegacyTableColumns("public.musteriler", columns, customerMapping)).toThrow(
      "Legacy source schema mismatch for public.musteriler: column id nullable must be a boolean",
    );
  });

  it.each([
    ["blank name", { name: " " }, "column name   is invalid"],
    ["unsafe name", { name: "bad-name" }, "column name bad-name is invalid"],
    ["blank data type", { dataType: " " }, "column id data type must not be blank"],
    ["blank UDT name", { udtName: " " }, "column id UDT name must not be blank"],
  ])("rejects snapshot metadata with a %s", (_label, columnOverride, message) => {
    const columns = replaceColumn(
      realMusterilerColumns(),
      "id",
      columnOverride as Partial<SourceColumnSnapshot>,
    );

    expect(() => validateLegacyTableColumns("public.musteriler", columns, customerMapping)).toThrow(
      `Legacy source schema mismatch for public.musteriler: ${message}`,
    );
  });

  it("validates selected source snapshots against catalog routing and columns", () => {
    expect(() => validateLegacySourceSnapshots(
      legacyMappingCatalog,
      [musterilerSnapshot()],
      ["customers"],
    )).not.toThrow();
    expect(() => validateLegacySourceSnapshots(legacyMappingCatalog, [], ["customers"])).toThrow(
      "exactly one snapshot per selected entity",
    );
    expect(() => validateLegacySourceSnapshots(
      legacyMappingCatalog,
      [{ ...musterilerSnapshot(), table: "other" }],
      ["customers"],
    )).toThrow("Source table snapshot for customers must route to public.musteriler.id");
    expect(() => validateLegacySourceSnapshots(
      legacyMappingCatalog,
      [{ ...musterilerSnapshot(), columns: realMusterilerColumns().slice(0, -1) }],
      ["customers"],
    )).toThrow("missing required columns [username]");
  });

  it("validates every dry-run-ready source snapshot together", () => {
    const snapshots: SourceTableSnapshot[] = [
      musterilerSnapshot(),
      { entity: "conversations", schema: "public", table: "konusmalar", idColumn: "id", columns: realKonusmalarColumns() },
      { entity: "messages", schema: "public", table: "mesajlar", idColumn: "id", columns: realMesajlarColumns() },
      { entity: "orders", schema: "public", table: "siparisler", idColumn: "id", columns: realSiparislerColumns() },
      { entity: "order_items", schema: "public", table: "siparis_kalemleri", idColumn: "id", columns: realSiparisKalemleriColumns() },
      { entity: "shipments", schema: "public", table: "kargo_gonderimleri", idColumn: "id", columns: realKargoGonderimleriColumns() },
      { entity: "products", schema: "public", table: "urunler", idColumn: "id", columns: realUrunlerColumns() },
    ];

    expect(() => validateLegacySourceSnapshots(
      legacyMappingCatalog,
      snapshots,
      ["customers", "conversations", "messages", "orders", "order_items", "shipments", "products"],
    )).not.toThrow();
    expect(() => validateLegacySourceSnapshots(
      legacyMappingCatalog,
      [snapshots[0]!, { ...snapshots[1]!, table: "musteriler" }, snapshots[2]!, snapshots[3]!, snapshots[4]!, snapshots[5]!, snapshots[6]!],
      ["customers", "conversations", "messages", "orders", "order_items", "shipments", "products"],
    )).toThrow("Source table snapshot for conversations must route to public.konusmalar.id");
  });

  it("rejects descriptive snapshot selection", () => {
    expect(() => validateLegacySourceSnapshots(
      legacyMappingCatalog,
      [{ ...musterilerSnapshot(), entity: "customer_addresses" }],
      ["customer_addresses"],
    )).toThrow("Migration entity customer_addresses is not dry-run-ready in catalog");
  });
});

function realMusterilerColumns(): SourceColumnSnapshot[] {
  return [
    snapshot("id", "uuid", "uuid", false),
    snapshot("ad", "character varying", "varchar", false),
    snapshot("soyad", "character varying", "varchar", true),
    snapshot("email", "character varying", "varchar", true),
    snapshot("telefon", "character varying", "varchar", false),
    snapshot("adres", "text", "text", true),
    snapshot("il", "character varying", "varchar", true),
    snapshot("ilce", "character varying", "varchar", true),
    snapshot("posta_kodu", "character varying", "varchar", true),
    snapshot("notlar", "text", "text", true),
    snapshot("woocommerce_id", "integer", "int4", true),
    snapshot("kolaybi_id", "character varying", "varchar", true),
    snapshot("olusturma_tarihi", "timestamp with time zone", "timestamptz", true),
    snapshot("guncelleme_tarihi", "timestamp with time zone", "timestamptz", true),
    snapshot("username", "text", "text", true),
  ];
}

function realKonusmalarColumns(): SourceColumnSnapshot[] {
  return inOrder([
    ["id", "uuid", "uuid", false],
    ["musteri_id", "uuid", "uuid", true],
    ["kanal", "character varying", "varchar", false],
    ["kanal_konusma_id", "character varying", "varchar", true],
    ["atanan_kullanici_id", "uuid", "uuid", true],
    ["durum", "character varying", "varchar", true],
    ["son_mesaj_tarihi", "timestamp with time zone", "timestamptz", true],
    ["okunmamis_sayisi", "integer", "int4", true],
    ["olusturma_tarihi", "timestamp with time zone", "timestamptz", true],
    ["guncelleme_tarihi", "timestamp with time zone", "timestamptz", true],
    ["son_mesaj_text", "text", "text", true],
    ["son_mesaj_gonderici", "character varying", "varchar", true],
    ["ig_account_id", "text", "text", true],
    ["human_agent", "boolean", "bool", true],
  ]);
}

function realMesajlarColumns(): SourceColumnSnapshot[] {
  return inOrder([
    ["id", "uuid", "uuid", false],
    ["konusma_id", "uuid", "uuid", true],
    ["gonderici_tipi", "character varying", "varchar", false],
    ["gonderici_id", "uuid", "uuid", true],
    ["icerik", "text", "text", false],
    ["medya_url", "text", "text", true],
    ["medya_tipi", "character varying", "varchar", true],
    ["kanal_mesaj_id", "character varying", "varchar", true],
    ["okundu", "boolean", "bool", true],
    ["olusturma_tarihi", "timestamp with time zone", "timestamptz", true],
  ]);
}

function realSiparislerColumns(): SourceColumnSnapshot[] {
  return inOrder([
    ["id", "uuid", "uuid", false],
    ["musteri_id", "uuid", "uuid", true],
    ["olusturan_id", "uuid", "uuid", false],
    ["konusma_id", "uuid", "uuid", true],
    ["musteri_ad", "character varying", "varchar", false],
    ["musteri_telefon", "character varying", "varchar", false],
    ["musteri_adres", "text", "text", true],
    ["musteri_il", "character varying", "varchar", true],
    ["musteri_ilce", "character varying", "varchar", true],
    ["musteri_posta_kodu", "character varying", "varchar", true],
    ["siparis_no", "character varying", "varchar", true],
    ["siparis_tipi", "character varying", "varchar", true],
    ["durum", "character varying", "varchar", true],
    ["ara_toplam", "numeric", "numeric", true],
    ["kdv_toplam", "numeric", "numeric", true],
    ["kargo_ucreti", "numeric", "numeric", true],
    ["genel_toplam", "numeric", "numeric", true],
    ["kargo_takip_no", "character varying", "varchar", true],
    ["kargo_firmasi", "character varying", "varchar", true],
    ["teyit_durumu", "character varying", "varchar", true],
    ["teyit_tarihi", "timestamp with time zone", "timestamptz", true],
    ["teyit_eden_id", "uuid", "uuid", true],
    ["notlar", "text", "text", true],
    ["iptal_nedeni", "text", "text", true],
    ["iade_nedeni", "text", "text", true],
    ["olusturma_tarihi", "timestamp with time zone", "timestamptz", true],
    ["guncelleme_tarihi", "timestamp with time zone", "timestamptz", true],
    ["kolaybi_siparis_id", "character varying", "varchar", true],
    ["ivr_bulk_id", "character varying", "varchar", true],
    ["ivr_tus", "character varying", "varchar", true],
    ["ivr_arama_durumu", "character varying", "varchar", true],
    ["ivr_arama_tarihi", "timestamp with time zone", "timestamptz", true],
    ["kolaybi_contact_id", "character varying", "varchar", true],
    ["kolaybi_address_id", "character varying", "varchar", true],
    ["ivr_dinleme_suresi", "integer", "int4", true],
    ["kargo_yazdirildi", "boolean", "bool", true],
    ["kargo_son_hareket", "text", "text", true],
    ["kargo_son_hareket_tarihi", "timestamp with time zone", "timestamptz", true],
    ["kargoya_aktarilma_tarihi", "timestamp with time zone", "timestamptz", true],
    ["efatura_durumu", "character varying", "varchar", true],
    ["sevk_edilme_tarihi", "timestamp with time zone", "timestamptz", true],
    ["durum_oncelik", "smallint", "int2", true],
    ["mukerrer", "boolean", "bool", false],
    ["teyit_arama_deneme", "integer", "int4", false],
    ["kaynak", "text", "text", false],
    ["mukerrer_ad", "boolean", "bool", false],
    ["at_disi", "boolean", "bool", true],
  ]);
}

function realSiparisKalemleriColumns(): SourceColumnSnapshot[] {
  return inOrder([
    ["id", "uuid", "uuid", false],
    ["siparis_id", "uuid", "uuid", false],
    ["stok_id", "uuid", "uuid", true],
    ["urun_adi", "character varying", "varchar", false],
    ["urun_kodu", "character varying", "varchar", true],
    ["miktar", "numeric", "numeric", false],
    ["birim", "character varying", "varchar", true],
    ["birim_fiyat", "numeric", "numeric", false],
    ["kdv_orani", "numeric", "numeric", true],
    ["toplam_fiyat", "numeric", "numeric", false],
    ["olusturma_tarihi", "timestamp with time zone", "timestamptz", true],
    ["kolaybi_product_id", "character varying", "varchar", true],
  ]);
}

function realKargoGonderimleriColumns(): SourceColumnSnapshot[] {
  return inOrder([
    ["id", "uuid", "uuid", false],
    ["musteri_id", "uuid", "uuid", true],
    ["kargo_firmasi", "character varying", "varchar", false],
    ["takip_no", "character varying", "varchar", true],
    ["barkod_url", "text", "text", true],
    ["alici_ad", "character varying", "varchar", false],
    ["alici_telefon", "character varying", "varchar", false],
    ["alici_adres", "text", "text", false],
    ["alici_il", "character varying", "varchar", false],
    ["alici_ilce", "character varying", "varchar", false],
    ["alici_posta_kodu", "character varying", "varchar", true],
    ["gonderi_tipi", "character varying", "varchar", true],
    ["agirlik", "numeric", "numeric", true],
    ["desi", "numeric", "numeric", true],
    ["ucret", "numeric", "numeric", true],
    ["odeme_tipi", "character varying", "varchar", true],
    ["durum", "character varying", "varchar", true],
    ["notlar", "text", "text", true],
    ["olusturan_id", "uuid", "uuid", true],
    ["olusturma_tarihi", "timestamp with time zone", "timestamptz", true],
    ["guncelleme_tarihi", "timestamp with time zone", "timestamptz", true],
    ["alici_email", "character varying", "varchar", true],
    ["kargo_turu", "character varying", "varchar", true],
    ["tasima_sekli", "character varying", "varchar", true],
    ["teslim_sekli", "character varying", "varchar", true],
    ["adet", "integer", "int4", true],
    ["kapida_odeme_tutari", "numeric", "numeric", true],
    ["kargo_icerigi", "text", "text", true],
    ["son_hareket", "text", "text", true],
    ["son_hareket_tarihi", "timestamp with time zone", "timestamptz", true],
    ["surat_web_siparis_kodu", "character varying", "varchar", true],
    ["surat_kargo_takip_no", "character varying", "varchar", true],
    ["surat_hesap_tipi", "character varying", "varchar", true],
    ["surat_barkod_no", "character varying", "varchar", true],
  ]);
}

function realUrunlerColumns(): SourceColumnSnapshot[] {
  return inOrder([
    ["id", "integer", "int4", false],
    ["ad", "text", "text", false],
    ["kod", "character varying", "varchar", true],
    ["kategori", "character varying", "varchar", true],
    ["birim", "character varying", "varchar", true],
    ["satis_fiyati", "numeric", "numeric", true],
    ["stok_miktari", "integer", "int4", true],
    ["kritik_seviye", "integer", "int4", true],
    ["aciklama", "text", "text", true],
    ["aktif", "boolean", "bool", true],
    ["olusturma_tarihi", "timestamp with time zone", "timestamptz", true],
    ["guncelleme_tarihi", "timestamp with time zone", "timestamptz", true],
    ["kolaybi_product_id", "text", "text", true],
  ]);
}

function realKargoTakipColumns(): SourceColumnSnapshot[] {
  return inOrder([
    ["id", "uuid", "uuid", false],
    ["kargo_id", "uuid", "uuid", true],
    ["durum", "character varying", "varchar", false],
    ["aciklama", "text", "text", true],
    ["lokasyon", "character varying", "varchar", true],
    ["tarih", "timestamp with time zone", "timestamptz", true],
  ]);
}

function inOrder(columns: [string, string, string, boolean][]): SourceColumnSnapshot[] {
  return columns.map(([name, dataType, udtName, nullable], index) => ({
    name,
    ordinalPosition: index + 1,
    dataType,
    udtName,
    nullable,
  }));
}

function asRequiredContract(column: SourceColumnSnapshot) {
  return {
    name: column.name,
    dataType: column.dataType,
    udtName: column.udtName,
    nullable: column.nullable,
    required: true,
  };
}

function musterilerSnapshot(): SourceTableSnapshot {
  return {
    entity: "customers",
    schema: "public",
    table: "musteriler",
    idColumn: "id",
    columns: realMusterilerColumns(),
  };
}

function snapshot(
  name: string,
  dataType: string,
  udtName: string,
  nullable: boolean,
): SourceColumnSnapshot {
  return { name, ordinalPosition: ordinalByColumn[name] ?? 99, dataType, udtName, nullable };
}

function replaceColumn(
  columns: SourceColumnSnapshot[],
  name: string,
  replacement: Partial<SourceColumnSnapshot>,
): SourceColumnSnapshot[] {
  return columns.map((column) => column.name === name ? { ...column, ...replacement } : column);
}

const ordinalByColumn: Record<string, number> = {
  id: 1,
  ad: 2,
  soyad: 3,
  email: 4,
  telefon: 5,
  adres: 6,
  il: 7,
  ilce: 8,
  posta_kodu: 9,
  notlar: 10,
  woocommerce_id: 11,
  kolaybi_id: 12,
  olusturma_tarihi: 13,
  guncelleme_tarihi: 14,
  username: 15,
};

function catalogWith(
  first: {
    sourceTable?: string;
    idColumn?: string;
    duplicateColumn?: boolean;
    omitIdColumn?: boolean;
    optionalIdColumn?: boolean;
    nullableIdColumn?: boolean;
  } = {},
  second?: { sourceTable: string; targetEntity?: "customers" | "messages" },
  version = "test-v1",
) {
  const idColumn = columnContract("id", first.nullableIdColumn ?? false, !first.optionalIdColumn);
  const columns = first.omitIdColumn ? [] : [idColumn, ...(first.duplicateColumn ? [idColumn] : [])];
  return {
    version,
    tables: [
      {
        sourceTable: first.sourceTable ?? "public.musteriler",
        idColumn: first.idColumn ?? "id",
        targetEntities: [{ entity: "customers" as const, mapping: "direct" as const, readiness: "dry-run" as const }],
        columns,
      },
      ...(second ? [{
        sourceTable: second.sourceTable,
        idColumn: "id",
        targetEntities: [{
          entity: second.targetEntity ?? "messages",
          mapping: "direct" as const,
          readiness: "dry-run" as const,
        }],
        columns: [columnContract("id", false, true)],
      }] : []),
    ],
  };
}

function columnContract(name: string, nullable: boolean, required: boolean) {
  return { name, dataType: "uuid", udtName: "uuid", nullable, required };
}

function fullColumnContract(
  name: string,
  dataType: string,
  udtName: string,
  nullable: boolean,
  required: boolean,
) {
  return { name, dataType, udtName, nullable, required };
}
