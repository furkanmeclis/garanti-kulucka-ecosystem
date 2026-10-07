import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EditableOrder } from "@/lib/orders";
import {
  errorText,
  FeedbackLine,
  Field,
  NativeSelect,
  type Feedback,
} from "./accounting-shared";

type Line = {
  key: string;
  public_id: string | null;
  product_public_id: string | null;
  name: string;
  quantity: string;
  unit_price: string;
};

function cents(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function money(value: number) {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

/** Legacy SiparislerPage "Siparişi Düzenle" modal, inline in the order detail sheet (`PATCH /api/orders/{id}`). */
export function OrderEditForm({
  publicId,
  onCancel,
  onSaved,
}: {
  publicId: string;
  onCancel: () => void;
  onSaved: (order: EditableOrder) => void;
}) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [order, setOrder] = useState<EditableOrder | null>(null);
  const [form, setForm] = useState<{
    full_name: string;
    phone: string;
    address_line: string;
    city: string;
    district: string;
    cargo: "" | "ptt" | "surat";
    notes: string;
    manual: boolean;
    total: string;
    lines: Line[];
  } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getEditableOrder(publicId)
      .then(({ order: loaded }) => {
        if (!active) return;
        setOrder(loaded);
        setForm({
          full_name: loaded.customer?.full_name ?? "",
          phone: loaded.customer?.phone ?? "",
          address_line: loaded.address?.address_line ?? "",
          city: loaded.address?.city ?? "",
          district: loaded.address?.district ?? "",
          cargo:
            loaded.cargo_provider === "ptt" || loaded.cargo_provider === "surat"
              ? loaded.cargo_provider
              : "",
          notes: loaded.notes ?? "",
          manual: loaded.manual_total,
          total: loaded.total_amount,
          lines: loaded.items.map((item) => ({
            key: item.public_id,
            public_id: item.public_id,
            product_public_id: item.product_public_id,
            name: item.name,
            quantity: String(item.quantity),
            unit_price: item.unit_price,
          })),
        });
      })
      .catch(
        (error: unknown) =>
          active &&
          setFeedback({
            tone: "error",
            text: t("orderEdit.loadFailed", { error: errorText(error) }),
          }),
      );
    return () => {
      active = false;
    };
  }, [api, publicId, t]);

  const lineSum = useMemo(
    () =>
      form
        ? form.lines.reduce(
            (sum, line) =>
              sum +
              (cents(line.unit_price) ?? 0) *
                (Number.parseInt(line.quantity, 10) || 0),
            0,
          )
        : 0,
    [form],
  );
  if (!form || !order)
    return feedback ? (
      <FeedbackLine feedback={feedback} testId="order-edit-feedback" />
    ) : (
      <Loader2
        className="size-5 animate-spin text-muted-foreground"
        aria-label={t("orderEdit.loading")}
      />
    );

  const locked = order.locked_reason;
  type FormState = NonNullable<typeof form>;
  const update = (patch: Partial<FormState>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));
  const updateLine = (key: string, patch: Partial<Line>) =>
    setForm((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.key === key ? { ...line, ...patch } : line,
            ),
          }
        : current,
    );

  async function save() {
    if (!form || locked) return;
    if (!form.full_name.trim())
      return setFeedback({ tone: "error", text: t("orderEdit.nameRequired") });
    if (!form.phone.trim())
      return setFeedback({ tone: "error", text: t("orderEdit.phoneRequired") });
    if (!form.address_line.trim() || !form.city.trim() || !form.district.trim())
      return setFeedback({
        tone: "error",
        text: t("orderEdit.addressRequired"),
      });
    if (form.lines.length === 0)
      return setFeedback({ tone: "error", text: t("orderEdit.itemsRequired") });
    setSaving(true);
    setFeedback(null);
    try {
      const { order: saved } = await api.editOrder(publicId, {
        customer: {
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
        },
        address: {
          address_line: form.address_line.trim(),
          city: form.city.trim(),
          district: form.district.trim(),
        },
        notes: form.notes.trim() || null,
        cargo_provider: form.cargo || null,
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
    } catch (error) {
      setFeedback({
        tone: "error",
        text: t("orderEdit.saveFailed", { error: errorText(error) }),
      });
    } finally {
      setSaving(false);
    }
  }

  const disabled = Boolean(locked) || saving;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      data-testid="order-edit-form"
    >
      {locked && (
        <p className="text-destructive" data-testid="order-edit-locked">
          {t(`orderEdit.locked_${locked}`)}
        </p>
      )}
      <fieldset
        className="grid min-w-0 gap-3 sm:grid-cols-2"
        disabled={disabled}
      >
        <Field label={t("orderEdit.customerName")}>
          <Input
            className="h-11 md:h-9"
            value={form.full_name}
            onChange={(event) => update({ full_name: event.target.value })}
            data-testid="order-edit-name"
          />
        </Field>
        <Field label={t("orderEdit.customerPhone")}>
          <Input
            className="h-11 md:h-9"
            inputMode="tel"
            value={form.phone}
            onChange={(event) => update({ phone: event.target.value })}
            data-testid="order-edit-phone"
          />
        </Field>
        <Field label={t("orderEdit.address")} className="sm:col-span-2">
          <Input
            className="h-11 md:h-9"
            value={form.address_line}
            onChange={(event) => update({ address_line: event.target.value })}
            data-testid="order-edit-address"
          />
        </Field>
        <Field label={t("orderEdit.city")}>
          <Input
            className="h-11 md:h-9"
            value={form.city}
            onChange={(event) => update({ city: event.target.value })}
            data-testid="order-edit-city"
          />
        </Field>
        <Field label={t("orderEdit.district")}>
          <Input
            className="h-11 md:h-9"
            value={form.district}
            onChange={(event) => update({ district: event.target.value })}
            data-testid="order-edit-district"
          />
        </Field>
        <Field label={t("orderEdit.cargo")}>
          <NativeSelect
            value={form.cargo}
            onChange={(event) =>
              update({ cargo: event.target.value as "" | "ptt" | "surat" })
            }
            data-testid="order-edit-cargo"
          >
            <option value="">{t("orderEdit.cargoNone")}</option>
            <option value="ptt">PTT</option>
            <option value="surat">Sürat</option>
          </NativeSelect>
        </Field>
        <Field label={t("orderEdit.notes")} className="sm:col-span-2">
          <Input
            className="h-11 md:h-9"
            value={form.notes}
            onChange={(event) => update({ notes: event.target.value })}
            data-testid="order-edit-notes"
          />
        </Field>
        <div
          className="flex min-w-0 flex-col gap-2 sm:col-span-2"
          data-testid="order-edit-lines"
        >
          <p className="text-sm font-medium">{t("orderEdit.items")}</p>
          {form.lines.map((line) => (
            <div
              key={line.key}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_4rem_5.5rem_2.75rem] items-center gap-2"
              data-testid="order-edit-line"
            >
              <Input
                className="h-11 md:h-9"
                aria-label={t("orderEdit.itemName")}
                placeholder={t("orderEdit.itemName")}
                value={line.name}
                onChange={(event) =>
                  updateLine(line.key, { name: event.target.value })
                }
                data-testid="order-edit-line-name"
              />
              <Input
                className="h-11 md:h-9"
                aria-label={t("orderEdit.quantity")}
                type="number"
                min={1}
                value={line.quantity}
                onChange={(event) =>
                  updateLine(line.key, { quantity: event.target.value })
                }
                data-testid="order-edit-line-quantity"
              />
              <Input
                className="h-11 md:h-9"
                aria-label={t("orderEdit.unitPrice")}
                inputMode="decimal"
                value={line.unit_price}
                onChange={(event) =>
                  updateLine(line.key, { unit_price: event.target.value })
                }
                data-testid="order-edit-line-price"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 md:size-9"
                aria-label={t("orderEdit.removeItem")}
                onClick={() =>
                  update({
                    lines: form.lines.filter((entry) => entry.key !== line.key),
                  })
                }
                data-testid="order-edit-line-remove"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 self-start"
            onClick={() =>
              update({
                lines: [
                  ...form.lines,
                  {
                    key: `new-${Date.now()}-${form.lines.length}`,
                    public_id: null,
                    product_public_id: null,
                    name: "",
                    quantity: "1",
                    unit_price: "0",
                  },
                ],
              })
            }
            data-testid="order-edit-add-line"
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("orderEdit.addItem")}
          </Button>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="h-11 w-5 accent-primary md:size-5"
            checked={form.manual}
            onChange={(event) =>
              update({
                manual: event.target.checked,
                total: event.target.checked ? form.total : money(lineSum),
              })
            }
            data-testid="order-edit-manual"
          />
          {t("orderEdit.manualTotal")}
        </label>
        <Field
          label={`${t("orderEdit.grandTotal")} (${order.currency})`}
          className="sm:col-span-2"
        >
          <Input
            className="h-11 md:h-9"
            inputMode="decimal"
            readOnly={!form.manual}
            value={form.manual ? form.total : money(lineSum)}
            onChange={(event) => update({ total: event.target.value })}
            data-testid="order-edit-total"
          />
        </Field>
      </fieldset>
      <FeedbackLine feedback={feedback} testId="order-edit-feedback" />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={onCancel}
          data-testid="order-edit-cancel"
        >
          {t("orderEdit.cancel")}
        </Button>
        <Button
          type="submit"
          className="min-h-11"
          disabled={disabled}
          data-testid="order-edit-save"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
          {t("orderEdit.save")}
        </Button>
      </div>
    </form>
  );
}
