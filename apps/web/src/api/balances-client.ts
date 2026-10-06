import type { BackendHttpClient } from "./http-client.js";

export type BalanceMovementKind = "commission" | "cancellation" | "return" | "payment" | "adjustment" | "rollback";
export type BalancePaymentRequestStatus = "pending" | "seen" | "approved" | "rejected";

export interface LedgerBalanceSummary {
  scope: "all" | "own";
  balance: number;
  total_commission: number;
  total_deduction: number;
  total_payment: number;
  pending_payment: number;
  available_balance: number;
  pending_request_count: number;
}

export interface StaffBalance {
  user_public_id: string;
  first_name: string;
  last_name: string;
  is_online: boolean;
  balance: number;
  pending_payment: number;
  pending_request_count: number;
}

export interface BalanceMovement {
  public_id: string;
  kind: BalanceMovementKind;
  amount: number;
  balance_after: number;
  description: string | null;
  user_public_id: string | null;
  user_full_name: string | null;
  order_public_id: string | null;
  order_number: string | null;
  customer_full_name: string | null;
  created_at: string;
}

export interface BalancePaymentRequest {
  public_id: string;
  amount: number;
  status: BalancePaymentRequestStatus;
  user_public_id: string | null;
  user_full_name: string | null;
  processed_by_user_public_id: string | null;
  processed_at: string | null;
  note: string | null;
  created_at: string;
}

export interface StaffOrder {
  public_id: string;
  order_number: string;
  customer_full_name: string | null;
  customer_phone: string | null;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
}

export interface BalancePaymentRequestResult {
  request: BalancePaymentRequest;
  replayed: boolean;
  message: string;
}

export interface ProcessBalancePaymentRequestResult {
  request: BalancePaymentRequest;
  message: string;
}

export interface BalanceListQuery {
  limit?: number;
  offset?: number;
  user_public_id?: string;
}

function listQuery(query: BalanceListQuery & { status?: BalancePaymentRequestStatus } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function createBalancesClient(http: BackendHttpClient) {
  return {
    getSummary: () => http.request<LedgerBalanceSummary>("/api/balances/summary"),
    listStaff: () => http.request<{ data: StaffBalance[] }>("/api/balances/staff"),
    listStaffOrders: (userPublicId: string) =>
      http.request<{ data: StaffOrder[] }>(`/api/balances/staff/${encodeURIComponent(userPublicId)}/orders`),
    resetStaffBalance: (userPublicId: string) =>
      http.request<{ previous_balance: number; message: string }>(
        `/api/balances/staff/${encodeURIComponent(userPublicId)}/reset`,
        { method: "POST", body: {} },
      ),
    listMovements: (query: BalanceListQuery = {}) =>
      http.request<{ data: BalanceMovement[]; total: number }>(`/api/balances/movements${listQuery(query)}`),
    listPaymentRequests: (query: BalanceListQuery & { status?: BalancePaymentRequestStatus } = {}) =>
      http.request<{ data: BalancePaymentRequest[]; total: number }>(`/api/balances/payment-requests${listQuery(query)}`),
    createPaymentRequest: (input: { amount: string; idempotency_key: string }) =>
      http.request<BalancePaymentRequestResult>("/api/balances/payment-requests", { method: "POST", body: input }),
    processPaymentRequest: (publicId: string, decision: "approve" | "reject", note?: string | null) =>
      http.request<ProcessBalancePaymentRequestResult>(
        `/api/balances/payment-requests/${encodeURIComponent(publicId)}/${decision}`,
        { method: "POST", body: note === undefined ? {} : { note } },
      ),
  };
}

export type BalancesClient = ReturnType<typeof createBalancesClient>;
