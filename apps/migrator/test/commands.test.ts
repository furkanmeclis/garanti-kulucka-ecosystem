import { describe, expect, it } from "vitest";
import { parseMigratorCommand } from "../src/commands.js";

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
});
