import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CallLog } from "@garanti-kulucka/shared";
import { useAuth } from "@/app/auth";
import { useQuery } from "@/lib/use-query";
import { formatDateTime } from "@/lib/format";
import {
  DataList,
  ErrorState,
  Pagination,
  type Column,
} from "@/components/data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/layout/page-header";

export function CallLogsPage() {
  const { t } = useTranslation();
  return (
    <section data-testid="page-call-logs">
      <PageHeader
        title={t("callLogs.title")}
        description={t("callLogs.description")}
      />
      <CallLogsSection />
    </section>
  );
}
export function CallLogsSection({
  customerPublicId,
  orderPublicId,
}: {
  customerPublicId?: string;
  orderPublicId?: string;
}) {
  const { t, i18n } = useTranslation();
  const { api, user } = useAuth();
  const [search] = useSearchParams();
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  const [agent, setAgent] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [missed, setMissed] = useState(search.get("missed_only") === "true");
  const [page, setPage] = useState(1);
  const [audio, setAudio] = useState<{ id: string; url: string }>();
  const [audioError, setAudioError] = useState(false);
  const canView = ["owner", "admin", "calisan"].includes(user?.role ?? "");
  const manager = ["owner", "admin"].includes(user?.role ?? "");
  const query = {
    direction: direction || undefined,
    status: status || undefined,
    user: agent || undefined,
    date_from: from
      ? new Date(`${from}T00:00:00+03:00`).toISOString()
      : undefined,
    date_to: to ? new Date(`${to}T23:59:59+03:00`).toISOString() : undefined,
    customer_public_id: customerPublicId,
    order_public_id: orderPublicId,
    missed_only: missed ? "true" : undefined,
    limit: 25,
    offset: (page - 1) * 25,
  };
  const calls = useQuery(
    `call-logs:${JSON.stringify(query)}`,
    () => api.listCallLogs(query),
    { enabled: canView, refreshMs: 60000 },
  );
  const staff = useQuery("call-logs:staff", () => api.listUsers(), {
    enabled: manager,
  });
  if (!canView) return null;
  async function play(call: CallLog) {
    setAudioError(false);
    try {
      const result = await api.callRecording(call.public_id);
      setAudio({ id: call.public_id, url: result.download.presigned_url });
    } catch {
      setAudioError(true);
    }
  }
  const columns: Column<CallLog>[] = [
    {
      key: "number",
      header: t("callLogs.phone"),
      mobile: "title",
      cell: (r) => (
        <span className="break-all">
          {r.customer_number ?? r.callee ?? r.caller ?? "—"}
        </span>
      ),
    },
    {
      key: "direction",
      header: t("callLogs.direction"),
      mobile: "meta",
      cell: (r) => (
        <Badge>{r.direction ? t(`callLogs.${r.direction}`) : "—"}</Badge>
      ),
    },
    {
      key: "status",
      header: t("callLogs.status"),
      mobile: "badge",
      cell: (r) => (
        <Badge tone={r.status === "answered" ? "success" : "neutral"}>
          {r.status ? t(`callLogs.${r.status}`) : t("callLogs.pending")}
        </Badge>
      ),
    },
    {
      key: "user",
      header: t("callLogs.user"),
      mobile: "meta",
      cell: (r) => r.user_name || r.internal_number || "—",
    },
    {
      key: "time",
      header: t("callLogs.date"),
      mobile: "meta",
      cell: (r) => formatDateTime(r.initiated_at, i18n.language),
    },
    {
      key: "duration",
      header: t("callLogs.duration"),
      mobile: "meta",
      cell: (r) =>
        `${Math.floor((r.talk_seconds ?? 0) / 60)}:${String((r.talk_seconds ?? 0) % 60).padStart(2, "0")}`,
    },
    {
      key: "recording",
      header: t("callLogs.recording"),
      mobile: "meta",
      cell: (r) =>
        r.has_recording ? (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => void play(r)}
          >
            {t("callLogs.play")}
          </Button>
        ) : (
          "—"
        ),
    },
  ];
  const select = (
    label: string,
    value: string,
    values: string[],
    change: (v: string) => void,
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select
        aria-label={label}
        className="h-11 rounded-md border bg-background px-3"
        value={value}
        onChange={(e) => {
          change(e.target.value);
          setPage(1);
        }}
      >
        <option value="">{t("callLogs.all")}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {t(`callLogs.${v}`, { defaultValue: v })}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Card className="min-w-0 space-y-4 p-4" data-testid="call-logs-section">
      <h2 className="font-semibold">{t("callLogs.title")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {select(
          t("callLogs.direction"),
          direction,
          ["inbound", "outbound", "internal"],
          setDirection,
        )}
        {select(
          t("callLogs.status"),
          status,
          ["answered", "missed", "busy", "timeout", "failed", "cancelled"],
          setStatus,
        )}
        <label className="text-sm">
          {t("callLogs.from")}
          <Input
            type="date"
            value={from}
            className="h-11"
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="text-sm">
          {t("callLogs.to")}
          <Input
            type="date"
            value={to}
            className="h-11"
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {manager && (
          <label className="flex flex-col gap-1 text-sm">
            {t("callLogs.user")}
            <select
              className="h-11 rounded-md border bg-background px-3"
              aria-label={t("callLogs.user")}
              value={agent}
              onChange={(e) => {
                setAgent(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("callLogs.all")}</option>
              {staff.data?.data.map((u) => (
                <option key={u.public_id} value={u.public_id}>
                  {u.first_name} {u.last_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            checked={missed}
            onCheckedChange={(next) => {
              setMissed(next === true);
              setPage(1);
            }}
            data-testid="call-logs-missed-only"
          />
          {t("callLogs.missedOnly")}
        </label>
      </div>
      {audio && (
        <audio
          key={audio.id}
          controls
          autoPlay
          src={audio.url}
          className="h-11 w-full max-w-full"
          aria-label={t("callLogs.recording")}
        />
      )}
      {audioError && (
        <p role="alert" className="text-sm text-destructive">
          {t("callLogs.recordingError")}
        </p>
      )}
      {calls.error ? (
        <ErrorState onRetry={calls.reload} />
      ) : (
        <>
          <DataList
            rows={calls.data?.data ?? []}
            columns={columns}
            rowKey={(r) => r.public_id}
            loading={calls.loading}
            testId="call-logs-list"
          />
          <Pagination
            page={page}
            pages={Math.max(1, Math.ceil((calls.data?.total_count ?? 0) / 25))}
            total={calls.data?.total_count ?? 0}
            onPage={setPage}
          />
        </>
      )}
    </Card>
  );
}
