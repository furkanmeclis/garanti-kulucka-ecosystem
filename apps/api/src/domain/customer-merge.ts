import { sql, type AppDatabase } from "@garanti-kulucka/database";
import type { CustomerMergeCandidate, CustomerMergeCounts } from "@garanti-kulucka/shared";

/** All direct customer FKs. The migration coverage test deliberately fails when a new one is added. */
export const customerMergeRelations = [
  "conversations", "orders", "shipments", "customer_addresses", "customer_external_identities",
  "accounting_contacts", "call_logs",
] as const;

export class CustomerMergeError extends Error {
  constructor(public readonly status: 400 | 404, message: string) { super(message); }
}

export class CustomerMergeRepository {
  constructor(private readonly db: AppDatabase) {}

  async counts(publicId: string): Promise<CustomerMergeCounts> {
    const customer = await this.db.selectFrom("customers").select(["id", "notes"]).where("public_id", "=", publicId).executeTakeFirst();
    if (!customer) throw new CustomerMergeError(404, "Customer not found or already merged");
    const counts: CustomerMergeCounts = {};
    for (const table of customerMergeRelations) {
      const result = await sql<{ count: string }>`select count(*)::text as count from ${sql.table(table)} where customer_id = ${customer.id}`.execute(this.db);
      counts[table] = Number(result.rows[0]?.count ?? 0);
    }
    // These tables reference shipments, not customers. Moving shipments preserves their history,
    // including original recipient/name/phone snapshots; never rewrite historical delivery data.
    for (const table of ["sms_messages", "vapi_calls", "vapi_call_queue"] as const) {
      const result = await sql<{ count: string }>`select count(*)::text as count from ${sql.table(table)} where shipment_id in
        (select id from shipments where customer_id = ${customer.id})`.execute(this.db);
      counts[table] = Number(result.rows[0]?.count ?? 0);
    }
    counts.notes = customer.notes?.trim() ? 1 : 0;
    return counts;
  }

  async candidates(publicId: string): Promise<CustomerMergeCandidate[]> {
    const customer = await this.db.selectFrom("customers").selectAll().where("public_id", "=", publicId).executeTakeFirst();
    if (!customer) throw new CustomerMergeError(404, "Customer not found or already merged");
    const phone = (customer.phone ?? "").replace(/\D/g, "").slice(-10);
    const email = customer.email?.trim().toLowerCase() || "";
    const name = customer.full_name.trim().toLocaleLowerCase("tr-TR");
    const rows = await sql<CustomerMergeCandidate>`select c.public_id, c.full_name, c.phone, c.email,
      (select count(*)::int from orders o where o.customer_id = c.id) as orders_count,
      (select count(*)::int from conversations v where v.customer_id = c.id) as conversations_count
      from customers c where c.id <> ${customer.id} and (
        (${phone.length === 10} and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = ${phone})
        or (${email !== ""} and lower(btrim(c.email)) = ${email})
        or (${name.length >= 4} and similarity(lower(btrim(c.full_name)), lower(${customer.full_name.trim()})) >= 0.65))
      order by (case when ${phone.length === 10} and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = ${phone} then 3 else 0 end
        + case when ${email !== ""} and lower(btrim(c.email)) = ${email} then 2 else 0 end) desc,
        similarity(lower(btrim(c.full_name)), lower(${customer.full_name.trim()})) desc, c.public_id
      limit 10`.execute(this.db);
    return rows.rows;
  }

  async merge(targetPublicId: string, sourcePublicId: string, actorUserId: number | null) {
    if (targetPublicId === sourcePublicId) throw new CustomerMergeError(400, "Cannot merge a customer into itself");
    return this.db.transaction().execute(async (trx) => {
      // Deterministic locks serialize overlapping merges and avoid A→B / B→A deadlocks.
      // FOR UPDATE also blocks new FK references until source deletion commits.
      const customers = await trx.selectFrom("customers").selectAll()
        .where("public_id", "in", [targetPublicId, sourcePublicId]).orderBy("id").forUpdate().execute();
      const source = customers.find((row) => row.public_id === sourcePublicId);
      const target = customers.find((row) => row.public_id === targetPublicId);
      if (!source || !target) throw new CustomerMergeError(404, "Customer not found or already merged");
      const counts = await new CustomerMergeRepository(trx).counts(sourcePublicId);
      const addresses = await trx.selectFrom("customer_addresses").selectAll()
        .where("customer_id", "in", [source.id, target.id]).orderBy("id").forUpdate().execute();
      const key = (row: typeof addresses[number]) => JSON.stringify(
        [row.address_line, row.district, row.city, row.country, row.postal_code].map((value) => value?.trim().toLocaleLowerCase("tr-TR") || ""));
      const kept = addresses.filter((row) => row.customer_id === target.id);
      let hasDefault = kept.some((row) => row.is_default);
      let deduplicated = 0;
      // Prefer the source default when the target has none.
      for (const address of addresses.filter((row) => row.customer_id === source.id).sort((a, b) => Number(b.is_default) - Number(a.is_default))) {
        const duplicate = kept.find((row) => key(row) === key(address));
        if (duplicate) {
          if (!hasDefault && address.is_default) {
            await trx.updateTable("customer_addresses").set({ is_default: true }).where("id", "=", duplicate.id).execute();
            hasDefault = true;
          }
          await trx.updateTable("legacy_id_map").set({ target_id: duplicate.public_id })
            .where("target_table", "=", "customer_addresses").where("target_id", "=", address.public_id).execute();
          await trx.deleteFrom("customer_addresses").where("id", "=", address.id).execute();
          deduplicated++;
        } else {
          const isDefault = !hasDefault && address.is_default;
          await trx.updateTable("customer_addresses").set({ customer_id: target.id, is_default: isDefault, updated_at: new Date() })
            .where("id", "=", address.id).execute();
          hasDefault ||= isDefault;
          kept.push(address);
        }
      }
      for (const table of customerMergeRelations) {
        if (table === "customer_addresses") continue;
        await sql`update ${sql.table(table)} set customer_id = ${target.id}, updated_at = now() where customer_id = ${source.id}`.execute(trx);
      }
      const fill = (value: string | null, fallback: string | null) => value?.trim() ? value : fallback;
      await trx.updateTable("customers").set({
        full_name: fill(target.full_name, source.full_name) ?? source.full_name,
        phone: fill(target.phone, source.phone), email: fill(target.email, source.email),
        notes: source.notes?.trim()
          ? [target.notes, `Birleştirilen müşteri (${source.full_name})\n${source.notes}`].filter(Boolean).join("\n\n")
          : target.notes,
        updated_at: new Date(),
      }).where("id", "=", target.id).execute();
      const mappings = await trx.updateTable("legacy_id_map").set({ target_id: targetPublicId })
        .where("target_table", "=", "customers").where("target_id", "=", sourcePublicId).executeTakeFirst();
      // Customers have no soft-delete columns; hard-delete only after every reference has moved.
      await trx.deleteFrom("customers").where("id", "=", source.id).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: actorUserId, action: "customer.merge", entity_type: "customer", entity_id: targetPublicId,
        old_value: { source_public_id: sourcePublicId, source_id: source.id, target_public_id: targetPublicId, target_id: target.id },
        new_value: { source_public_id: sourcePublicId, target_public_id: targetPublicId, counts,
          addresses_deduplicated: deduplicated, legacy_mappings: Number(mappings.numUpdatedRows) },
        ip_address: null, user_agent: null, created_at: new Date(),
      }).execute();
      const conversations = await trx.selectFrom("conversations").selectAll().where("customer_id", "=", target.id).execute();
      const orders = await trx.selectFrom("orders").select(["public_id", "status"]).where("customer_id", "=", target.id).execute();
      const shipments = await trx.selectFrom("shipments").select(["public_id", "status", "tracking_number"]).where("customer_id", "=", target.id).execute();
      return { target_public_id: targetPublicId, source_public_id: sourcePublicId, counts, conversations, orders, shipments };
    });
  }
}
