import { describe, expect, it } from "vitest";
import {
  assertDistinctPostgresDatabases,
  normalizePostgresDatabaseIdentity,
} from "../src/database-identity.js";

describe("PostgreSQL database identity", () => {
  it("ignores credentials, query parameters, protocol alias, and explicit default port", () => {
    const source = "postgres://legacy_reader:source-secret@DB.EXAMPLE.COM/app?sslmode=require";
    const target = "postgresql://writer:target-secret@db.example.com:5432/app?application_name=migrator";

    expect(normalizePostgresDatabaseIdentity(source)).toEqual({
      host: "db.example.com",
      port: "5432",
      database: "app",
    });
    expect(() => assertDistinctPostgresDatabases(source, target)).toThrow(
      "Source and target database identities must be different",
    );
  });

  it("allows different hosts, ports, or database names", () => {
    expect(() =>
      assertDistinctPostgresDatabases("postgres://source/db", "postgres://target/db"),
    ).not.toThrow();
    expect(() =>
      assertDistinctPostgresDatabases("postgres://db:5432/source", "postgres://db:5432/target"),
    ).not.toThrow();
    expect(() =>
      assertDistinctPostgresDatabases("postgres://db:5432/app", "postgres://db:5433/app"),
    ).not.toThrow();
  });

  it("rejects malformed or non-PostgreSQL URLs without echoing credentials", () => {
    expect(() => normalizePostgresDatabaseIdentity("not-a-url")).toThrow("valid PostgreSQL connection URL");
    expect(() => normalizePostgresDatabaseIdentity("mysql://user:secret@db/app")).toThrow(
      "postgres or postgresql protocol",
    );
  });
});
