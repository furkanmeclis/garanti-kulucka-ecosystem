/**
 * Legacy `POST /api/kolaybi/cari-olustur` (server.js) as a server-side workflow composed of the worker's
 * atomic KolayBi operations: `contact.find` → `contact.create` (country / district / address / tax office
 * retries) → `invoice.create`. Every step is one `provider-delivery` job; this planner only decides what
 * the next step is from the outcome of the previous one, so it is pure and replayable.
 */

export type KolaybiWorkflowOperation = "contact.find" | "contact.create" | "invoice.create";

export interface KolaybiWorkflowOrder {
  orderPublicId: string;
  orderNumber: string;
  createdAt: string;
  customer: { fullName: string; phone: string; email: string | null };
  address: { addressLine: string; city: string; district: string; country: string } | null;
  items: Array<{ name: string; quantity: number; unitPrice: string; externalProductId: string | null }>;
}

/** Legacy country retry order: no country → "Türkiye" → "Turkey" → "TR" → "TUR". */
export const kolaybiCountryCandidates = ["", "Türkiye", "Turkey", "TR", "TUR"] as const;
export const KOLAYBI_MAX_CONTACT_CREATE_ATTEMPTS = 10;

export interface ContactCreateVariant {
  country_index: number;
  include_district: boolean;
  include_address: boolean;
  include_tax_office: boolean;
}

export const initialContactCreateVariant: ContactCreateVariant = {
  country_index: 0,
  include_district: true,
  include_address: true,
  include_tax_office: true,
};

export type KolaybiStepOutcome =
  | { status: "succeeded"; result: Record<string, unknown> }
  | { status: "failed"; error: string };

export interface KolaybiPreviousStep {
  operation: KolaybiWorkflowOperation;
  attempt: number;
  requestPayload: Record<string, unknown>;
  outcome: KolaybiStepOutcome;
}

export type KolaybiWorkflowDecision =
  | { kind: "enqueue"; operation: KolaybiWorkflowOperation; attempt: number; payload: Record<string, unknown>; orderStatus: KolaybiOrderStatus }
  | { kind: "completed"; contactId: string; addressId: string | null; invoiceId: string }
  | { kind: "failed"; error: string; contactId?: string | null; addressId?: string | null };

export type KolaybiOrderStatus = "contact_lookup" | "contact_create" | "invoice_create" | "completed" | "failed";

export function kolaybiStatusForOperation(operation: KolaybiWorkflowOperation): KolaybiOrderStatus {
  if (operation === "contact.find") return "contact_lookup";
  if (operation === "contact.create") return "contact_create";
  return "invoice_create";
}

function idString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Legacy siparis tarihi in Europe/Istanbul (YYYY-MM-DD). */
function orderDate(createdAt: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(createdAt));
}

export function contactLookupPayload(order: KolaybiWorkflowOrder): Record<string, unknown> {
  return {
    order_public_id: order.orderPublicId,
    phone: order.customer.phone,
    ...(order.customer.email ? { email: order.customer.email } : {}),
  };
}

export function contactCreatePayload(order: KolaybiWorkflowOrder, variant: ContactCreateVariant): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    order_public_id: order.orderPublicId,
    musteri_ad: order.customer.fullName,
    phone: order.customer.phone,
    ...(order.customer.email ? { email: order.customer.email } : {}),
    variant,
  };
  if (!variant.include_tax_office) payload.skip_tax_office = true;
  if (!order.address || !variant.include_address) {
    payload.skip_address = true;
    return payload;
  }
  payload.address = order.address.addressLine;
  payload.city = order.address.city;
  if (variant.include_district && order.address.district) payload.district = order.address.district;
  const country = kolaybiCountryCandidates[variant.country_index] ?? "";
  if (country) payload.country = country;
  return payload;
}

/** Legacy invoice body: KDV-included price / 1.20, vat_rate 20, description "Sipariş: {no}". */
export function invoiceCreatePayload(order: KolaybiWorkflowOrder, contactId: string, addressId: string | null): Record<string, unknown> {
  return {
    order_public_id: order.orderPublicId,
    contact_id: contactId,
    ...(addressId ? { address_id: addressId } : {}),
    currency: "try",
    description: `Sipariş: ${order.orderNumber}`,
    order_date: orderDate(order.createdAt),
    items: order.items.map((item) => ({
      ...(item.externalProductId ? { product_id: item.externalProductId } : {}),
      quantity: String(item.quantity),
      unit_price: (Math.round((Number(item.unitPrice) / 1.2) * 100) / 100).toFixed(2),
      vat_rate: "20",
      description: item.name,
    })),
  };
}

function variantFrom(payload: Record<string, unknown>): ContactCreateVariant {
  const raw = isRecord(payload.variant) ? payload.variant : {};
  return {
    country_index: typeof raw.country_index === "number" ? raw.country_index : 0,
    include_district: raw.include_district !== false,
    include_address: raw.include_address !== false,
    include_tax_office: raw.include_tax_office !== false,
  };
}

/** Legacy retry ladder after a failed `/associates` create, chosen from the KolayBi error text. */
export function nextContactCreateVariant(current: ContactCreateVariant, error: string): ContactCreateVariant | null {
  const text = error.toLocaleLowerCase("tr-TR");
  if (/vergi dairesi|tax[_ ]office/.test(text)) {
    if (current.include_tax_office) return { ...current, include_tax_office: false };
    if (current.include_address) return { ...current, include_address: false };
    return null;
  }
  if (/ilçe|ilce|district/.test(text)) {
    if (current.include_address && current.include_district) return { ...current, include_district: false, country_index: 1 };
    if (current.include_address) return { ...current, include_address: false };
    return null;
  }
  if (/country|ülke|ulke/.test(text) && current.include_address) {
    if (current.country_index + 1 < kolaybiCountryCandidates.length) return { ...current, country_index: current.country_index + 1 };
    if (current.include_district) return { ...current, include_district: false, country_index: 1 };
    return { ...current, include_address: false };
  }
  if (current.include_address) return { ...current, include_address: false };
  return null;
}

function alreadyExists(error: string) {
  return /\b412\b|already|zaten|mevcut/i.test(error);
}

export function firstKolaybiStep(order: KolaybiWorkflowOrder, existing: { contactId: string | null; addressId: string | null }): KolaybiWorkflowDecision {
  if (existing.contactId) {
    return { kind: "enqueue", operation: "invoice.create", attempt: 0, payload: invoiceCreatePayload(order, existing.contactId, existing.addressId), orderStatus: "invoice_create" };
  }
  return { kind: "enqueue", operation: "contact.find", attempt: 0, payload: contactLookupPayload(order), orderStatus: "contact_lookup" };
}

export function planNextKolaybiStep(order: KolaybiWorkflowOrder, previous: KolaybiPreviousStep): KolaybiWorkflowDecision {
  const { outcome } = previous;
  if (previous.operation === "contact.find") {
    if (outcome.status === "failed") return { kind: "failed", error: `KolayBi cari arama başarısız: ${outcome.error}` };
    const contact = isRecord(outcome.result.contact) ? outcome.result.contact : null;
    const contactId = contact ? idString(contact.id ?? contact.contact_id) : null;
    if (outcome.result.found === true && contactId) {
      const addressId = contact ? idString(contact.address_id) : null;
      return { kind: "enqueue", operation: "invoice.create", attempt: 0, payload: invoiceCreatePayload(order, contactId, addressId), orderStatus: "invoice_create" };
    }
    if (previous.attempt > 0) return { kind: "failed", error: "KolayBi müşteri oluşturulamadı (HTTP 412)" };
    return { kind: "enqueue", operation: "contact.create", attempt: 0, payload: contactCreatePayload(order, initialContactCreateVariant), orderStatus: "contact_create" };
  }

  if (previous.operation === "contact.create") {
    if (outcome.status === "succeeded") {
      const contactId = idString(outcome.result.contact_id);
      if (!contactId) return { kind: "failed", error: "KolayBi cari yanıtında id yok" };
      const addressId = idString(outcome.result.address_id);
      return { kind: "enqueue", operation: "invoice.create", attempt: 0, payload: invoiceCreatePayload(order, contactId, addressId), orderStatus: "invoice_create" };
    }
    if (alreadyExists(outcome.error)) {
      return { kind: "enqueue", operation: "contact.find", attempt: 1, payload: contactLookupPayload(order), orderStatus: "contact_lookup" };
    }
    const nextAttempt = previous.attempt + 1;
    const next = nextContactCreateVariant(variantFrom(previous.requestPayload), outcome.error);
    if (!next || nextAttempt >= KOLAYBI_MAX_CONTACT_CREATE_ATTEMPTS) {
      return { kind: "failed", error: `KolayBi müşteri oluşturulamadı: ${outcome.error}` };
    }
    return { kind: "enqueue", operation: "contact.create", attempt: nextAttempt, payload: contactCreatePayload(order, next), orderStatus: "contact_create" };
  }

  const contactId = idString(previous.requestPayload.contact_id);
  const addressId = idString(previous.requestPayload.address_id);
  if (outcome.status === "failed") {
    return { kind: "failed", error: "Cari oluşturuldu ama fatura oluşturulamadı. Tekrar deneyin.", contactId, addressId };
  }
  const data = isRecord(outcome.result.data) ? outcome.result.data : outcome.result;
  const invoiceId = idString(data.id ?? data.invoice_id ?? data.document_id);
  if (!invoiceId || !contactId) {
    return { kind: "failed", error: "Cari oluşturuldu ama fatura oluşturulamadı. Tekrar deneyin.", contactId, addressId };
  }
  return { kind: "completed", contactId, addressId, invoiceId };
}

/** Legacy teyit_durumu mapping from the NetGSM IVR report (worker `parseNetgsmConfirmationReport`). */
export function confirmationStatusFromOutcome(outcome: unknown): string | null {
  if (outcome === "teyit_edildi" || outcome === "iptal_istegi" || outcome === "gecersiz_numara" || outcome === "ulasilamadi") return outcome;
  return null;
}
