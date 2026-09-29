import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/004_add_woocommerce_provider.sql", import.meta.url);

describe("WooCommerce provider contract", () => {
  it("adds WooCommerce without rewriting the historical provider seed", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const [up, down] = sql.split("-- Down Migration");

    expect(up).toMatch(/INSERT INTO integration_providers/);
    expect(up).toMatch(/'prv_woocommerce', 'woocommerce', 'WooCommerce'/);
    expect(up).toMatch(/Existing WooCommerce provider does not match the canonical migration seed/);
    expect(up).toMatch(/key = 'woocommerce' OR public_id = 'prv_woocommerce'/);
    expect(up).not.toMatch(/DO NOTHING/);
    expect(down).toMatch(/intentionally leaves the validated seed in place/);
    expect(down).not.toMatch(/DELETE FROM integration_providers/);
    expect(down).not.toMatch(/DROP TABLE/);
  });
});
