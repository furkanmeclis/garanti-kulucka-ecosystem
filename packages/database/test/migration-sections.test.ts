import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationsDir = new URL("../migrations/", import.meta.url);

describe("migration file sections", () => {
  it("marks the up section whenever a down section exists so node-pg-migrate runs it", async () => {
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(10);

    for (const file of files) {
      const sql = await readFile(new URL(file, migrationsDir), "utf8");
      const upIndex = sql.indexOf("-- Up Migration");
      const downIndex = sql.indexOf("-- Down Migration");
      if (downIndex === -1) continue;
      expect(upIndex, `${file} has a down section without an up marker`).toBeGreaterThanOrEqual(0);
      expect(upIndex, `${file} up marker must precede the down marker`).toBeLessThan(downIndex);
    }
  });
});
