import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";
import {
  checkPaymentRequestAmount,
  planOrderBalanceMovements,
  type ExistingOrderMovement,
  type OrderBalanceState,
} from "../src/balances/rules.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  let role = "calisan";
  return {
    setRole: (next: string) => {
      role = next;
    },
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_test",
        role_id: 1,
        email: "calisan@example.com",
        password_hash: "hash",
        first_name: "Ayse",
        last_name: "Yilmaz",
        phone: null,
        is_active: true,
        is_online: false,
        last_seen_at: null,
        sip_username: null,
        sip_password_encrypted: null,
        created_at: now,
        updated_at: now,
        role_name: role,
      })),
      findSessionByPublicId: vi.fn(async () => ({
        id: 100,
        public_id: "ses_test",
        user_id: 10,
        user_agent: null,
        ip_address: null,
        expires_at: new Date("2099-02-01T00:00:00.000Z"),
        revoked_at: null,
        created_at: now,
        updated_at: now,
      })),
    },
    balanceRepository: {
      getSummary: vi.fn(async (scopeUserId: number | null) => ({
        scope: scopeUserId === null ? "all" : "own",
        balance: 100,
        total_commission: 150,
        total_deduction: 50,
        total_payment: 0,
        pending_payment: 25,
        available_balance: 75,
        pending_request_count: 1,
      })),
      listStaffBalances: vi.fn(async () => [
        { user_public_id: "usr_staff", first_name: "Ayse", last_name: "Yilmaz", is_online: true, balance: 100, pending_payment: 25, pending_request_count: 1 },
      ]),
      listMovements: vi.fn(async () => ({ data: [], total: 0 })),
      listPaymentRequests: vi.fn(async () => ({ data: [], total: 0 })),
      findUserIdByPublicId: vi.fn(async () => ({ id: 22, first_name: "Ayse", last_name: "Yilmaz" })),
      createPaymentRequest: vi.fn(async () => ({
        request: { public_id: "pay_1", amount: 25, status: "pending" },
        replayed: false,
      })),
      processPaymentRequest: vi.fn(async (input: { decision: string }) => ({
        request: { public_id: "pay_1", amount: 25, status: input.decision },
        message: input.decision === "approved" ? "Ödeme yapıldı" : "İstek reddedildi",
      })),
      resetBalance: vi.fn(async () => ({ previous_balance: 100, message: "Bakiye sıfırlandı" })),
      listStaffOrders: vi.fn(async () => []),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return routeMocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/balances/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/balances/repository.js")>();
  return {
    ...actual,
    BalanceRepository: vi.fn(function BalanceRepository() {
      return routeMocks.balanceRepository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "balance-ledger-route-test-secret",
  encryptionKey: "balance-ledger-encryption-key-0",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const fakeDb = {
  selectFrom: () => ({
    select: () => ({ where: () => ({ executeTakeFirst: async () => ({ first_name: "Admin" }) }) }),
  }),
} as unknown as AppDatabase;

async function token(role = "calisan") {
  routeMocks.setRole(role);
  return signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
}

async function call(method: string, path: string, role = "calisan", body?: unknown) {
  return createApp({ config, db: fakeDb }).request(path, {
    method,
    headers: { authorization: `Bearer ${await token(role)}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function state(overrides: Partial<OrderBalanceState> = {}): OrderBalanceState {
  return {
    orderPublicId: "ord_1",
    orderNumber: "SP-1",
    status: "pending",
    creatorUserId: 10,
    itemNames: ["Kuluçka Makinesi 96'lık"],
    existingMovements: [],
    commissionAmountCents: 5000,
    actorRole: "calisan",
    ...overrides,
  };
}

function applied(current: ExistingOrderMovement[], next: OrderBalanceState) {
  const plan = planOrderBalanceMovements({ ...next, existingMovements: current });
  return [...current, ...plan.map((movement) => ({ kind: movement.kind, amount_cents: movement.amount_cents }))];
}

describe("balance ledger rules", () => {
  it("credits the fixed commission once for incubator orders only", () => {
    expect(planOrderBalanceMovements(state())).toEqual([
      expect.objectContaining({ kind: "commission", amount_cents: 5000, idempotency_key: "order:ord_1:commission", description: "Sipariş komisyonu: SP-1" }),
    ]);
    expect(planOrderBalanceMovements(state({ itemNames: ["Yem 5kg"] }))).toEqual([]);
    expect(planOrderBalanceMovements(state({ creatorUserId: null }))).toEqual([]);
    expect(planOrderBalanceMovements(state({ existingMovements: [{ kind: "commission", amount_cents: 5000 }] }))).toEqual([]);
  });

  it("deducts on cancellation, rolls back on revert and is idempotent across repeats", () => {
    let ledger = applied([], state());
    ledger = applied(ledger, state({ status: "cancelled" }));
    expect(ledger.at(-1)).toEqual({ kind: "cancellation", amount_cents: -5000 });
    // repeated cancellation / cancelled→returned does not double-deduct
    expect(planOrderBalanceMovements(state({ status: "cancelled", existingMovements: ledger }))).toEqual([]);
    expect(planOrderBalanceMovements(state({ status: "returned", existingMovements: ledger }))).toEqual([]);
    ledger = applied(ledger, state({ status: "confirmed" }));
    expect(ledger.at(-1)).toEqual({ kind: "rollback", amount_cents: 5000 });
    expect(planOrderBalanceMovements(state({ status: "confirmed", existingMovements: ledger }))).toEqual([]);
    ledger = applied(ledger, state({ status: "returned" }));
    expect(ledger.at(-1)).toEqual({ kind: "return", amount_cents: -5000 });
    expect(ledger.reduce((sum, row) => sum + row.amount_cents, 0)).toBe(0);
    const keys = planOrderBalanceMovements(state({ status: "delivered", existingMovements: ledger })).map((row) => row.idempotency_key);
    expect(keys).toEqual(["order:ord_1:deduction:4"]);
  });

  it("skips deductions by cargo operators and never credits a rollback without a deduction", () => {
    const ledger = applied([], state());
    expect(planOrderBalanceMovements(state({ status: "cancelled", actorRole: "kargo_operatoru", existingMovements: ledger }))).toEqual([]);
    expect(planOrderBalanceMovements(state({ status: "confirmed", existingMovements: ledger }))).toEqual([]);
  });

  it("validates payment request amount against balance minus pending requests", () => {
    expect(checkPaymentRequestAmount({ amountCents: 0, balanceCents: 1000, pendingCents: 0 })).toMatchObject({ ok: false, code: "invalid_amount" });
    expect(checkPaymentRequestAmount({ amountCents: 900, balanceCents: 1000, pendingCents: 200 })).toMatchObject({ ok: false, code: "insufficient_balance" });
    expect(checkPaymentRequestAmount({ amountCents: 800, balanceCents: 1000, pendingCents: 200 })).toEqual({ ok: true });
  });
});

describe("balance routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes summary to own ledger for staff and all staff for admin", async () => {
    const staff = await call("GET", "/api/balances/summary", "calisan");
    expect(staff.status).toBe(200);
    expect(routeMocks.balanceRepository.getSummary).toHaveBeenLastCalledWith(10);
    await expect(staff.json()).resolves.toMatchObject({ scope: "own", available_balance: 75 });
    const admin = await call("GET", "/api/balances/summary", "admin");
    expect(admin.status).toBe(200);
    expect(routeMocks.balanceRepository.getSummary).toHaveBeenLastCalledWith(null);
  });

  it("restricts staff lists, approvals and resets to admin", async () => {
    expect((await call("GET", "/api/balances/staff", "calisan")).status).toBe(403);
    expect((await call("POST", "/api/balances/payment-requests/pay_1/approve", "calisan", {})).status).toBe(403);
    expect((await call("POST", "/api/balances/staff/usr_staff/reset", "calisan", {})).status).toBe(403);
    expect((await call("GET", "/api/balances/movements", "kargo_operatoru")).status).toBe(403);
    const staffList = await call("GET", "/api/balances/staff", "admin");
    await expect(staffList.json()).resolves.toMatchObject({ data: [{ user_public_id: "usr_staff", balance: 100 }] });
    const approve = await call("POST", "/api/balances/payment-requests/pay_1/approve", "admin", {});
    await expect(approve.json()).resolves.toMatchObject({ message: "Ödeme yapıldı", request: { status: "approved" } });
    const reject = await call("POST", "/api/balances/payment-requests/pay_1/reject", "admin", {});
    await expect(reject.json()).resolves.toMatchObject({ message: "İstek reddedildi" });
    const reset = await call("POST", "/api/balances/staff/usr_staff/reset", "admin", {});
    expect(reset.status).toBe(200);
    expect(routeMocks.balanceRepository.resetBalance).toHaveBeenCalledWith({ userPublicId: "usr_staff", adminUserId: 10, adminName: "Admin" });
  });

  it("lists only own movements for staff even when another user is requested", async () => {
    await call("GET", "/api/balances/movements?user_public_id=usr_other", "calisan");
    expect(routeMocks.balanceRepository.listMovements).toHaveBeenLastCalledWith({ userId: 10, limit: 200, offset: 0 });
    await call("GET", "/api/balances/movements?user_public_id=usr_other", "admin");
    expect(routeMocks.balanceRepository.listMovements).toHaveBeenLastCalledWith({ userId: 22, limit: 200, offset: 0 });
  });

  it("creates self payment requests and maps rule errors", async () => {
    const created = await call("POST", "/api/balances/payment-requests", "calisan", { amount: "25.00", idempotency_key: "k1" });
    expect(created.status).toBe(201);
    expect(routeMocks.balanceRepository.createPaymentRequest).toHaveBeenCalledWith({ userId: 10, amountCents: 2500, idempotencyKey: "k1" });
    const invalid = await call("POST", "/api/balances/payment-requests", "calisan", { amount: "abc", idempotency_key: "k2" });
    expect(invalid.status).toBe(400);
    const { BalancePaymentRequestError } = await import("../src/balances/repository.js");
    routeMocks.balanceRepository.createPaymentRequest.mockRejectedValueOnce(
      new BalancePaymentRequestError("insufficient_balance", "İstenen tutar kullanılabilir bakiyenizden fazla olamaz"),
    );
    const tooMuch = await call("POST", "/api/balances/payment-requests", "calisan", { amount: "999", idempotency_key: "k3" });
    expect(tooMuch.status).toBe(409);
    routeMocks.balanceRepository.processPaymentRequest.mockRejectedValueOnce(
      new BalancePaymentRequestError("already_processed", "Bu istek zaten işlenmiş"),
    );
    const again = await call("POST", "/api/balances/payment-requests/pay_1/approve", "admin", {});
    expect(again.status).toBe(409);
    await expect(again.json()).resolves.toMatchObject({ error: { message: "Bu istek zaten işlenmiş" } });
  });
});
