import { sql, type AppDatabase } from "@garanti-kulucka/database";
import { expect, it } from "vitest";
import { istanbulDay, SuratCoverageService } from "../src/cargo/surat-coverage.js";
import { DomainRepository } from "../src/domain/repository.js";
import { describePg, withRollback } from "./support/pg.js";

async function customer(db: AppDatabase, key: string, fullName: string, phone: string | null) {
  const row = await sql<{ id: number }>`
    insert into customers (public_id, full_name, phone) values (${`cus_dup_${key}`}, ${fullName}, ${phone}) returning id
  `.execute(db);
  return row.rows[0]!.id;
}

async function order(db: AppDatabase, key: string, customerId: number, status = "draft", deleted = false) {
  await sql`
    insert into orders (public_id, customer_id, order_number, status, total_amount, deleted_at)
    values (${`ord_dup_${key}`}, ${customerId}, ${`DUP-${key}`}, ${status}, 0, ${deleted ? sql`now()` : null})
  `.execute(db);
}

describePg("order list checks against Postgres", () => {
  it("flags duplicate phones (last 10 digits) and names among live orders in one query", async () => {
    await withRollback(async (db) => {
      const ali = await customer(db, "ali", "Zzdup Ali Veli", "0 (555) 987 65 43");
      const aliAgain = await customer(db, "ali2", "Zzdup Başka İsim", "+90 555 987 6543");
      const ayse = await customer(db, "ayse", "Zzdup Ayşe Kaya", "05551110000");
      const ayseAgain = await customer(db, "ayse2", "zzdup ayşe kaya ", "05552220000");
      const cancelled = await customer(db, "iptal", "Zzdup İptal", "05553330000");
      await order(db, "a1", ali);
      await order(db, "a2", aliAgain, "delivered");
      await order(db, "y1", ayse);
      await order(db, "y2", ayseAgain);
      await order(db, "y3", ayseAgain, "delivered");
      await order(db, "c1", cancelled);
      await order(db, "c2", cancelled, "cancelled");
      await order(db, "c3", cancelled, "draft", true);

      const matches = await new DomainRepository(db).findDuplicateOrdersFor(["ord_dup_a1", "ord_dup_y1", "ord_dup_c1", "ord_dup_missing"]);
      // Delivered orders still count for the phone check (legacy), not for the name check.
      expect(matches.get("ord_dup_a1")).toEqual({ phoneMatches: ["DUP-a2"], nameMatches: [] });
      expect(matches.get("ord_dup_y1")).toEqual({ phoneMatches: [], nameMatches: ["DUP-y2"] });
      // Cancelled and deleted orders are never duplicates.
      expect(matches.has("ord_dup_c1")).toBe(false);
      expect(matches.has("ord_dup_missing")).toBe(false);
    });
  });

  it("reads today's live ATDurumListesi answer back from the worker's provider attempt", async () => {
    await withRollback(async (db) => {
      await sql`insert into settings (public_id, scope, key, value) values ('set_pg_surat_live', 'global', 'providers.surat.live_mode', 'true'::jsonb)
        on conflict (scope, key) do update set value = 'true'::jsonb`.execute(db);
      const day = istanbulDay(new Date());
      const insertAttempt = (key: string, idempotencyKey: string, live: boolean, records: unknown[]) => sql`
        insert into provider_attempts (public_id, provider_id, request_id, operation, direction, status, duration_ms, retry_decision, idempotency_key, request_metadata, response_metadata, started_at)
        select ${`pat_pg_${key}`}, id, ${`req_${idempotencyKey}`}, 'address.coverage', 'outbound', 'success', 1, 'none', ${idempotencyKey}, '{}'::jsonb,
          ${JSON.stringify({ live_call_performed: live, ...(live ? { result: { data: { records } } } : {}) })}::jsonb, now()
        from integration_providers where key = 'surat'
      `.execute(db);
      await insertAttempt("fixture", `surat_coverage_konya_selcuklu_${day}`, false, []);
      await insertAttempt("yesterday", "surat_coverage_konya_selcuklu_20000101", true, [{ mahalle: "SARAYKÖY", at: true }]);
      const service = new SuratCoverageService(db, { publish: async () => "job" });
      // A dry-run (fixture) attempt or another day's answer is not a carrier answer: keyword fallback.
      await expect(service.check({ city: "Konya", district: "Selçuklu", address_line: "Sarayköy" })).resolves.toMatchObject({ source: "keyword_fallback", queued: true });

      // (provider_id, idempotency_key) is unique: the live answer replaces the dry-run row in this scenario.
      await sql`delete from provider_attempts where public_id = 'pat_pg_fixture'`.execute(db);
      await insertAttempt("live", `surat_coverage_konya_selcuklu_${day}`, true, [{ mahalle: "SARAYKÖY", at: false }, { mahalle: "YAZIR", at: true }]);
      await expect(service.check({ city: "Konya", district: "Selçuklu", address_line: "Sarayköy Mah." })).resolves.toMatchObject({
        source: "provider",
        status: "not_covered",
        warning: true,
      });
    });
  });
});
