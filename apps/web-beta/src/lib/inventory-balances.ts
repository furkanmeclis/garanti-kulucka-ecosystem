/** Stock (`/api/products*`) and balance (`/api/balances*`) shapes used by the beta pages. */
export interface ProductSummary {
  public_id: string;
  sku: string | null;
  name: string;
  category: string | null;
  unit_price: string;
  stock_quantity: number;
  is_active: boolean;
  external_product_id: string | null;
  unit?: ProductUnit;
  description?: string | null;
  updated_at: string;
}

export type ProductCategory = "incubator" | "spare_part" | "other";
export type ProductUnit = "Adet" | "Kg" | "Lt" | "Mt" | "Koli";
export type StockMovementType = "in" | "out" | "adjustment";

export interface StockMovementSummary {
  public_id: string;
  product_public_id: string;
  movement_type: StockMovementType;
  quantity: number;
  previous_quantity: number;
  new_quantity: number;
  notes: string | null;
  created_by_user_email: string | null;
  created_at: string;
}

export interface ProductInput {
  name: string;
  sku?: string | null;
  category?: ProductCategory | null;
  unit?: ProductUnit;
  unit_price?: string;
  stock_quantity?: number;
  description?: string | null;
  external_product_id?: string | null;
}

export interface ProductSummaryStats {
  total_count: number;
  active_count: number;
  critical_count: number;
  critical_threshold: number;
  category_counts: {
    incubator: number;
    spare_part: number;
    other: number;
  };
}

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
