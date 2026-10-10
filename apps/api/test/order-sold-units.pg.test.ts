import { sql, type AppDatabase } from "@garanti-kulucka/database";
import { expect, it } from "vitest";
import { DomainRepository } from "../src/domain/repository.js";
import { describePg, withRollback } from "./support/pg.js";

const istanbulDayStart = sql`date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'`;

async function insertOrder(db: AppDatabase, key: string, input: { status?: string; deleted?: boolean; createdAt: ReturnType<typeof sql>; quantities: number[] }) {
  const order = await sql<{ id: number }>`
    insert into orders (public_id, order_number, status, total_amount, created_at, deleted_at)
    values (${`ord_units_${key}`}, ${`UNITS-${key}`}, ${input.status ?? "draft"}, 0, ${input.createdAt}, ${input.deleted ? sql`now()` : null})
    returning id
  `.execute(db);
  const orderId = order.rows[0]!.id;
  for (const [index, quantity] of input.quantities.entries()) {
    await sql`
      insert into order_items (public_id, order_id, name, quantity, unit_price, total_amount)
      values (${`oit_units_${key}_${index}`}, ${orderId}, 'Ürün', ${quantity}, 0, 0)
    `.execute(db);
  }
}

describePg("today's sold units (Mesajlar GÜNLÜK SATIŞ)", () => {
  it("sums today's (Europe/Istanbul) live order quantities and counts an order without items as one", async () => {
    await withRollback(async (db) => {
      const repository = new DomainRepository(db);
      const before = await repository.getTodaySoldUnits();

      await insertOrder(db, "items", { createdAt: sql`now()`, quantities: [2, 3] });
      await insertOrder(db, "no_items", { createdAt: istanbulDayStart, quantities: [] });
      await insertOrder(db, "cancelled", { status: "cancelled", createdAt: sql`now()`, quantities: [4] });
      await insertOrder(db, "returned", { status: "returned", createdAt: sql`now()`, quantities: [4] });
      await insertOrder(db, "deleted", { deleted: true, createdAt: sql`now()`, quantities: [4] });
      await insertOrder(db, "yesterday", { createdAt: sql`${istanbulDayStart} - interval '1 second'`, quantities: [9] });

      expect(await repository.getTodaySoldUnits()).toBe(before + 6);
      const summary = await repository.getOrderSummary();
      expect(summary.today_sold_units).toBe(before + 6);
    });
  });
});
