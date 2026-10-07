import { RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, type Column } from "@/components/data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/layout/page-header";
import { formatDateTime } from "@/lib/format";
import { pageCount, pageSize } from "@/lib/list-params";
import { dataDeletionStatuses, type DataDeletionRequest, type DataDeletionStatus } from "@/lib/privacy";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { errorText, FeedbackLine, NativeSelect, type Feedback } from "./accounting-shared";

const tone: Record<DataDeletionStatus, "warning" | "info" | "success" | "danger"> = { pending: "warning", in_progress: "info", completed: "success", rejected: "danger" };

/** /veri-silme-talepleri — admin review of legacy `veri_silme_talepleri` (`GET/PATCH /admin/data-deletion-requests`). */
export function DataDeletionRequestsPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [status, setStatus] = useState<DataDeletionStatus | "">("");
  const [page, setPage] = useState(1);
  const list = useQuery(`privacy:requests:${status}:${page}`, () => api.listDataDeletionRequests({ limit: pageSize, offset: (page - 1) * pageSize, ...(status ? { status } : {}) }));
  const [rows, setRows] = useState<DataDeletionRequest[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { status: DataDeletionStatus; note: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (list.data) {
      setRows(list.data.data);
      setDrafts({});
    }
  }, [list.data]);

  const draftFor = (row: DataDeletionRequest) => drafts[row.public_id] ?? { status: row.status, note: row.resolution_note ?? "" };
  const setDraft = (row: DataDeletionRequest, change: Partial<{ status: DataDeletionStatus; note: string }>) => setDrafts((prev) => ({ ...prev, [row.public_id]: { ...draftFor(row), ...change } }));

  async function save(row: DataDeletionRequest) {
    const draft = draftFor(row);
    setSaving(row.public_id);
    setFeedback(null);
    try {
      const { request } = await api.updateDataDeletionRequest(row.public_id, { status: draft.status, note: draft.note.trim() || null });
      setRows((prev) => prev.map((item) => (item.public_id === row.public_id ? request : item)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.public_id];
        return next;
      });
      setFeedback({ tone: "success", text: t("dataDeletion.adminUpdated", { reference: row.reference }) });
    } catch (error) {
      setFeedback({ tone: "error", text: t("dataDeletion.adminUpdateFailed", { error: errorText(error) }) });
    } finally {
      setSaving(null);
    }
  }

  const columns: Column<DataDeletionRequest>[] = [
    {
      key: "person",
      header: t("dataDeletion.colPerson"),
      mobile: "title",
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block font-medium">{row.full_name ?? row.reference}</span>
          {[row.email, row.phone, row.instagram_username && `@${row.instagram_username}`, row.messenger_psid && `PSID ${row.messenger_psid}`]
            .filter(Boolean)
            .map((value) => (
              <span key={String(value)} className="block break-all text-xs text-muted-foreground">
                {value}
              </span>
            ))}
          {row.description && <span className="block text-xs text-muted-foreground">“{row.description}”</span>}
        </span>
      ),
    },
    { key: "status", header: t("dataDeletion.colStatus"), mobile: "badge", cell: (row) => <Badge tone={tone[row.status]}>{t(`dataDeletion.status_${row.status}`)}</Badge> },
    { key: "reference", header: t("dataDeletion.colReference"), cell: (row) => <span className="font-mono text-xs">{row.reference}</span> },
    { key: "source", header: t("dataDeletion.colSource"), cell: (row) => (row.source === "facebook" ? t("dataDeletion.sourceFacebook") : t("dataDeletion.sourceForm")) },
    {
      key: "date",
      header: t("dataDeletion.colDate"),
      cell: (row) => (
        <span>
          {formatDateTime(row.requested_at, i18n.language)}
          {row.resolved_at && <span className="block text-xs text-muted-foreground">{formatDateTime(row.resolved_at, i18n.language)}</span>}
        </span>
      ),
    },
    {
      key: "action",
      header: t("dataDeletion.colAction"),
      cell: (row) => {
        const draft = draftFor(row);
        const dirty = draft.status !== row.status || draft.note !== (row.resolution_note ?? "");
        return (
          <span className="flex w-full min-w-0 flex-col gap-2 md:min-w-64" data-testid={`deletion-row-${row.reference}`}>
            <NativeSelect aria-label={t("dataDeletion.colStatus")} value={draft.status} onChange={(event) => setDraft(row, { status: event.target.value as DataDeletionStatus })} data-testid="deletion-row-status">
              {dataDeletionStatuses.map((value) => (
                <option key={value} value={value}>
                  {t(`dataDeletion.status_${value}`)}
                </option>
              ))}
            </NativeSelect>
            <Input className="h-11 md:h-9" aria-label={t("dataDeletion.note")} placeholder={t("dataDeletion.notePlaceholder")} maxLength={2000} value={draft.note} onChange={(event) => setDraft(row, { note: event.target.value })} data-testid="deletion-row-note" />
            <Button className="min-h-11 md:min-h-9" disabled={!dirty || saving === row.public_id} onClick={() => void save(row)} data-testid="deletion-row-save">
              <Save className="size-4" aria-hidden="true" />
              {t("dataDeletion.save")}
            </Button>
          </span>
        );
      },
    },
  ];
  const total = list.data?.total_count ?? 0;

  return (
    <section data-testid="page-data-deletion-requests">
      <PageHeader
        title={t("dataDeletion.adminTitle")}
        description={t("dataDeletion.adminSubtitle")}
        actions={
          <Button variant="outline" className="min-h-11" onClick={list.reload} disabled={list.loading}>
            <RefreshCw className={cn("size-4", list.loading && "animate-spin")} aria-hidden="true" />
            {t("dataDeletion.refresh")}
          </Button>
        }
      />
      <div className="mb-3 flex flex-col gap-2">
        <NativeSelect
          className="sm:w-56"
          aria-label={t("dataDeletion.colStatus")}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as DataDeletionStatus | "");
            setPage(1);
          }}
          data-testid="deletion-filter"
        >
          <option value="">{t("dataDeletion.adminAll")}</option>
          {dataDeletionStatuses.map((value) => (
            <option key={value} value={value}>
              {t(`dataDeletion.status_${value}`)}
            </option>
          ))}
        </NativeSelect>
        <FeedbackLine feedback={feedback} testId="deletion-feedback" />
      </div>
      {list.error && !list.data ? (
        <ErrorState onRetry={list.reload} />
      ) : (
        <>
          <DataList testId="deletion-requests" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={list.loading} />
          {total > pageSize && <Pagination page={page} pages={pageCount(total)} total={total} onPage={setPage} />}
        </>
      )}
    </section>
  );
}
