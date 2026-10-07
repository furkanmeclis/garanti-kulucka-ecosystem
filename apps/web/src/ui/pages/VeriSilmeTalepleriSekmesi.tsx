import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Trash2 } from "lucide-react";
import type { BackendHttpClient } from "../../api/http-client.js";
import { MesajBanner, hataMetni, tarihSaatFormatla, useMesaj } from "./AyarlarShared.js";
import { useLanguage, useT } from "../i18n/index.js";
import { dataDeletionMessages } from "../i18n/messages/dataDeletion.js";

type DeletionStatus = "pending" | "in_progress" | "completed" | "rejected";
const statuses: DeletionStatus[] = ["pending", "in_progress", "completed", "rejected"];
const pillTone: Record<DeletionStatus, string> = { pending: "amber", in_progress: "blue", completed: "green", rejected: "red" };

export interface DataDeletionRequest {
  public_id: string;
  reference: string;
  source: "form" | "facebook";
  full_name: string | null;
  email: string | null;
  phone: string | null;
  instagram_username: string | null;
  messenger_psid: string | null;
  description: string | null;
  status: DeletionStatus;
  resolution_note: string | null;
  requested_at: string;
  resolved_at: string | null;
  created_at: string;
}

/** Admin review of legacy `veri_silme_talepleri` (`GET/PATCH /admin/data-deletion-requests`). */
export function VeriSilmeTalepleriSekmesi({ http }: { http: BackendHttpClient }) {
  const t = useT(dataDeletionMessages);
  const { language } = useLanguage();
  const { mesaj, mesajGoster } = useMesaj();
  const [filter, setFilter] = useState<DeletionStatus | "">("");
  const [rows, setRows] = useState<DataDeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, { status: DeletionStatus; note: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "100", ...(filter ? { status: filter } : {}) });
      const response = await http.request<{ data: DataDeletionRequest[] }>(`/admin/data-deletion-requests?${query.toString()}`);
      setRows(response.data);
      setDrafts({});
    } catch (error) {
      mesajGoster("hata", t("adminLoadFailed", { error: hataMetni(error) }));
    } finally {
      setLoading(false);
    }
  }, [http, filter, mesajGoster, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const draftFor = useMemo(() => (row: DataDeletionRequest) => drafts[row.public_id] ?? { status: row.status, note: row.resolution_note ?? "" }, [drafts]);

  async function save(row: DataDeletionRequest) {
    const draft = draftFor(row);
    setSaving(row.public_id);
    try {
      const { request } = await http.request<{ request: DataDeletionRequest }>(`/admin/data-deletion-requests/${encodeURIComponent(row.public_id)}`, {
        method: "PATCH",
        body: { status: draft.status, note: draft.note.trim() || null },
      });
      setRows((prev) => prev.map((item) => (item.public_id === row.public_id ? request : item)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.public_id];
        return next;
      });
      mesajGoster("basari", t("adminUpdated", { reference: row.reference }));
    } catch (error) {
      mesajGoster("hata", t("adminUpdateFailed", { error: hataMetni(error) }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="ayarlar-stack" data-testid="ayarlar-veri-silme">
      <div className="ayarlar-row-between">
        <div className="ayarlar-row">
          <Trash2 size={20} className="ayarlar-primary-text" />
          <div>
            <h2 className="ayarlar-h2">{t("adminTitle")}</h2>
            <p className="ayarlar-muted">{t("adminSubtitle")}</p>
          </div>
        </div>
        <div className="ayarlar-row">
          <select aria-label={t("colStatus")} value={filter} onChange={(event) => setFilter(event.target.value as DeletionStatus | "")} data-testid="veri-silme-filter">
            <option value="">{t("adminAll")}</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {t(`status_${status}`)}
              </option>
            ))}
          </select>
          <button type="button" className="ayarlar-outline-btn" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "ayarlar-spin" : ""} />
            {t("refresh")}
          </button>
        </div>
      </div>
      <MesajBanner mesaj={mesaj} />
      <div className="ayarlar-table-card">
        {loading ? (
          <div className="ayarlar-empty">...</div>
        ) : rows.length === 0 ? (
          <div className="ayarlar-empty">
            <Trash2 size={40} />
            <p>{t("adminEmpty")}</p>
          </div>
        ) : (
          <div className="ayarlar-table-scroll">
            <table className="ayarlar-table">
              <thead>
                <tr>
                  <th>{t("colReference")}</th>
                  <th>{t("colPerson")}</th>
                  <th>{t("colSource")}</th>
                  <th>{t("colDate")}</th>
                  <th>{t("colStatus")}</th>
                  <th className="right">{t("colAction")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const draft = draftFor(row);
                  const dirty = draft.status !== row.status || draft.note !== (row.resolution_note ?? "");
                  return (
                    <tr key={row.public_id} data-testid={`veri-silme-${row.reference}`}>
                      <td className="ayarlar-nowrap">
                        <p className="ayarlar-strong">{row.reference}</p>
                        <span className={`ayarlar-pill ${pillTone[row.status]}`}>{t(`status_${row.status}`)}</span>
                      </td>
                      <td>
                        <p className="ayarlar-strong">{row.full_name ?? "-"}</p>
                        {[row.email, row.phone, row.instagram_username && `@${row.instagram_username}`, row.messenger_psid && `PSID ${row.messenger_psid}`]
                          .filter(Boolean)
                          .map((value) => (
                            <p key={String(value)} className="ayarlar-small">
                              {value}
                            </p>
                          ))}
                        {row.description && <p className="ayarlar-small">“{row.description}”</p>}
                      </td>
                      <td>{row.source === "facebook" ? t("sourceFacebook") : t("sourceForm")}</td>
                      <td className="ayarlar-nowrap">
                        {tarihSaatFormatla(row.requested_at, language)}
                        {row.resolved_at && <p className="ayarlar-small">{tarihSaatFormatla(row.resolved_at, language)}</p>}
                      </td>
                      <td>
                        <div className="ayarlar-inline-edit">
                          <select
                            aria-label={t("colStatus")}
                            value={draft.status}
                            onChange={(event) => setDrafts((prev) => ({ ...prev, [row.public_id]: { ...draft, status: event.target.value as DeletionStatus } }))}
                            data-testid="veri-silme-status"
                          >
                            {statuses.map((status) => (
                              <option key={status} value={status}>
                                {t(`status_${status}`)}
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label={t("note")}
                            placeholder={t("notePlaceholder")}
                            maxLength={2000}
                            value={draft.note}
                            onChange={(event) => setDrafts((prev) => ({ ...prev, [row.public_id]: { ...draft, note: event.target.value } }))}
                            data-testid="veri-silme-note"
                          />
                        </div>
                      </td>
                      <td className="right">
                        <button type="button" className="ayarlar-primary-btn small" disabled={!dirty || saving === row.public_id} onClick={() => void save(row)} data-testid="veri-silme-save">
                          <Save size={14} />
                          {t("save")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
