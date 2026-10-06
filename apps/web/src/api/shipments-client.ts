import type { ShipmentSummary } from "./domain-client.js";
import type { BackendHttpClient } from "./http-client.js";

export type CargoProviderKey = "ptt" | "surat";
/** Legacy kargo onay modal "Ödeme Durumu": Kapıda ödemeli / Ödeme alındı. */
export type ShipmentPaymentStatus = "karsi_odemeli" | "odeme_alindi";

export interface ShipmentDraftItem {
  name: string;
  quantity: number;
  unit_price: string;
  total_amount: string;
}

export interface ShipmentMeasurements {
  weight_kg: number;
  desi: number;
}

export interface ShipmentRecipient {
  name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
}

export interface ShipmentDraft {
  order_public_id: string;
  order_number: string;
  order_status: string;
  total_amount: string;
  currency: string;
  cargo_provider: string | null;
  recipient: ShipmentRecipient;
  items: ShipmentDraftItem[];
  missing_field: string | null;
  measurements: Record<CargoProviderKey, ShipmentMeasurements>;
  existing_shipment: {
    public_id: string;
    provider: string;
    status: string;
    tracking_number: string | null;
    barcode_number: string | null;
  } | null;
}

export interface CreateShipmentInput {
  provider: CargoProviderKey;
  payment_status: ShipmentPaymentStatus;
  idempotency_key: string;
  recipient_address?: string;
  recipient_city?: string;
  recipient_district?: string;
}

export interface CreateShipmentResponse {
  provider: CargoProviderKey;
  operation: "shipment.create";
  request_id: string;
  job_id: string | null;
  queued: boolean;
  replayed: boolean;
  live_call_permitted: boolean;
  live_gate: string;
  order_public_id: string;
  order_number: string;
  barcode_number: string | null;
  barcode_range: string | null;
  barcode_pool_exhausted: boolean;
  weight_kg: number;
  desi: number;
  payment_status: ShipmentPaymentStatus;
  message: string;
  shipment: ShipmentSummary | null;
}

export interface BulkCreateShipmentsResponse {
  provider: CargoProviderKey;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  message: string;
  results: Array<{
    order_public_id: string;
    status: "created" | "skipped" | "failed";
    reason: string | null;
    message?: string;
    barcode_number?: string | null;
    shipment: ShipmentSummary | null;
  }>;
}

export interface ShipmentPrintData {
  shipment_public_id: string;
  provider: string;
  provider_label: string;
  status: string;
  tracking_number: string | null;
  barcode_number: string | null;
  barcode_value: string | null;
  barcode_format: "CODE128";
  payment_type: string | null;
  label_printed_at: string | null;
  invoice_title: string;
  recipient: ShipmentRecipient;
  order: {
    public_id: string;
    order_number: string | null;
    total_amount: string | null;
    currency: string | null;
    created_at: string | null;
  } | null;
  items: ShipmentDraftItem[];
  created_at: string;
}

export function createShipmentsClient(http: BackendHttpClient) {
  return {
    getShipmentDraft: (orderPublicId: string) =>
      http.request<ShipmentDraft>(`/api/orders/${encodeURIComponent(orderPublicId)}/shipment-draft`),
    createShipment: (orderPublicId: string, input: CreateShipmentInput) =>
      http.request<CreateShipmentResponse>(`/api/orders/${encodeURIComponent(orderPublicId)}/shipments`, {
        method: "POST",
        body: input,
      }),
    bulkCreateShipments: (input: { provider: CargoProviderKey; order_public_ids: string[]; idempotency_key: string }) =>
      http.request<BulkCreateShipmentsResponse>("/api/shipments/bulk-create", { method: "POST", body: input }),
    getShipmentPrint: (shipmentPublicId: string) =>
      http.request<ShipmentPrintData>(`/api/shipments/${encodeURIComponent(shipmentPublicId)}/print`),
    markShipmentPrinted: (shipmentPublicId: string, idempotencyKey: string) =>
      http.request<{ shipment_public_id: string; label_printed_at: string }>(
        `/api/shipments/${encodeURIComponent(shipmentPublicId)}/printed`,
        { method: "POST", body: { idempotency_key: idempotencyKey } },
      ),
  };
}

export type ShipmentsClient = ReturnType<typeof createShipmentsClient>;
