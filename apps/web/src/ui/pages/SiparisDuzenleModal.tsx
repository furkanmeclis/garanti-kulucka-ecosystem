import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { BackendHttpClient } from "../../api/http-client.js";
import { createOrderActionsClient, type EditableOrder } from "../../api/order-actions-client.js";
import { useT } from "../i18n/index.js";
import { orderEditMessages } from "../i18n/messages/orderEdit.js";
import { errorText } from "./MuhasebeShared.js";

type Line = { key: string; public_id: string | null; product_public_id: string | null; name: string; quantity: string; unit_price: string };

interface Form {
  full_name: string;
  phone: string;
  address_line: string;
  city: string;
  district: string;
  cargo_provider: "" | "ptt" | "surat";
  notes: string;
  manual: boolean;
  total: string;
  lines: Line[];
}

function cents(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function money(value: number) {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function formFrom(order: EditableOrder): Form {
  return {
    full_name: order.customer?.full_name ?? "",
    phone: order.customer?.phone ?? "",
    address_line: order.address?.address_line ?? "",
    city: order.address?.city ?? "",
    district: order.address?.district ?? "",
    cargo_provider: order.cargo_provider === "ptt" || order.cargo_provider === "surat" ? order.cargo_provider : "",
    notes: order.notes ?? "",
    manual: order.manual_total,
    total: order.total_amount,
    lines: order.items.map((item) => ({ key: item.public_id, public_id: item.public_id, product_public_id: item.product_public_id, name: item.name, quantity: String(item.quantity), unit_price: item.unit_price })),
  };
}

/**
 * Legacy parity: SiparislerPage "Siparişi Düzenle" modal (duzenlemeyiKaydet). Customer name/phone, address,
 * cargo firm, note, item lines and the grand total (line sum or manual) via `PATCH /api/orders/{id}`.
 * KolayBi-transferred / deleted / cancelled orders are read-only, as in legacy.
 */
export function SiparisDuzenleModal({ http, orderPublicId, onClose, onSaved }: { http: BackendHttpClient; orderPublicId: string; onClose: () => void; onSaved: (order: EditableOrder) => void }) {
  const t = useT(orderEditMessages);
  const client = useMemo(() => createOrderActionsClient(http), [http]);
  const [order, setOrder] = useState<EditableOrder | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    client
      .getEditable(orderPublicId)
      .then(({ order: loaded }) => {
        if (!active) return;
        setOrder(loaded);
        setForm(formFrom(loaded));
      })
      .catch((loadError: unknown) => active && setError(t("loadFailed", { error: errorText(loadError) })));
    return () => {
      active = false;
    };
  }, [client, orderPublicId, t]);

  const lineSum = useMemo(() => (form ? form.lines.reduce((sum, line) => sum + (cents(line.unit_price) ?? 0) * (Number.parseInt(line.quantity, 10) || 0), 0) : 0), [form]);
  const locked = order?.locked_reason ?? null;
  const lockedText = locked === "kolaybi" ? t("lockedKolaybi") : locked === "deleted" ? t("lockedDeleted") : locked === "cancelled" ? t("lockedCancelled") : null;

  const update = (patch: Partial<Form>) => setForm((current) => (current ? { ...current, ...patch } : current));
  const updateLine = (key: string, patch: Partial<Line>) => setForm((current) => (current ? { ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) } : current));

  async function save() {
    if (!form || locked) return;
    if (!form.full_name.trim()) return setError(t("nameRequired"));
    if (!form.phone.trim()) return setError(t("phoneRequired"));
    if (!form.address_line.trim() || !form.city.trim() || !form.district.trim()) return setError(t("addressRequired"));
    if (form.lines.length === 0) return setError(t("itemsRequired"));
    setSaving(true);
    setError(null);
    try {
      const { order: saved } = await client.editOrder(orderPublicId, {
        customer: { full_name: form.full_name.trim(), phone: form.phone.trim() },
        address: { address_line: form.address_line.trim(), city: form.city.trim(), district: form.district.trim() },
        notes: form.notes.trim() || null,
        cargo_provider: form.cargo_provider || null,
        items: form.lines.map((line) => ({
          public_id: line.public_id,
          product_public_id: line.product_public_id,
          name: line.name.trim() || "Ürün",
          quantity: Math.max(1, Number.parseInt(line.quantity, 10) || 1),
          unit_price: money(cents(line.unit_price) ?? 0),
        })),
        total_amount: form.manual ? money(cents(form.total) ?? 0) : null,
      });
      onSaved(saved);
    } catch (saveError) {
      setError(t("saveFailed", { error: errorText(saveError) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kargo-modal-backdrop" data-testid="order-edit-modal">
      <div className="kargo-modal order-edit-modal" role="dialog" aria-modal="true" aria-label={t("title")}>
        <div className="kargo-modal-header">
          <h3>
            {t("title")}
            {order && <span className="order-edit-number"> · {order.order_number}</span>}
          </h3>
          <button type="button" className="kargo-icon-button" aria-label={t("close")} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {!form ? (
          error ? <p className="kargo-modal-error">{error}</p> : (
            <p className="kargo-modal-loading">
              <Loader2 size={16} className="vapi-spin" />
              {t("loading")}
            </p>
          )
        ) : (
          <div className="kargo-modal-body">
            {lockedText && <p className="kargo-modal-error" data-testid="order-edit-locked">{lockedText}</p>}
            <fieldset className="order-edit-grid" disabled={Boolean(locked) || saving}>
              <label className="kargo-field">
                {t("customerName")}
                <input value={form.full_name} onChange={(event) => update({ full_name: event.target.value })} data-testid="order-edit-name" />
              </label>
              <label className="kargo-field">
                {t("customerPhone")}
                <input value={form.phone} onChange={(event) => update({ phone: event.target.value })} data-testid="order-edit-phone" />
              </label>
              <label className="kargo-field order-edit-wide">
                {t("address")}
                <textarea rows={2} value={form.address_line} onChange={(event) => update({ address_line: event.target.value })} data-testid="order-edit-address" />
              </label>
              <label className="kargo-field">
                {t("city")}
                <input value={form.city} onChange={(event) => update({ city: event.target.value })} data-testid="order-edit-city" />
              </label>
              <label className="kargo-field">
                {t("district")}
                <input value={form.district} onChange={(event) => update({ district: event.target.value })} data-testid="order-edit-district" />
              </label>
              <label className="kargo-field">
                {t("cargo")}
                <select value={form.cargo_provider} onChange={(event) => update({ cargo_provider: event.target.value as Form["cargo_provider"] })} data-testid="order-edit-cargo">
                  <option value="">{t("cargoNone")}</option>
                  <option value="ptt">PTT</option>
                  <option value="surat">Sürat</option>
                </select>
              </label>
              <label className="kargo-field order-edit-wide">
                {t("notes")}
                <textarea rows={2} value={form.notes} onChange={(event) => update({ notes: event.target.value })} data-testid="order-edit-notes" />
              </label>
              <div className="order-edit-wide order-edit-lines" data-testid="order-edit-lines">
                <strong>{t("items")}</strong>
                {form.lines.map((line) => (
                  <div className="order-edit-line" key={line.key} data-testid="order-edit-line">
                    <input aria-label={t("itemName")} placeholder={t("itemName")} value={line.name} onChange={(event) => updateLine(line.key, { name: event.target.value })} data-testid="order-edit-line-name" />
                    <input aria-label={t("quantity")} type="number" min={1} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} data-testid="order-edit-line-quantity" />
                    <input aria-label={t("unitPrice")} inputMode="decimal" value={line.unit_price} onChange={(event) => updateLine(line.key, { unit_price: event.target.value })} data-testid="order-edit-line-price" />
                    <span className="order-edit-line-total">{money((cents(line.unit_price) ?? 0) * (Number.parseInt(line.quantity, 10) || 0))}</span>
                    <button type="button" className="kargo-icon-button" aria-label={t("removeItem")} onClick={() => update({ lines: form.lines.filter((entry) => entry.key !== line.key) })} data-testid="order-edit-line-remove">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => update({ lines: [...form.lines, { key: `new-${Date.now()}-${form.lines.length}`, public_id: null, product_public_id: null, name: "", quantity: "1", unit_price: "0" }] })}
                  data-testid="order-edit-add-line"
                >
                  <Plus size={14} />
                  {t("addItem")}
                </button>
              </div>
              <label className="order-edit-manual order-edit-wide">
                <input type="checkbox" checked={form.manual} onChange={(event) => update({ manual: event.target.checked, total: event.target.checked ? form.total : money(lineSum) })} data-testid="order-edit-manual" />
                {t("manualTotal")}
              </label>
              <label className="kargo-field order-edit-wide">
                {t("grandTotal")} ({order?.currency ?? "TRY"})
                <input
                  inputMode="decimal"
                  value={form.manual ? form.total : money(lineSum)}
                  readOnly={!form.manual}
                  onChange={(event) => update({ total: event.target.value })}
                  data-testid="order-edit-total"
                />
              </label>
            </fieldset>
            {error && <p className="kargo-modal-error" data-testid="order-edit-error">{error}</p>}
            <div className="kargo-modal-actions">
              <button type="button" className="secondary-action" onClick={onClose}>
                {t("cancel")}
              </button>
              <button type="button" className="kargo-create-button kargo-create-ptt" disabled={Boolean(locked) || saving} onClick={() => void save()} data-testid="order-edit-save">
                {saving ? <Loader2 size={14} className="vapi-spin" /> : <Pencil size={14} />}
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
