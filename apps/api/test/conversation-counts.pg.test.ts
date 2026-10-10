import { sql, type AppDatabase } from "@garanti-kulucka/database";
import { expect, it } from "vitest";
import { DomainRepository } from "../src/domain/repository.js";
import { describePg, withRollback } from "./support/pg.js";

async function insertConversation(db: AppDatabase, key: string, input: { channel: string; unread: number; pool?: boolean; customerId?: number | null }) {
  await sql`
    insert into conversations (public_id, customer_id, channel, status, is_in_pool, unread_count, last_message_at)
    values (${`cnv_pg_${key}`}, ${input.customerId ?? null}, ${input.channel}, 'open', ${input.pool ?? false}, ${input.unread}, now() + interval '1 day')
  `.execute(db);
}

describePg("conversation counters, unread filter and detail", () => {
  it("counts every conversation (not the newest 200) and filters unread rows in SQL", async () => {
    await withRollback(async (db) => {
      const repository = new DomainRepository(db);
      const before = await repository.getConversationCounts();

      await insertConversation(db, "wa_unread", { channel: "whatsapp", unread: 3 });
      await insertConversation(db, "ms_unread", { channel: "messenger", unread: 1, pool: true });
      await insertConversation(db, "ig_read", { channel: "instagram", unread: 0 });

      const after = await repository.getConversationCounts();
      expect(after.total_count - before.total_count).toBe(3);
      expect(after.unread_conversation_count - before.unread_conversation_count).toBe(2);
      expect(after.unread_message_count - before.unread_message_count).toBe(4);
      expect(after.pool_count - before.pool_count).toBe(1);
      expect(after.channel_counts.whatsapp - before.channel_counts.whatsapp).toBe(1);
      expect(after.channel_counts.facebook - before.channel_counts.facebook).toBe(1);
      expect(after.channel_counts.instagram - before.channel_counts.instagram).toBe(1);
      expect((await repository.getConversationSummary()).unread_conversation_count).toBe(after.unread_conversation_count);

      const unread = await repository.listConversations({ limit: 200, unreadOnly: true });
      expect(unread.every((row) => Number(row.unread_count) > 0)).toBe(true);
      const ids = unread.map((row) => row.public_id);
      expect(ids).toEqual(expect.arrayContaining(["cnv_pg_wa_unread", "cnv_pg_ms_unread"]));
      expect(ids).not.toContain("cnv_pg_ig_read");
    });
  });

  it("returns the customer's id, note and default address with the conversation", async () => {
    await withRollback(async (db) => {
      const customer = await sql<{ id: number }>`
        insert into customers (public_id, full_name, phone, username, notes) values ('cus_pg_detail', 'Detay Müşteri', '05550001122', 'detay', 'Arayınca açmıyor')
        returning id
      `.execute(db);
      const customerId = customer.rows[0]!.id;
      await sql`
        insert into customer_addresses (public_id, customer_id, address_line, city, district, country, is_default)
        values ('adr_pg_old', ${customerId}, 'Eski adres', 'Ankara', 'Çankaya', 'Türkiye', false),
               ('adr_pg_default', ${customerId}, 'Atatürk Cd. 1', 'Konya', 'Selçuklu', 'Türkiye', true)
      `.execute(db);
      await insertConversation(db, "detail", { channel: "whatsapp", unread: 1, customerId });

      const repository = new DomainRepository(db);
      const detail = await repository.getConversationDetail("cnv_pg_detail");
      expect(detail?.conversation).toMatchObject({ customer_public_id: "cus_pg_detail", customer_username: "detay", customer_full_name: "Detay Müşteri" });
      expect(detail?.customerNotes).toBe("Arayınca açmıyor");
      expect(detail?.defaultAddress).toMatchObject({ public_id: "adr_pg_default", city: "Konya" });
      expect(await repository.getConversationDetail("cnv_pg_missing")).toBeNull();
    });
  });
});
