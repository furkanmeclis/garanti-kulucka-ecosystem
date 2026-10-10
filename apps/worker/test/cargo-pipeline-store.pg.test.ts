import { sql } from "@garanti-kulucka/database";
import { expect, it } from "vitest";
import { DatabaseCargoPipelineStore } from "../src/cargo-pipeline.js";
import { describePg, withRollback } from "./support/pg.js";

describePg("cargo pipeline store against Postgres", () => {
  it("never overwrites an admin action taken while the worker held the row, and re-queues abandoned claims", async () => {
    await withRollback(async (db) => {
      const store = new DatabaseCargoPipelineStore(db);
      const now = new Date();
      const insert = (key: string, status: string, updatedAt: Date) =>
        sql<{ id: number }>`insert into cargo_pipeline_items (public_id, step, status, next_run_at, updated_at) values (${`cpl_pg_${key}`}, 'sms', ${status}, ${now}, ${updatedAt}) returning id`.execute(db);

      const cancelled = (await insert("cancelled", "iptal", now)).rows[0]!.id;
      await store.update(cancelled, { status: "bekliyor", attempt_count: 1 });
      const afterCancel = await db.selectFrom("cargo_pipeline_items").select(["status", "attempt_count"]).where("id", "=", cancelled).executeTakeFirstOrThrow();
      expect(afterCancel).toEqual({ status: "iptal", attempt_count: 0 });

      const active = (await insert("active", "isleniyor", now)).rows[0]!.id;
      await store.update(active, { status: "tamamlandi" });
      expect((await db.selectFrom("cargo_pipeline_items").select("status").where("id", "=", active).executeTakeFirstOrThrow()).status).toBe("tamamlandi");

      const stale = (await insert("stale", "isleniyor", new Date(now.getTime() - 60 * 60 * 1000))).rows[0]!.id;
      const fresh = (await insert("fresh", "isleniyor", now)).rows[0]!.id;
      expect(await store.releaseStale(now, 30 * 60 * 1000)).toBeGreaterThanOrEqual(1);
      const rows = await db.selectFrom("cargo_pipeline_items").select(["id", "status"]).where("id", "in", [stale, fresh]).execute();
      expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({ [stale]: "bekliyor", [fresh]: "isleniyor" });
    });
  });
});
