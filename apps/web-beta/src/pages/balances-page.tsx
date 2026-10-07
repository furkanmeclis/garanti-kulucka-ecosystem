import { Check, RotateCcw, Send, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { panelRoleOf } from "@garanti-kulucka/shared";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, type Column } from "@/components/data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import type { BalanceMovement, BalanceMovementKind, BalancePaymentRequest, BalancePaymentRequestStatus, StaffBalance } from "@/lib/inventory-balances";
import { formatDateTime, formatMoney } from "@/lib/format";
import { pageCount, pageSize } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { errorText, FeedbackLine, Field, idempotencyKey, type Feedback } from "./accounting-shared";

const movementLabel: Record<BalanceMovementKind, "movementCommission" | "movementCancellation" | "movementReturn" | "movementPayment" | "movementAdjustment" | "movementRollback"> = {
  commission: "movementCommission",
  cancellation: "movementCancellation",
  return: "movementReturn",
  payment: "movementPayment",
  adjustment: "movementAdjustment",
  rollback: "movementRollback",
};
const requestLabel: Record<BalancePaymentRequestStatus, "paymentPending" | "paymentSeen" | "paymentApproved" | "paymentRejected"> = {
  pending: "paymentPending",
  seen: "paymentSeen",
  approved: "paymentApproved",
  rejected: "paymentRejected",
};

/** /bakiye — legacy BakiyePage: managers see every staff balance and process payment requests; staff see their own and ask for payment. */
export function BalancesPage() {
  const { t, i18n } = useTranslation();
  const { api, user } = useAuth();
  const manager = panelRoleOf(user?.role) === "manager";
  const [tab, setTab] = useState<"movements" | "requests">("movements");
  const [page, setPage] = useState(1);
  const [staffDetail, setStaffDetail] = useState<StaffBalance | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const summary = useQuery("balances:summary", () => api.balanceSummary());
  const staff = useQuery("balances:staff", () => api.listStaffBalances(), { enabled: manager });
  const offset = (page - 1) * pageSize;
  const movements = useQuery(`balances:movements:${page}`, () => api.listBalanceMovements({ limit: pageSize, offset }), { enabled: tab === "movements" });
  const requests = useQuery(`balances:requests:${page}`, () => api.listPaymentRequests({ limit: pageSize, offset }), { enabled: tab === "requests" });
  const money = (value: number) => formatMoney(value, "TRY", i18n.language);

  const reloadAll = () => {
    summary.reload();
    staff.reload();
    movements.reload();
    requests.reload();
  };

  async function reset(row: StaffBalance) {
    const name = `${row.first_name} ${row.last_name}`.trim();
    if (!window.confirm(t("balances.confirmReset", { name }))) return;
    setBusy(row.user_public_id);
    setFeedback(null);
    try {
      const result = await api.resetStaffBalance(row.user_public_id);
      setFeedback({ tone: "success", text: t("balances.resetDone", { name, amount: result.previous_balance.toFixed(2) }) });
      reloadAll();
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("balances.operationFailed")}: ${errorText(error)}` });
    } finally {
      setBusy(null);
    }
  }

  async function decide(request: BalancePaymentRequest, decision: "approve" | "reject") {
    setBusy(request.public_id);
    setFeedback(null);
    try {
      const result = await api.processPaymentRequest(request.public_id, decision);
      setFeedback({ tone: "success", text: result.message });
      reloadAll();
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("balances.operationFailed")}: ${errorText(error)}` });
    } finally {
      setBusy(null);
    }
  }

  const s = summary.data;
  const cards = s
    ? ([
        ["currentBalance", s.balance],
        ["totalCommission", s.total_commission],
        ["totalDeduction", s.total_deduction],
        ["paid", s.total_payment],
      ] as const)
    : [];

  const movementColumns: Column<BalanceMovement>[] = [
    { key: "kind", header: t("balances.columnType"), mobile: "title", cell: (row) => t(`balances.${movementLabel[row.kind]}`) },
    {
      key: "amount",
      header: t("balances.columnAmount"),
      mobile: "badge",
      cell: (row) => <span className={cn("font-medium", row.amount < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300")}>{money(row.amount)}</span>,
    },
    { key: "order", header: t("balances.columnOrder"), cell: (row) => row.order_number ?? t("common.none") },
    ...(manager ? [{ key: "staff", header: t("balances.columnStaff"), cell: (row: BalanceMovement) => row.user_full_name ?? t("common.none") }] : []),
    { key: "after", header: t("balances.columnBalanceAfter"), cell: (row) => money(row.balance_after) },
    { key: "date", header: t("balances.columnDate"), cell: (row) => formatDateTime(row.created_at, i18n.language) },
  ];
  const requestColumns: Column<BalancePaymentRequest>[] = [
    { key: "amount", header: t("balances.columnAmount"), mobile: "title", cell: (row) => <span className="font-medium">{money(row.amount)}</span> },
    {
      key: "status",
      header: t("balances.columnStatus"),
      mobile: "badge",
      cell: (row) => <Badge tone={row.status === "approved" ? "success" : row.status === "rejected" ? "danger" : "warning"}>{t(`balances.${requestLabel[row.status]}`)}</Badge>,
    },
    ...(manager ? [{ key: "staff", header: t("balances.columnStaff"), cell: (row: BalancePaymentRequest) => row.user_full_name ?? t("common.none") }] : []),
    { key: "date", header: t("balances.columnDate"), cell: (row) => formatDateTime(row.created_at, i18n.language) },
    ...(manager
      ? [
          {
            key: "action",
            header: t("balances.columnAction"),
            className: "max-w-none overflow-visible",
            cell: (row: BalancePaymentRequest) =>
              row.status === "pending" || row.status === "seen" ? (
                <div className="flex flex-wrap justify-end gap-1.5 md:justify-start">
                  <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={busy !== null} onClick={() => void decide(row, "approve")} data-testid="request-approve">
                    <Check className="size-4" aria-hidden="true" />
                    {t("balances.approve")}
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-11 text-destructive md:min-h-8" disabled={busy !== null} onClick={() => void decide(row, "reject")} data-testid="request-reject">
                    <X className="size-4" aria-hidden="true" />
                    {t("balances.reject")}
                  </Button>
                </div>
              ) : (
                t("common.none")
              ),
          },
        ]
      : []),
  ];
  const activeList = tab === "movements" ? movements : requests;
  const total = activeList.data?.total ?? 0;

  return (
    <section data-testid="page-balances">
      <PageHeader
        title={manager ? t("balances.adminTitle") : t("balances.staffTitle")}
        description={manager ? t("balances.adminSubtitle") : t("balances.staffSubtitle")}
        actions={
          !manager && (
            <Button className="min-h-11" onClick={() => setRequesting(true)} data-testid="balance-request">
              <Send className="size-4" aria-hidden="true" />
              {t("balances.requestPayment")}
            </Button>
          )
        }
      />
      {summary.error && !s ? (
        <ErrorState onRetry={summary.reload} />
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="balance-cards">
          {cards.map(([label, value]) => (
            <Card key={label} className="min-w-0 p-4">
              <p className="truncate text-sm text-muted-foreground">{t(`balances.${label}`)}</p>
              <p className="truncate text-lg font-semibold sm:text-xl">{money(value)}</p>
            </Card>
          ))}
        </div>
      )}
      <div className="mb-3">
        <FeedbackLine feedback={feedback} testId="balances-feedback" />
      </div>
      {manager && (
        <Card className="mb-4 p-4" data-testid="staff-balances">
          <h2 className="mb-2 font-semibold">{t("balances.staffBalances")}</h2>
          {(staff.data?.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("balances.noStaff")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {(staff.data?.data ?? []).map((row) => (
                <li key={row.user_public_id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="staff-balance-row">
                  <span className="min-w-0">
                    <span className="font-medium">{`${row.first_name} ${row.last_name}`.trim()}</span>
                    {row.pending_request_count > 0 && (
                      <Badge tone="warning" className="ml-2">
                        {row.pending_request_count} {t("balances.pendingBadge")}
                      </Badge>
                    )}
                    <span className="block text-sm text-muted-foreground">{money(row.balance)}</span>
                  </span>
                  <span className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => setStaffDetail(row)} data-testid="staff-detail">
                      {t("balances.detail")}
                    </Button>
                    <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={busy !== null || row.balance === 0} onClick={() => void reset(row)} data-testid="staff-reset">
                      <RotateCcw className="size-4" aria-hidden="true" />
                      {busy === row.user_public_id ? t("balances.resetting") : t("balances.resetBalance")}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <div className="mb-3 flex gap-1 border-b" role="tablist">
        {(["movements", "requests"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={cn("min-h-11 border-b-2 px-3 text-sm font-medium", tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
            data-testid={`balance-tab-${key}`}
          >
            {key === "movements" ? t("balances.tabMovements") : t("balances.tabPaymentRequests")}
          </button>
        ))}
      </div>
      {activeList.error && !activeList.data ? (
        <ErrorState onRetry={activeList.reload} />
      ) : tab === "movements" ? (
        <DataList testId="balance-movements" rows={movements.data?.data ?? []} columns={movementColumns} rowKey={(row) => row.public_id} loading={movements.loading} />
      ) : (
        <DataList testId="balance-requests" rows={requests.data?.data ?? []} columns={requestColumns} rowKey={(row) => row.public_id} loading={requests.loading} />
      )}
      {total > pageSize && <Pagination page={page} pages={pageCount(total)} total={total} onPage={setPage} />}
      <StaffOrdersSheet staff={staffDetail} onClose={() => setStaffDetail(null)} />
      <PaymentRequestSheet
        open={requesting}
        available={s?.available_balance ?? 0}
        pending={s?.pending_payment ?? 0}
        onClose={() => setRequesting(false)}
        onSent={(message) => {
          setRequesting(false);
          setFeedback({ tone: "success", text: message });
          setTab("requests");
          reloadAll();
        }}
      />
    </section>
  );
}

function StaffOrdersSheet({ staff, onClose }: { staff: StaffBalance | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const orders = useQuery(`balances:staff-orders:${staff?.user_public_id ?? ""}`, () => api.listStaffOrders(staff!.user_public_id), { enabled: staff !== null });
  const name = staff ? `${staff.first_name} ${staff.last_name}`.trim() : "";
  return (
    <Sheet open={staff !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("balances.close")} className="w-[min(32rem,100vw)] overflow-y-auto p-0" data-testid="staff-orders">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("balances.staffOrdersTitle", { name })}</SheetTitle>
          <SheetDescription>
            {t("balances.balanceLabel")}
            {formatMoney(staff?.balance ?? 0, "TRY", i18n.language)}
          </SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col divide-y px-4 pb-4 text-sm">
          {orders.data && orders.data.data.length === 0 && <li className="py-2 text-muted-foreground">{t("balances.noStaffOrders")}</li>}
          {(orders.data?.data ?? []).map((order) => (
            <li key={order.public_id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium">{order.order_number}</span>
                <span className="block truncate text-muted-foreground">{order.customer_full_name ?? t("common.none")}</span>
              </span>
              <span className="shrink-0">{formatMoney(order.total_amount, order.currency, i18n.language)}</span>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

function PaymentRequestSheet({ open, available, pending, onClose, onSent }: { open: boolean; available: number; pending: number; onClose: () => void; onSent: (message: string) => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(amount.replace(",", "."));
    if (!(value > 0) || value > available) return setFeedback({ tone: "error", text: t("balances.invalidAmount") });
    setSending(true);
    setFeedback(null);
    try {
      const result = await api.createPaymentRequest({ amount: value.toFixed(2), idempotency_key: idempotencyKey("odeme_istegi") });
      setAmount("");
      onSent(result.message || t("balances.paymentRequestSent"));
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("balances.paymentRequestError")}: ${errorText(error)}` });
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" closeLabel={t("balances.close")} className="mx-auto w-full max-w-lg p-0" data-testid="payment-request-sheet">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("balances.requestPayment")}</SheetTitle>
          <SheetDescription>
            {t("balances.availableBalance")}: {formatMoney(available, "TRY", i18n.language)} {pending > 0 ? t("balances.pendingPaymentNote", { amount: pending.toFixed(2) }) : ""}
          </SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onSubmit={(event) => void submit(event)}>
          <Field label={t("balances.requestedAmount")}>
            <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-11" data-testid="payment-request-amount" />
          </Field>
          <FeedbackLine feedback={feedback} testId="payment-request-feedback" />
          <Button type="submit" className="min-h-11" disabled={sending} data-testid="payment-request-submit">
            {sending ? t("balances.sending") : t("balances.sendPaymentRequest")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
