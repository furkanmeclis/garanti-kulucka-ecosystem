import type { AppDatabase } from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";
import { centsToMoneyString, moneyToCents } from "../domain/order-totals.js";

/**
 * Legacy SiparislerPage "Düzenle" modal (duzenlemeyiKaydet): customer name/phone, address, note, cargo firm,
 * item lines (delete + update + insert) and the grand total (sum of lines, or a manual total when
 * "fiyat_manuel" was on). Orders already sent to KolayBi cannot be edited, as in legacy. Stock is not
 * re-balanced on edit (legacy did not either).
 */

export type OrderEditLockReason = "kolaybi" | "deleted" | "cancelled";

export interface EditableOrder {
  public_id: string;
  order_number: string;
  status: string;
  cargo_provider: string | null;
  notes: string | null;
  currency: string;
  total_amount: string;
  items_total: string;
  manual_total: boolean;
  customer: { public_id: string; full_name: string; phone: string | null } | null;
  address: { address_line: string; city: string | null; district: string | null } | null;
  items: Array<{ public_id: string; product_public_id: string | null; name: string; quantity: number; unit_price: string; total_amount: string }>;
  locked_reason: OrderEditLockReason | null;
  updated_at: string;
}

export interface OrderEditInput {
  customer: { fullName: string; phone: string };
  address: { addressLine: string; city: string; district: string };
  notes: string | null;
  cargoProvider: "ptt" | "surat" | null;
  items: Array<{ publicId: string | null; productPublicId: string | null; name: string; quantity: number; unitPrice: string }>;
  /** Legacy fiyat_manuel: a grand total that differs from the line sum (stored as manual_adjustment_amount). */
  totalAmount: string | null;
  actorUserId: number | null;
}

export class OrderEditLockedError extends Error {
  constructor(readonly reason: OrderEditLockReason) {
    super(`Order cannot be edited: ${reason}`);
  }
}

export class OrderEditItemNotFoundError extends Error {}

const cancelledStatuses = new Set(["cancelled", "iptal", "iptal_edildi"]);
// A KolayBi transfer in flight (order-action-routes openKolaybiStatuses) also locks the order.
const openKolaybiStatuses = new Set(["contact_lookup", "contact_create", "invoice_create"]);

/** Signed money string (manual adjustments can be negative). */
function signedMoney(cents: number) {
  return cents < 0 ? `-${centsToMoneyString(-cents)}` : centsToMoneyString(cents);
}

function lockReason(order: { deleted_at: unknown; kolaybi_invoice_id: string | null; kolaybi_status: string | null; status: string }): OrderEditLockReason | null {
  if (order.deleted_at) return "deleted";
  if (order.kolaybi_invoice_id || (order.kolaybi_status !== null && openKolaybiStatuses.has(order.kolaybi_status))) return "kolaybi";
  if (cancelledStatuses.has(order.status)) return "cancelled";
  return null;
}

type Executor = Pick<AppDatabase, "selectFrom">;

export class OrderEditRepository {
  constructor(private readonly db: AppDatabase) {}

  async get(orderPublicId: string): Promise<EditableOrder | null> {
    return this.load(this.db, orderPublicId);
  }

  private async load(db: Executor, orderPublicId: string): Promise<EditableOrder | null> {
    const order = await db
      .selectFrom("orders")
      .leftJoin("customers", "customers.id", "orders.customer_id")
      .select([
        "orders.id as id",
        "orders.public_id as public_id",
        "orders.order_number as order_number",
        "orders.status as status",
        "orders.cargo_provider as cargo_provider",
        "orders.notes as notes",
        "orders.currency as currency",
        "orders.total_amount as total_amount",
        "orders.manual_adjustment_amount as manual_adjustment_amount",
        "orders.deleted_at as deleted_at",
        "orders.kolaybi_invoice_id as kolaybi_invoice_id",
        "orders.kolaybi_status as kolaybi_status",
        "orders.updated_at as updated_at",
        "orders.customer_id as customer_id",
        "customers.public_id as customer_public_id",
        "customers.full_name as customer_full_name",
        "customers.phone as customer_phone",
      ])
      .where("orders.public_id", "=", orderPublicId)
      .executeTakeFirst();
    if (!order) return null;
    const [address, items] = await Promise.all([
      order.customer_id === null
        ? Promise.resolve(undefined)
        : db
            .selectFrom("customer_addresses")
            .select(["address_line", "city", "district"])
            .where("customer_id", "=", order.customer_id)
            .orderBy("is_default", "desc")
            .orderBy("updated_at", "desc")
            .orderBy("id", "desc")
            .executeTakeFirst(),
      db
        .selectFrom("order_items")
        .leftJoin("products", "products.id", "order_items.product_id")
        .select([
          "order_items.public_id as public_id",
          "products.public_id as product_public_id",
          "order_items.name as name",
          "order_items.quantity as quantity",
          "order_items.unit_price as unit_price",
          "order_items.total_amount as total_amount",
        ])
        .where("order_items.order_id", "=", order.id)
        .orderBy("order_items.id", "asc")
        .execute(),
    ]);
    const itemsTotalCents = items.reduce((sum, item) => sum + moneyToCents(String(item.total_amount)), 0);
    return {
      public_id: order.public_id,
      order_number: order.order_number,
      status: order.status,
      cargo_provider: order.cargo_provider,
      notes: order.notes,
      currency: order.currency,
      total_amount: String(order.total_amount),
      items_total: centsToMoneyString(itemsTotalCents),
      manual_total: String(order.manual_adjustment_amount ?? "0").replace(/[-0.]/g, "") !== "",
      customer:
        order.customer_public_id && order.customer_full_name !== null
          ? { public_id: order.customer_public_id, full_name: order.customer_full_name, phone: order.customer_phone ?? null }
          : null,
      address: address ? { address_line: address.address_line, city: address.city ?? null, district: address.district ?? null } : null,
      items: items.map((item) => ({
        public_id: item.public_id,
        product_public_id: item.product_public_id ?? null,
        name: item.name,
        quantity: Number(item.quantity),
        unit_price: String(item.unit_price),
        total_amount: String(item.total_amount),
      })),
      locked_reason: lockReason(order),
      updated_at: new Date(order.updated_at).toISOString(),
    };
  }

  async update(orderPublicId: string, input: OrderEditInput): Promise<EditableOrder | null> {
    return this.db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom("orders")
        .select(["id", "public_id", "status", "customer_id", "total_amount", "notes", "cargo_provider", "deleted_at", "kolaybi_invoice_id", "kolaybi_status"])
        .where("public_id", "=", orderPublicId)
        .forUpdate()
        .executeTakeFirst();
      if (!order) return null;
      const locked = lockReason(order);
      if (locked) throw new OrderEditLockedError(locked);
      const now = new Date();

      // Customer identity (legacy stored musteri_ad / musteri_telefon on the order row).
      let customerId = order.customer_id;
      if (customerId !== null) {
        await trx.updateTable("customers").set({ full_name: input.customer.fullName, phone: input.customer.phone, updated_at: now }).where("id", "=", customerId).execute();
      } else {
        const created = await trx
          .insertInto("customers")
          .values({ public_id: newPublicId("cus"), full_name: input.customer.fullName, phone: input.customer.phone, email: null, username: null, notes: null })
          .returning("id")
          .executeTakeFirstOrThrow();
        customerId = created.id;
      }

      const address = await trx
        .selectFrom("customer_addresses")
        .select(["id"])
        .where("customer_id", "=", customerId)
        .orderBy("is_default", "desc")
        .orderBy("updated_at", "desc")
        .orderBy("id", "desc")
        .executeTakeFirst();
      if (address) {
        await trx
          .updateTable("customer_addresses")
          .set({ address_line: input.address.addressLine, city: input.address.city, district: input.address.district, updated_at: now })
          .where("id", "=", address.id)
          .execute();
      } else {
        await trx
          .insertInto("customer_addresses")
          .values({
            public_id: newPublicId("adr"),
            customer_id: customerId,
            label: "Teslimat",
            address_line: input.address.addressLine,
            district: input.address.district,
            city: input.address.city,
            country: "Türkiye",
            postal_code: null,
            is_default: true,
          })
          .execute();
      }

      // Item sync: delete lines the form dropped, update kept lines, insert new ones.
      const existing = await trx.selectFrom("order_items").select(["id", "public_id"]).where("order_id", "=", order.id).execute();
      const existingByPublicId = new Map(existing.map((row) => [row.public_id, row.id]));
      for (const item of input.items) {
        if (item.publicId && !existingByPublicId.has(item.publicId)) throw new OrderEditItemNotFoundError(item.publicId);
      }
      const kept = new Set(input.items.map((item) => item.publicId).filter((value): value is string => Boolean(value)));
      const removed = existing.filter((row) => !kept.has(row.public_id)).map((row) => row.id);
      if (removed.length > 0) await trx.deleteFrom("order_items").where("id", "in", removed).execute();

      const productIds = new Map<string, { id: number; external_product_id: string | null }>();
      const productPublicIds = [...new Set(input.items.map((item) => item.productPublicId).filter((value): value is string => Boolean(value)))];
      if (productPublicIds.length > 0) {
        const products = await trx.selectFrom("products").select(["id", "public_id", "external_product_id"]).where("public_id", "in", productPublicIds).execute();
        for (const product of products) productIds.set(product.public_id, { id: product.id, external_product_id: product.external_product_id });
      }

      let itemsTotalCents = 0;
      for (const item of input.items) {
        const unitCents = moneyToCents(item.unitPrice);
        const lineCents = unitCents * item.quantity;
        itemsTotalCents += lineCents;
        const product = item.productPublicId ? productIds.get(item.productPublicId) : undefined;
        const values = {
          name: item.name,
          quantity: item.quantity,
          unit_price: centsToMoneyString(unitCents),
          total_amount: centsToMoneyString(lineCents),
          ...(product ? { product_id: product.id, external_product_id: product.external_product_id } : {}),
        };
        const rowId = item.publicId ? existingByPublicId.get(item.publicId) : undefined;
        if (rowId !== undefined) {
          await trx.updateTable("order_items").set({ ...values, updated_at: now }).where("id", "=", rowId).execute();
        } else {
          await trx
            .insertInto("order_items")
            .values({ public_id: newPublicId("oit"), order_id: order.id, product_id: product?.id ?? null, external_product_id: product?.external_product_id ?? null, ...values })
            .execute();
        }
      }

      const totalCents = input.totalAmount === null ? itemsTotalCents : moneyToCents(input.totalAmount);
      await trx
        .updateTable("orders")
        .set({
          customer_id: customerId,
          notes: input.notes,
          cargo_provider: input.cargoProvider,
          total_amount: centsToMoneyString(totalCents),
          manual_adjustment_amount: signedMoney(totalCents - itemsTotalCents),
          updated_at: now,
        })
        .where("id", "=", order.id)
        .execute();

      await trx
        .insertInto("audit_logs")
        .values({
          actor_user_id: input.actorUserId,
          action: "update",
          entity_type: "orders",
          entity_id: order.public_id,
          old_value: { total_amount: String(order.total_amount), notes: order.notes, cargo_provider: order.cargo_provider, item_count: existing.length },
          new_value: { total_amount: centsToMoneyString(totalCents), notes: input.notes, cargo_provider: input.cargoProvider, item_count: input.items.length },
          ip_address: null,
          user_agent: null,
        })
        .execute();

      return this.load(trx, orderPublicId);
    });
  }
}
