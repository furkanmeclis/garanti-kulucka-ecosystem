import { describe, expect, it } from "vitest";
import { parseMigratorCommand, runMigratorCommand } from "../src/commands.js";

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

  it("requires DATABASE_URL before running", async () => {
    await expect(runMigratorCommand("migrate:dry-run", {})).rejects.toThrow("DATABASE_URL is required");
  });
});
