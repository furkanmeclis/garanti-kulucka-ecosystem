import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCanonicalTableVerificationReport,
  parseMigratorCliCommand,
  parseMigratorCommand,
  runMigratorCommand,
} from "../src/commands.js";

describe("migrator commands", () => {
  it("parses dry-run", () => {
    expect(parseMigratorCommand(["migrate", "--dry-run"])).toBe("migrate:dry-run");
  });

  it("parses apply", () => {
    expect(parseMigratorCommand(["migrate", "--apply"])).toBe("migrate:apply");
  });

  it("parses verify", () => {
    expect(parseMigratorCommand(["verify"])).toBe("verify");
  });

  it("parses optional report files without changing the command contract", () => {
    expect(parseMigratorCliCommand(["migrate", "--dry-run", "--report-file", "reports/dry_run.json"])).toEqual({
      command: "migrate:dry-run",
      options: { reportFile: "reports/dry_run.json" },
    });
    expect(parseMigratorCliCommand(["verify", "--report-file", "reports/verify.json"])).toEqual({
      command: "verify",
      options: { reportFile: "reports/verify.json" },
    });
  });

  it("requires DATABASE_URL before running", async () => {
    await expect(runMigratorCommand("migrate:dry-run", {})).rejects.toThrow("DATABASE_URL is required");
  });

  it("writes a failed command report without leaking database configuration", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "garanti-migrator-"));
    const reportFile = join(tempDir, "nested", "report.json");

    try {
      await expect(runMigratorCommand("migrate:dry-run", {}, { reportFile })).rejects.toThrow(
        "DATABASE_URL is required",
      );

      const report = JSON.parse(await readFile(reportFile, "utf8")) as Record<string, unknown>;
      expect(report).toMatchObject({
        command: "migrate:dry-run",
        status: "failed",
        error: { message: "DATABASE_URL is required" },
      });
      expect(report).not.toHaveProperty("databaseUrl");
      expect(report).not.toHaveProperty("DATABASE_URL");
      expect(typeof report.startedAt).toBe("string");
      expect(typeof report.finishedAt).toBe("string");
      expect(typeof report.durationMs).toBe("number");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates canonical table verification reports without leaking connection details", () => {
    const report = createCanonicalTableVerificationReport([
      "users",
      "roles",
      "customers",
      "conversations",
      "messages",
      "orders",
      "shipments",
      "integration_providers",
      "integration_accounts",
      "settings",
    ]);

    expect(report.status).toBe("failed");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "canonical_table.legacy_id_map",
        status: "failed",
        expected: 1,
        actual: 0,
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "canonical_table.migration_batches",
        status: "failed",
        expected: 1,
        actual: 0,
      }),
    );
    expect(JSON.stringify(report)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(report)).not.toContain("postgres://");
  });
});
