/**
 * Legacy commission rules (supabase 035_komisyon_sadece_kulucka_db, 038, 072_kargo_iptal_bakiye_dusmesin,
 * 073_kargo_sil_komisyon_koru) reproduced as a pure planner so they can be applied server-side
 * idempotently from any order write path.
 *
 * - Commission (`komisyon`): one fixed amount (settings, default 50 TL) per order that contains an
 *   incubator ("kuluçka") item, credited to the order creator once.
 * - Cancellation / return (`iptal` / `iade`): when the order moves into cancelled/returned the
 *   commission is deducted, unless the actor is a cargo operator (072/073).
 * - Rollback (`geri_alma`): when the order leaves cancelled/returned and a deduction is active the
 *   commission is credited back. No deduction → no rollback credit (072).
 */

export const balanceMovementKinds = ["commission", "cancellation", "return", "payment", "adjustment", "rollback"] as const;
export type BalanceMovementKind = (typeof balanceMovementKinds)[number];

export const paymentRequestStatuses = ["pending", "seen", "approved", "rejected"] as const;
export type PaymentRequestStatus = (typeof paymentRequestStatuses)[number];

export const DEFAULT_COMMISSION_AMOUNT_CENTS = 5000;
export const deductionOrderStatuses = ["cancelled", "returned"] as const;

export interface ExistingOrderMovement {
  kind: BalanceMovementKind;
  amount_cents: number;
}

export interface OrderBalanceState {
  orderPublicId: string;
  orderNumber: string;
  status: string;
  creatorUserId: number | null;
  itemNames: string[];
  existingMovements: ExistingOrderMovement[];
  commissionAmountCents: number;
  actorRole: string | null | undefined;
}

export interface PlannedMovement {
  kind: BalanceMovementKind;
  amount_cents: number;
  description: string;
  idempotency_key: string;
}

export function isIncubatorItem(name: string) {
  const normalized = name.toLocaleLowerCase("tr-TR");
  return normalized.includes("kuluçka") || normalized.includes("kulucka");
}

export function isDeductionStatus(status: string) {
  return (deductionOrderStatuses as readonly string[]).includes(status);
}

/** Returns the ledger rows that must be appended so the order's balance effect matches its status. */
export function planOrderBalanceMovements(state: OrderBalanceState): PlannedMovement[] {
  if (state.creatorUserId === null) return [];
  if (!state.itemNames.some(isIncubatorItem)) return [];

  const planned: PlannedMovement[] = [];
  const existingCommission = state.existingMovements.find((movement) => movement.kind === "commission");
  let commissionCents = existingCommission?.amount_cents ?? 0;

  if (!existingCommission) {
    commissionCents = state.commissionAmountCents;
    if (commissionCents <= 0) return [];
    planned.push({
      kind: "commission",
      amount_cents: commissionCents,
      description: `Sipariş komisyonu: ${state.orderNumber || "N/A"}`,
      idempotency_key: `order:${state.orderPublicId}:commission`,
    });
  }
  if (commissionCents <= 0) return planned;

  const deductionMovements = state.existingMovements.filter((movement) =>
    movement.kind === "cancellation" || movement.kind === "return" || movement.kind === "rollback",
  );
  const netDeductionCents = deductionMovements.reduce((sum, movement) => sum + movement.amount_cents, 0);
  const deductionActive = netDeductionCents < 0;
  const sequence = deductionMovements.length + 1;

  if (isDeductionStatus(state.status)) {
    if (deductionActive) return planned;
    if (state.actorRole === "kargo_operatoru") return planned;
    const kind: BalanceMovementKind = state.status === "cancelled" ? "cancellation" : "return";
    planned.push({
      kind,
      amount_cents: -commissionCents,
      description: `${kind === "cancellation" ? "Sipariş iptali" : "Sipariş iadesi"}: ${state.orderNumber || "N/A"}`,
      idempotency_key: `order:${state.orderPublicId}:deduction:${sequence}`,
    });
    return planned;
  }

  if (deductionActive) {
    planned.push({
      kind: "rollback",
      amount_cents: -netDeductionCents,
      description: `İptal geri alma: ${state.orderNumber || "N/A"}`,
      idempotency_key: `order:${state.orderPublicId}:deduction:${sequence}`,
    });
  }
  return planned;
}

export function moneyToCents(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Math.round(Number(value) * 100);
}

export function centsToMoney(cents: number) {
  return Math.round(cents) / 100;
}

export function centsToDecimalString(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export type CreatePaymentRequestCheck =
  | { ok: true }
  | { ok: false; code: "invalid_amount" | "insufficient_balance"; message: string };

/** Legacy `odeme_istegi_olustur` (038): amount must be > 0 and ≤ balance − pending requests. */
export function checkPaymentRequestAmount(input: { amountCents: number; balanceCents: number; pendingCents: number }): CreatePaymentRequestCheck {
  if (!(input.amountCents > 0)) {
    return { ok: false, code: "invalid_amount", message: "Geçerli bir tutar girin" };
  }
  if (input.amountCents > input.balanceCents - input.pendingCents) {
    return {
      ok: false,
      code: "insufficient_balance",
      message: `İstenen tutar kullanılabilir bakiyenizden fazla olamaz (Bakiye: ₺${centsToDecimalString(input.balanceCents)}, Bekleyen: ₺${centsToDecimalString(input.pendingCents)})`,
    };
  }
  return { ok: true };
}

/**
 * Legacy `siparis_sil` (073_kargo_sil_komisyon_koru) on a soft-deleted order: a cargo operator delete keeps
 * the creator's commission (hakediş korunur, no movement); any other role removes the order's net balance
 * effect. The ledger is append-only, so removal is one `adjustment` row that cancels the order's net sum.
 */
export function planOrderDeleteMovement(input: {
  orderPublicId: string;
  orderNumber: string;
  actorRole: string | null | undefined;
  netOrderCents: number;
}): PlannedMovement | null {
  if (input.actorRole === "kargo_operatoru") return null;
  if (input.netOrderCents === 0) return null;
  return {
    kind: "adjustment",
    amount_cents: -input.netOrderCents,
    description: `Sipariş silindi: ${input.orderNumber || "N/A"}`,
    idempotency_key: `order:${input.orderPublicId}:delete`,
  };
}
