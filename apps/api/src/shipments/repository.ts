import { sql, type AppDatabase } from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";
import { loadDocumentSender, type DocumentSender } from "../documents/sender.js";
import {
  PTT_BARCODE_DEFAULT_RANGE,
  isValidPttBarcodeRange,
  pttBarcodeLockKey,
  pttSequenceFromBarcode,
  reservePttBarcode,
  type PttBarcodeLedger,
  type PttBarcodeReservation,
} from "./ptt-barcode.js";

export type CargoProviderKey = "ptt" | "surat";
/** Legacy `odemeDurumu`: `karsi_odemeli` (Kapıda ödemeli) or `odeme_alindi` (Ödeme alındı). */
export type ShipmentPaymentStatus = "karsi_odemeli" | "odeme_alindi";

export class ShipmentOrderNotFoundError extends Error {
  constructor(orderPublicId: string) {
    super(`Unknown order: ${orderPublicId}`);
    this.name = "ShipmentOrderNotFoundError";
  }
}

export class ShipmentAlreadyExistsError extends Error {
  constructor(readonly shipmentPublicId: string) {
    super("Bu sipariş için gönderi daha önce oluşturulmuş.");
    this.name = "ShipmentAlreadyExistsError";
  }
}

export class MissingRecipientFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingRecipientFieldError";
  }
}

export interface ShipmentDraftItem {
  name: string;
  quantity: number;
  unit_price: string;
  total_amount: string;
}

export interface ShipmentDraft {
  order_id: number;
  order_public_id: string;
  order_number: string;
  order_status: string;
  total_amount: string;
  currency: string;
  cargo_provider: string | null;
  customer_id: number | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_district: string | null;
  items: ShipmentDraftItem[];
  existing_shipment: { public_id: string; provider: string; status: string; tracking_number: string | null; barcode_number: string | null } | null;
}

export interface ShipmentMeasurements {
  weight_kg: number;
  desi: number;
}

/** Legacy `_kargoOlusturInternal` weight/desi: machine items 1 kg + Sürat 18 / PTT 15 desi, others 0.5 kg + 1 desi. */
export function calculateShipmentMeasurements(items: Array<{ name: string; quantity: number }>, provider: CargoProviderKey): ShipmentMeasurements {
  if (items.length === 0) return { weight_kg: 1, desi: 1 };
  const machineDesi = provider === "surat" ? 18 : 15;
  let weight = 0;
  let desi = 0;
  for (const item of items) {
    const name = item.name.toLocaleLowerCase("tr-TR");
    const quantity = Number(item.quantity) || 1;
    const isMachine = name.includes("kuluçka") || name.includes("kulucka") || name.includes("makine") || name.includes("makina");
    weight += (isMachine ? 1 : 0.5) * quantity;
    desi += (isMachine ? machineDesi : 1) * quantity;
  }
  return { weight_kg: Math.max(1, Math.ceil(weight)), desi: Math.max(1, Math.ceil(desi)) };
}

/** Legacy missing-field guard text: "Müşteri adı eksik (ORD-...)". */
export function missingRecipientField(input: {
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_district: string | null;
  order_number: string;
}): string | null {
  const field = !input.recipient_name?.trim()
    ? "Müşteri adı"
    : !input.recipient_phone?.trim()
      ? "Müşteri telefonu"
      : !input.recipient_address?.trim()
        ? "Müşteri adresi"
        : !input.recipient_city?.trim()
          ? "İl bilgisi"
          : !input.recipient_district?.trim()
            ? "İlçe bilgisi"
            : null;
  return field ? `${field} eksik (${input.order_number})` : null;
}

export interface CreateShipmentInput {
  orderPublicId: string;
  provider: CargoProviderKey;
  paymentStatus: ShipmentPaymentStatus;
  idempotencyKey: string;
  actorUserId: number | null;
  recipientOverrides: { address?: string | undefined; city?: string | undefined; district?: string | undefined };
}

export interface CreatedShipment {
  shipment_public_id: string;
  replayed: boolean;
  barcode_number: string | null;
  barcode_pool_exhausted: boolean;
  barcode_range: string | null;
  measurements: ShipmentMeasurements;
  draft: ShipmentDraft;
  recipient: { name: string; phone: string; address: string; city: string; district: string };
}

export interface ShipmentPrintData {
  shipment_public_id: string;
  provider: string;
  status: string;
  tracking_number: string | null;
  barcode_number: string | null;
  barcode_value: string | null;
  payment_type: string | null;
  label_printed_at: Date | null;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_address: string;
  recipient_city: string | null;
  recipient_district: string | null;
  order_public_id: string | null;
  order_number: string | null;
  order_total_amount: string | null;
  order_currency: string | null;
  order_created_at: Date | null;
  items: ShipmentDraftItem[];
  created_at: Date;
}

type Tx = AppDatabase;

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export class ShipmentCreateRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Sender block for printed labels (global `gonderici_*` settings). */
  async getSender(): Promise<DocumentSender> {
    return loadDocumentSender(this.db);
  }

  private async loadDraft(db: Tx, orderPublicId: string): Promise<ShipmentDraft | null> {
    const order = await db
      .selectFrom("orders")
      .leftJoin("customers", "customers.id", "orders.customer_id")
      .select([
        "orders.id",
        "orders.public_id",
        "orders.order_number",
        "orders.status",
        "orders.total_amount",
        "orders.currency",
        "orders.cargo_provider",
        "orders.customer_id",
        "customers.full_name as customer_full_name",
        "customers.phone as customer_phone",
      ])
      .where("orders.public_id", "=", orderPublicId)
      .executeTakeFirst();
    if (!order) return null;

    const [address, items, existing] = await Promise.all([
      order.customer_id
        ? db
            .selectFrom("customer_addresses")
            .select(["address_line", "city", "district"])
            .where("customer_id", "=", order.customer_id)
            .orderBy("is_default", "desc")
            .orderBy("updated_at", "desc")
            .orderBy("id", "desc")
            .executeTakeFirst()
        : Promise.resolve(undefined),
      db
        .selectFrom("order_items")
        .select(["name", "quantity", "unit_price", "total_amount"])
        .where("order_id", "=", order.id)
        .orderBy("id", "asc")
        .execute(),
      db
        .selectFrom("shipments")
        .select(["public_id", "provider", "status", "tracking_number", "barcode_number"])
        .where("order_id", "=", order.id)
        .where("status", "not in", ["cancelled", "failed"])
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .executeTakeFirst(),
    ]);

    return {
      order_id: Number(order.id),
      order_public_id: order.public_id,
      order_number: order.order_number,
      order_status: order.status,
      total_amount: String(order.total_amount),
      currency: order.currency,
      cargo_provider: order.cargo_provider,
      customer_id: order.customer_id === null ? null : Number(order.customer_id),
      recipient_name: order.customer_full_name ?? null,
      recipient_phone: order.customer_phone ?? null,
      recipient_address: address?.address_line ?? null,
      recipient_city: address?.city ?? null,
      recipient_district: address?.district ?? null,
      items: items.map((item) => ({
        name: item.name,
        quantity: Number(item.quantity),
        unit_price: String(item.unit_price),
        total_amount: String(item.total_amount),
      })),
      existing_shipment: existing ?? null,
    };
  }

  async getDraft(orderPublicId: string): Promise<ShipmentDraft | null> {
    return this.loadDraft(this.db, orderPublicId);
  }

  /** `barkod_araligi` from the active PTT integration account, falling back to the legacy default range. */
  async pttBarcodeRange(): Promise<string> {
    const row = await this.db
      .selectFrom("integration_settings")
      .innerJoin("integration_providers", "integration_providers.id", "integration_settings.provider_id")
      .leftJoin("integration_accounts", "integration_accounts.id", "integration_settings.account_id")
      .select(["integration_settings.value"])
      .where("integration_providers.key", "=", "ptt")
      .where("integration_settings.key", "=", "barkod_araligi")
      .where("integration_settings.is_secret", "=", false)
      .orderBy("integration_settings.updated_at", "desc")
      .executeTakeFirst();
    const value = textValue(row?.value);
    return value && isValidPttBarcodeRange(value) ? value : PTT_BARCODE_DEFAULT_RANGE;
  }

  private ledger(): PttBarcodeLedger<Tx> {
    return {
      withRangeLock: (range, callback) =>
        this.db.transaction().execute(async (transaction) => {
          await sql`select pg_advisory_xact_lock(hashtext(${pttBarcodeLockKey(range)}))`.execute(transaction);
          return callback(transaction as Tx);
        }),
      highestSequence: async (tx, range) => {
        const row = await tx
          .selectFrom("shipments")
          .select(["barcode_number", "tracking_number"])
          .where("provider", "=", "ptt")
          .where((expression) =>
            expression.or([
              expression("barcode_number", "like", `${range}%`),
              expression("tracking_number", "like", `${range}%`),
            ]),
          )
          .orderBy(sql`greatest(coalesce(barcode_number, ''), coalesce(tracking_number, ''))`, "desc")
          .limit(1)
          .executeTakeFirst();
        if (!row) return -1;
        const sequences = [pttSequenceFromBarcode(range, row.barcode_number), pttSequenceFromBarcode(range, row.tracking_number)].filter(
          (value): value is number => value !== null,
        );
        return sequences.length > 0 ? Math.max(...sequences) : -1;
      },
    };
  }

  async createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
    const replay = await this.db
      .selectFrom("shipments")
      .select(["public_id", "barcode_number", "order_id"])
      .where("create_idempotency_key", "=", input.idempotencyKey)
      .executeTakeFirst();

    const draft = await this.loadDraft(this.db, input.orderPublicId);
    if (!draft) throw new ShipmentOrderNotFoundError(input.orderPublicId);
    const measurements = calculateShipmentMeasurements(draft.items, input.provider);
    const recipient = {
      name: (draft.recipient_name ?? "").trim(),
      phone: (draft.recipient_phone ?? "").trim(),
      address: (input.recipientOverrides.address?.trim() || draft.recipient_address || "").trim(),
      city: (input.recipientOverrides.city?.trim() || draft.recipient_city || "").trim(),
      district: (input.recipientOverrides.district?.trim() || draft.recipient_district || "").trim(),
    };

    if (replay && Number(replay.order_id) === draft.order_id) {
      return {
        shipment_public_id: replay.public_id,
        replayed: true,
        barcode_number: replay.barcode_number,
        barcode_pool_exhausted: false,
        barcode_range: null,
        measurements,
        draft,
        recipient,
      };
    }
    if (draft.existing_shipment) throw new ShipmentAlreadyExistsError(draft.existing_shipment.public_id);

    const missing = missingRecipientField({
      recipient_name: recipient.name,
      recipient_phone: recipient.phone,
      recipient_address: recipient.address,
      recipient_city: recipient.city,
      recipient_district: recipient.district,
      order_number: draft.order_number,
    });
    if (missing) throw new MissingRecipientFieldError(missing);

    const persist = async (tx: Tx, reservation: PttBarcodeReservation | null) => {
      // Re-check inside the transaction so two concurrent creates for the same order cannot both pass.
      await tx.selectFrom("orders").select("id").where("id", "=", draft.order_id).forUpdate().execute();
      const existing = await tx
        .selectFrom("shipments")
        .select(["public_id"])
        .where("order_id", "=", draft.order_id)
        .where("status", "not in", ["cancelled", "failed"])
        .executeTakeFirst();
      if (existing) throw new ShipmentAlreadyExistsError(existing.public_id);

      const publicId = newPublicId("shp");
      const now = new Date();
      await tx
        .insertInto("shipments")
        .values({
          public_id: publicId,
          order_id: draft.order_id,
          customer_id: draft.customer_id,
          provider: input.provider,
          tracking_number: null,
          barcode_number: reservation?.barcode ?? null,
          status: "pending",
          recipient_name: recipient.name,
          recipient_phone: recipient.phone,
          recipient_address: recipient.address,
          recipient_city: recipient.city,
          recipient_district: recipient.district,
          last_event_text: input.provider === "ptt" ? "PTT kabul bekleniyor" : "Sürat barkod bekleniyor",
          raw_payload: {
            source: "kargo-olustur",
            payment_status: input.paymentStatus,
            weight_kg: measurements.weight_kg,
            desi: measurements.desi,
            order_total_amount: draft.total_amount,
            barcode_sequence: reservation?.sequence ?? null,
          },
          create_idempotency_key: input.idempotencyKey,
          payment_type: input.paymentStatus === "karsi_odemeli" ? "cash_on_delivery" : "prepaid",
          created_by_user_id: input.actorUserId,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await tx
        .updateTable("orders")
        .set({ cargo_provider: input.provider, updated_at: now })
        .where("id", "=", draft.order_id)
        .execute();
      return publicId;
    };

    if (input.provider === "ptt") {
      const range = await this.pttBarcodeRange();
      let exhausted = false;
      let barcode: string | null = null;
      const publicId = await reservePttBarcode(this.ledger(), range, async (tx, reservation) => {
        exhausted = reservation === null;
        barcode = reservation?.barcode ?? null;
        return persist(tx, reservation);
      });
      return {
        shipment_public_id: publicId,
        replayed: false,
        barcode_number: barcode,
        barcode_pool_exhausted: exhausted,
        barcode_range: range,
        measurements,
        draft,
        recipient,
      };
    }

    const publicId = await this.db.transaction().execute((transaction) => persist(transaction as Tx, null));
    return {
      shipment_public_id: publicId,
      replayed: false,
      barcode_number: null,
      barcode_pool_exhausted: false,
      barcode_range: null,
      measurements,
      draft,
      recipient,
    };
  }

  async getPrintData(shipmentPublicId: string): Promise<ShipmentPrintData | null> {
    const row = await this.db
      .selectFrom("shipments")
      .leftJoin("orders", "orders.id", "shipments.order_id")
      .select([
        "shipments.id",
        "shipments.public_id",
        "shipments.provider",
        "shipments.status",
        "shipments.tracking_number",
        "shipments.barcode_number",
        "shipments.payment_type",
        "shipments.label_printed_at",
        "shipments.recipient_name",
        "shipments.recipient_phone",
        "shipments.recipient_address",
        "shipments.recipient_city",
        "shipments.recipient_district",
        "shipments.created_at",
        "shipments.order_id",
        "orders.public_id as order_public_id",
        "orders.order_number",
        "orders.total_amount as order_total_amount",
        "orders.currency as order_currency",
        "orders.created_at as order_created_at",
      ])
      .where("shipments.public_id", "=", shipmentPublicId)
      .executeTakeFirst();
    if (!row) return null;
    const items = row.order_id
      ? await this.db
          .selectFrom("order_items")
          .select(["name", "quantity", "unit_price", "total_amount"])
          .where("order_id", "=", row.order_id)
          .orderBy("id", "asc")
          .execute()
      : [];
    return {
      shipment_public_id: row.public_id,
      provider: row.provider,
      status: row.status,
      tracking_number: row.tracking_number,
      barcode_number: row.barcode_number,
      barcode_value: row.tracking_number ?? row.barcode_number,
      payment_type: row.payment_type,
      label_printed_at: row.label_printed_at,
      recipient_name: row.recipient_name,
      recipient_phone: row.recipient_phone,
      recipient_address: row.recipient_address,
      recipient_city: row.recipient_city,
      recipient_district: row.recipient_district,
      order_public_id: row.order_public_id ?? null,
      order_number: row.order_number ?? null,
      order_total_amount: row.order_total_amount === null || row.order_total_amount === undefined ? null : String(row.order_total_amount),
      order_currency: row.order_currency ?? null,
      order_created_at: row.order_created_at ?? null,
      items: items.map((item) => ({
        name: item.name,
        quantity: Number(item.quantity),
        unit_price: String(item.unit_price),
        total_amount: String(item.total_amount),
      })),
      created_at: row.created_at,
    };
  }

  /** Legacy popup `beforeprint`/İndir → `kargo-yazdirildi` → marks the print as done; first mark wins. */
  async markPrinted(shipmentPublicId: string): Promise<{ label_printed_at: Date } | null> {
    const now = new Date();
    const updated = await this.db
      .updateTable("shipments")
      .set({ label_printed_at: sql<Date>`coalesce(label_printed_at, ${now})`, updated_at: now })
      .where("public_id", "=", shipmentPublicId)
      .returning(["label_printed_at"])
      .executeTakeFirst();
    if (!updated?.label_printed_at) return null;
    return { label_printed_at: updated.label_printed_at };
  }
}
