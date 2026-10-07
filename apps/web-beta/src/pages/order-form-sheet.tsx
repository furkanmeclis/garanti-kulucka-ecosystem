import type { OrderSummary } from "@garanti-kulucka/shared";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { orderTotals, parseMoney, type CargoProviderKey, type ProductOption } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { errorText, FeedbackLine, Field, NativeSelect, type Feedback } from "./accounting-shared";

interface FormItem {
  product_public_id: string;
  name: string;
  quantity: string;
  unit_price: string;
  external_product_id: string | null;
}

const emptyItem = (): FormItem => ({ product_public_id: "", name: "", quantity: "1", unit_price: "0.00", external_product_id: null });
const emptyForm = () => ({
  customer_public_id: null as string | null,
  name: "",
  phone: "",
  city: "",
  district: "",
  address: "",
  cargo: "" as CargoProviderKey | "",
  notes: "",
  items: [emptyItem()],
  force_duplicate: false,
  force_surat_at: false,
});

/** Legacy SiparislerPage "Yeni Sipariş" modal: customer by phone, address, PTT/Sürat, product lines (KDV dahil), duplicate and Sürat AT warnings. */
/** `initial` prefills the legacy "Sohbetten sipariş" form from a conversation (source = conversation). */
export interface OrderFormInitial {
  name?: string;
  phone?: string;
  conversationPublicId?: string | undefined;
  notes?: string;
}

export function OrderFormSheet({ open, onClose, onCreated, initial }: { open: boolean; onClose: () => void; onCreated: (order: OrderSummary) => void; initial?: OrderFormInitial }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ ...emptyForm(), name: initial?.name ?? "", phone: initial?.phone ?? "", notes: initial?.notes ?? "" });
    setFeedback(null);
    api
      .orderProductOptions()
      .then((response) => setProducts(response.data))
      .catch(() => setProducts([]));
    // `initial` is read once per opening.
  }, [open, api]);

  const set = (field: "name" | "phone" | "city" | "district" | "address" | "notes") => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value, force_duplicate: false, force_surat_at: false }));

  const updateItem = (index: number, patch: Partial<FormItem>) =>
    setForm((prev) => ({ ...prev, items: prev.items.map((item, position) => (position === index ? { ...item, ...patch } : item)), force_duplicate: false, force_surat_at: false }));

  function pickProduct(index: number, publicId: string) {
    const product = products.find((item) => item.public_id === publicId);
    updateItem(index, { product_public_id: publicId, name: product?.name ?? "", unit_price: product?.unit_price ?? "0.00", external_product_id: product?.external_product_id ?? null });
  }

  async function lookupPhone() {
    if (form.phone.replace(/\D/g, "").length < 10) return;
    try {
      const lookup = await api.lookupCustomerByPhone(form.phone.trim());
      if (!lookup.customer) return;
      setForm((prev) => ({
        ...prev,
        customer_public_id: lookup.customer?.public_id ?? prev.customer_public_id,
        name: lookup.customer?.full_name ?? prev.name,
        phone: lookup.customer?.phone ?? prev.phone,
        address: lookup.default_address?.address_line ?? prev.address,
        city: lookup.default_address?.city ?? prev.city,
        district: lookup.default_address?.district ?? prev.district,
      }));
      setFeedback({ tone: "success", text: t("orders.customerFound") });
    } catch {
      // A failed lookup only means nothing is prefilled.
    }
  }

  const totals = orderTotals(form.items);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const missing = !form.name.trim()
      ? "customerNameRequired"
      : !form.phone.trim()
        ? "customerPhoneRequired"
        : !form.city.trim()
          ? "cityRequired"
          : !form.district.trim()
            ? "districtRequired"
            : !form.address.trim()
              ? "addressRequired"
              : !form.cargo
                ? "cargoRequired"
                : null;
    if (missing) return setFeedback({ tone: "error", text: t(`orders.${missing}`) });
    if (!form.items.some((item) => item.name.trim())) return setFeedback({ tone: "error", text: t("orders.productRequired") });
    if (totals.grand <= 0) return setFeedback({ tone: "error", text: t("orders.zeroTotal") });
    setSaving(true);
    setFeedback(null);
    try {
      const order = await api.createOrder({
        customer_public_id: form.customer_public_id,
        customer: { full_name: form.name.trim(), phone: form.phone.trim() },
        address: { address_line: form.address.trim(), city: form.city.trim(), district: form.district.trim(), country: "Türkiye" },
        status: "draft",
        source: initial?.conversationPublicId ? "conversation" : "manual",
        conversation_public_id: initial?.conversationPublicId ?? null,
        cargo_provider: form.cargo as CargoProviderKey,
        notes: form.notes.trim() || null,
        currency: "TRY",
        force_duplicate: form.force_duplicate,
        force_surat_at: form.force_surat_at,
        items: form.items
          .filter((item) => item.name.trim())
          .map((item) => ({
            product_public_id: item.product_public_id || null,
            name: item.name.trim(),
            quantity: Math.max(Number(item.quantity) || 1, 1),
            unit_price: parseMoney(item.unit_price).toFixed(2),
            external_product_id: item.external_product_id,
          })),
      });
      onCreated(order);
    } catch (error) {
      // Legacy warnings (mükerrer telefon/isim, Sürat AT dışı) ask once; the next submit forces past them.
      if (error instanceof ApiError && error.status === 409) {
        const code = error.code ?? "";
        setForm((prev) => ({
          ...prev,
          force_duplicate: prev.force_duplicate || code === "duplicate_phone_warning" || code === "duplicate_name_warning",
          force_surat_at: prev.force_surat_at || code === "surat_at_warning",
        }));
        setFeedback({ tone: "error", text: error.message });
      } else {
        setFeedback({ tone: "error", text: t("orders.createFailed", { error: errorText(error) }) });
      }
    } finally {
      setSaving(false);
    }
  }

  const forced = form.force_duplicate || form.force_surat_at;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("cargoCreate.close")} className="w-[min(36rem,100vw)] overflow-y-auto p-0" data-testid="order-form">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("orders.formTitle")}</SheetTitle>
          <SheetDescription>{t("orders.phoneHint")}</SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-3 p-4" onSubmit={(event) => void submit(event)} noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("orders.phone")}>
              <Input className="h-11 md:h-9" type="tel" value={form.phone} onChange={set("phone")} onBlur={() => void lookupPhone()} data-testid="order-form-phone" />
            </Field>
            <Field label={t("orders.name")}>
              <Input className="h-11 md:h-9" value={form.name} onChange={set("name")} data-testid="order-form-name" />
            </Field>
            <Field label={t("orders.city")}>
              <Input className="h-11 md:h-9" value={form.city} onChange={set("city")} data-testid="order-form-city" />
            </Field>
            <Field label={t("orders.district")}>
              <Input className="h-11 md:h-9" value={form.district} onChange={set("district")} data-testid="order-form-district" />
            </Field>
          </div>
          <Field label={t("orders.address")}>
            <textarea
              className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              rows={2}
              value={form.address}
              onChange={set("address")}
              data-testid="order-form-address"
            />
          </Field>
          <div className="flex flex-col gap-1.5 text-sm font-medium">
            <span>{t("orders.cargoProvider")}</span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("orders.cargoProvider")}>
              {(["ptt", "surat"] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={form.cargo === value}
                  variant={form.cargo === value ? "default" : "outline"}
                  className="min-h-11"
                  onClick={() => setForm((prev) => ({ ...prev, cargo: value, force_surat_at: false }))}
                  data-testid={`order-form-cargo-${value}`}
                >
                  {value === "ptt" ? "PTT Kargo" : "Sürat Kargo"}
                </Button>
              ))}
            </div>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("orders.items")}</legend>
            {form.items.map((item, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border p-2" data-testid="order-form-item">
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  <NativeSelect className="col-span-2" aria-label={t("orders.product")} value={item.product_public_id} onChange={(event) => pickProduct(index, event.target.value)} data-testid="order-form-product">
                    <option value="">{t("orders.productCustom")}</option>
                    {products.map((product) => (
                      <option key={product.public_id} value={product.public_id}>
                        {product.name} · {formatMoney(product.unit_price, "TRY", i18n.language)} · {product.stock_quantity}
                      </option>
                    ))}
                  </NativeSelect>
                  {!item.product_public_id && (
                    <Input className="col-span-2 h-11 md:h-9" aria-label={t("orders.itemName")} placeholder={t("orders.itemName")} value={item.name} onChange={(event) => updateItem(index, { name: event.target.value })} data-testid="order-form-item-name" />
                  )}
                  <Input className="h-11 md:h-9" type="number" min={1} aria-label={t("orders.quantity")} value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} data-testid="order-form-quantity" />
                  <Input className="h-11 md:h-9" inputMode="decimal" aria-label={t("orders.unitPrice")} value={item.unit_price} onChange={(event) => updateItem(index, { unit_price: event.target.value })} data-testid="order-form-price" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 self-start text-destructive md:size-9"
                  aria-label={t("orders.removeItem")}
                  disabled={form.items.length === 1}
                  onClick={() => setForm((prev) => ({ ...prev, items: prev.items.filter((_, position) => position !== index) }))}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" className="min-h-11 self-start" onClick={() => setForm((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }))} data-testid="order-form-add-item">
              <Plus className="size-4" aria-hidden="true" />
              {t("orders.addItem")}
            </Button>
          </fieldset>
          <Field label={t("orders.notes")}>
            <Input className="h-11 md:h-9" value={form.notes} onChange={set("notes")} />
          </Field>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-muted p-3 text-sm" data-testid="order-form-totals">
            <dt className="text-muted-foreground">{t("orders.subtotal")}</dt>
            <dd className="text-right tabular-nums">{formatMoney(totals.subtotal, "TRY", i18n.language)}</dd>
            <dt className="text-muted-foreground">{t("orders.vat")}</dt>
            <dd className="text-right tabular-nums">{formatMoney(totals.vat, "TRY", i18n.language)}</dd>
            <dt className="font-semibold">{t("orders.grandTotal")}</dt>
            <dd className="text-right font-semibold tabular-nums" data-testid="order-form-grand-total">
              {formatMoney(totals.grand, "TRY", i18n.language)}
            </dd>
          </dl>
          <FeedbackLine feedback={feedback} testId="order-form-feedback" />
          <Button type="submit" className={cn("min-h-11", forced && "bg-amber-600 hover:bg-amber-600/90")} disabled={saving} data-testid="order-form-submit">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {saving ? t("orders.submitting") : forced ? t("orders.submitAnyway") : t("orders.submit")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
