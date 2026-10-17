import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { CustomerSummary } from "@garanti-kulucka/shared";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useQuery } from "@/lib/use-query";

export function CustomerMergeDialog({ source, onClose }: { source: CustomerSummary; onClose: () => void }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [target, setTarget] = useState<Pick<CustomerSummary, "public_id" | "full_name">>();
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const candidates = useQuery(`merge-candidates:${source.public_id}`, () => api.customerMergeCandidates(source.public_id));
  const results = useQuery(`merge-search:${debouncedSearch}`, () => api.listCustomers(20, debouncedSearch), { enabled: Boolean(debouncedSearch) });
  const preview = useQuery(`merge-preview:${source.public_id}`, () => api.customerMergePreview(source.public_id));
  const rows = (debouncedSearch ? results.data?.data : candidates.data?.data)?.filter((row) => row.public_id !== source.public_id) ?? [];
  const listError = debouncedSearch ? results.error : candidates.error;
  const loading = debouncedSearch ? results.loading : candidates.loading;
  const countLabels = {
    orders: "orders", conversations: "conversations", shipments: "shipments", customer_addresses: "addresses",
    customer_external_identities: "identities", accounting_contacts: "contacts", call_logs: "calls",
    sms_messages: "sms", vapi_calls: "vapi", vapi_call_queue: "queue", notes: "notes",
  } as const;

  async function merge() {
    if (!target || !confirmed || !preview.data || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.mergeCustomers(target.public_id, { source_public_id: source.public_id });
      navigate(`/musteriler/${encodeURIComponent(result.target_public_id)}`, { replace: true });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  }

  return <AlertDialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <AlertDialogContent className="max-h-[90dvh] overflow-y-auto" data-testid="customer-merge-dialog">
      <AlertDialogTitle>{t("customerMerge.title")}</AlertDialogTitle>
      <AlertDialogDescription>{t("customerMerge.description", { name: source.full_name })}</AlertDialogDescription>
      <Input aria-label={t("customerMerge.search")} placeholder={t("customerMerge.search")} value={search}
        disabled={saving} onChange={(event) => setSearch(event.target.value)} />
      <div className="flex max-h-48 flex-col gap-2 overflow-y-auto" aria-busy={loading}>
        {loading && <p role="status">{t("chat.loading")}</p>}
        {Boolean(listError) && <p role="alert">{t("customerMerge.loadFailed")}</p>}
        {!loading && rows.length === 0 && <p>{t("customerMerge.noCandidates")}</p>}
        {rows.map((row) => <Button key={row.public_id} variant={target?.public_id === row.public_id ? "default" : "outline"}
          className="h-auto min-h-12 flex-col items-start whitespace-normal text-left" disabled={saving}
          aria-pressed={target?.public_id === row.public_id} data-testid="merge-candidate"
          onClick={() => { setTarget(row); setConfirmed(false); }}>
          <span>{row.full_name}</span><span className="text-xs">{[row.phone, row.email].filter(Boolean).join(" · ")}</span>
          {"orders_count" in row && <span className="text-xs">{t("customerMerge.candidateCounts", { orders: row.orders_count, conversations: row.conversations_count })}</span>}
        </Button>)}
      </div>
      <div className="rounded-md border p-3 text-sm" data-testid="merge-preview">
        <p className="font-medium">{t("customerMerge.preview")}</p>
        {preview.loading && <p>{t("chat.loading")}</p>}
        {Boolean(preview.error) && <p role="alert">{t("customerMerge.loadFailed")}</p>}
        {preview.data && <dl className="mt-2 grid grid-cols-2 gap-1">{Object.entries(preview.data.counts).map(([key, count]) => <div className="contents" key={key}>
          <dt>{key in countLabels ? t(`customerMerge.${countLabels[key as keyof typeof countLabels]}`) : key}</dt><dd className="text-right tabular-nums">{count}</dd>
        </div>)}</dl>}
      </div>
      {target && <label className="flex min-h-11 items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-5 shrink-0" checked={confirmed} disabled={saving} onChange={(event) => setConfirmed(event.target.checked)} data-testid="merge-confirm" />
        <span>{t("customerMerge.confirm", { source: source.full_name, target: target.full_name })}</span>
      </label>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <AlertDialogCancel disabled={saving}>{t("customerDetail.cancel")}</AlertDialogCancel>
        <Button disabled={!target || !confirmed || !preview.data || Boolean(preview.error) || saving} onClick={() => void merge()} data-testid="merge-submit">
          {saving ? t("common.saving") : t("customerMerge.title")}
        </Button>
      </div>
    </AlertDialogContent>
  </AlertDialog>;
}
