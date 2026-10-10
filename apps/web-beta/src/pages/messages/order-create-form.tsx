import type { OrderSummary } from "@garanti-kulucka/shared";
import { AlertCircle, Package, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { BrandIcon } from "@/components/brand-icons";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tip } from "@/components/ui/tooltip";
import { ApiError, type SuratCoverageDecision } from "@/lib/api";
import { defaultProduct, emptyLine, lineFor, orderTotal, validateOrder, type OrderDraft, type OrderLine, type OrderValidationError } from "@/lib/chat";
import { parseMoney, type ProductOption } from "@/lib/orders";
import { districtsOf, provinces } from "@/lib/turkiye";
import { cn } from "@/lib/utils";
import { errorText } from "../accounting-shared";
import { ChatDialog, useChatToast } from "./chat-ui";
import { ChatCombobox } from "./fields";
import { chatTipClass } from "./top-bar";

export interface OrderPrefill {
  key: string;
  customerPublicId: string | null;
  name: string;
  phone: string;
  city: string;
  district: string;
  address: string;
}

export const fieldClass =
  "w-full rounded border border-msg-border-strong bg-msg-field px-2 py-1.5 text-xs text-msg-fg placeholder:text-msg-subtle transition-all focus:border-msg-primary focus:bg-msg-field-focus focus:ring-1 focus:ring-msg-primary focus:outline-none max-lg:min-h-11 max-lg:text-base";
const dropTarget = "border-msg-primary bg-msg-primary/10 ring-2 ring-msg-primary/20";
export const labelClass = "mb-0.5 block text-[10px] font-medium text-msg-muted";

const errorKeys: Record<OrderValidationError, `chat.err${string}`> = {
  name: "chat.errName",
  phone: "chat.errPhone",
  city: "chat.errCity",
  district: "chat.errDistrict",
  address: "chat.errAddress",
  price: "chat.errPrice",
  total: "chat.errTotal",
  product: "chat.errProduct",
  cargo: "chat.errCargo",
};

type TextField = "name" | "phone" | "address";

const cityOptions = provinces.map((item) => ({ value: item.city, label: item.city }));

const blankDraft = (products: ProductOption[] | null): OrderDraft => ({
  name: "",
  phone: "",
  lines: [lineFor(products ? defaultProduct(products) : undefined)],
  city: "",
  district: "",
  address: "",
  notes: "",
  cargo: "",
});

/** Legacy "Sipariş Oluştur" side form: isim, telefon, ürün kutuları, il/ilçe, adres, not, PTT/Sürat, mükerrer + AT uyarıları. */
export function OrderCreateForm({
  conversationId,
  prefill,
  products,
  onCreated,
  stickySubmit = false,
}: {
  conversationId: string;
  prefill: OrderPrefill;
  products: ProductOption[] | null;
  onCreated: (order: OrderSummary, total: number, productNames: string[]) => void;
  /** In the mobile/tablet sheet the "Sipariş Oluştur" button sticks to the bottom of the scroll area. */
  stickySubmit?: boolean;
}) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const toast = useChatToast();
  const [draft, setDraft] = useState<OrderDraft>(() => blankDraft(products));
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicateWarned, setDuplicateWarned] = useState(false);
  const [atBypassed, setAtBypassed] = useState(false);
  const [atWarning, setAtWarning] = useState<{ message: string; city: string; district: string; address: string } | null>(null);
  const lock = useRef(false);
  const [coverage, setCoverage] = useState<SuratCoverageDecision | null>(null);

  // Sürat AT precheck (legacy at-durum-kontrol): warn before submit; the server re-checks on create anyway.
  const coverageAddress = draft.cargo === "surat" && draft.city && draft.district ? `${draft.city}|${draft.district}|${draft.address.trim()}` : "";
  useEffect(() => {
    setCoverage(null);
    if (!coverageAddress) return;
    const [city = "", district = "", address = ""] = coverageAddress.split("|");
    let active = true;
    const timer = window.setTimeout(() => {
      api
        .suratCoverage({ city, district, address_line: address || null })
        .then((decision) => active && setCoverage(decision))
        .catch(() => undefined);
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, coverageAddress]);

  // A newly opened conversation fills the customer fields; the picked products stay (legacy).
  useEffect(() => {
    setDraft((prev) => ({ ...prev, name: prefill.name, phone: prefill.phone, city: prefill.city, district: prefill.district, address: prefill.address }));
    setDuplicateWarned(false);
    setAtBypassed(false);
  }, [prefill.key, prefill.name, prefill.phone, prefill.city, prefill.district, prefill.address]);

  // Products arrive after the form: preselect the default (el yapımı kuluçka) unless one is already chosen.
  useEffect(() => {
    if (!products?.length) return;
    setDraft((prev) => {
      const first = prev.lines[0];
      if (first?.product_public_id) return prev;
      return { ...prev, lines: [lineFor(defaultProduct(products)), ...prev.lines.slice(1)] };
    });
  }, [products]);

  const setField = (field: TextField | "notes") => (value: string) => setDraft((prev) => ({ ...prev, [field]: value }));
  const updateLine = (index: number, patch: Partial<OrderLine>) => setDraft((prev) => ({ ...prev, lines: prev.lines.map((line, position) => (position === index ? { ...line, ...patch } : line)) }));
  const pickProduct = (index: number, publicId: string) => {
    const product = products?.find((item) => item.public_id === publicId);
    updateLine(index, product ? lineFor(product) : { product_public_id: "", name: "", external_product_id: null });
  };

  // Text dragged from a chat bubble drops straight into a field (legacy sürükle-bırak).
  const dropProps = (field: string, apply: (value: string) => void) => ({
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDragEnter: () => setDragTarget(field),
    onDragLeave: () => setDragTarget(null),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      apply(event.dataTransfer.getData("text/plain"));
      setDragTarget(null);
    },
  });

  async function submit(forceAt = false) {
    if (lock.current || saving) return;
    const invalid = validateOrder(draft);
    if (invalid) return toast.error(t(errorKeys[invalid] as "chat.errName"));
    lock.current = true;
    setSaving(true);
    const total = orderTotal(draft.lines);
    const lines = draft.lines.filter((line, index) => index === 0 || line.name.trim());
    try {
      const order = await api.createOrder({
        customer_public_id: prefill.customerPublicId && prefill.phone === draft.phone ? prefill.customerPublicId : null,
        conversation_public_id: conversationId,
        customer: { full_name: draft.name.trim(), phone: draft.phone.trim() },
        address: { address_line: draft.address.trim(), city: draft.city, district: draft.district, country: "Türkiye" },
        status: "draft",
        source: "conversation",
        cargo_provider: draft.cargo as "ptt" | "surat",
        notes: draft.notes.trim() || null,
        currency: "TRY",
        force_duplicate: duplicateWarned,
        force_surat_at: forceAt || atBypassed,
        items: lines.map((line) => ({
          product_public_id: line.product_public_id || null,
          name: line.name.trim(),
          quantity: Math.max(Number.parseInt(line.quantity, 10) || 1, 1),
          unit_price: parseMoney(line.price).toFixed(2),
          external_product_id: line.external_product_id,
        })),
      });
      onCreated(
        order,
        total,
        lines.map((line) => line.name),
      );
      setDraft(blankDraft(products));
      setDuplicateWarned(false);
      setAtBypassed(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === "surat_at_warning") {
        setAtWarning({ message: error.message || t("chat.atDefault"), city: draft.city, district: draft.district, address: draft.address.trim() });
      } else if (error instanceof ApiError && error.status === 409 && (error.code === "duplicate_phone_warning" || error.code === "duplicate_name_warning")) {
        // Legacy mükerrer: red banner for the phone, yellow for the name; the next click creates anyway.
        toast.alert(error.code === "duplicate_phone_warning" ? "danger" : "warning", error.message);
        setDuplicateWarned(true);
      } else {
        toast.error(t("chat.failed", { error: errorText(error) }));
      }
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  const productOptions = [{ value: "", label: t("chat.selectProduct") }, ...(products ?? []).map((product) => ({ value: product.public_id, label: product.name, icon: <Package className="size-3.5 shrink-0 opacity-60" aria-hidden="true" /> }))];
  const productSelect = (line: OrderLine, index: number) => (
    <ChatCombobox
      compact
      clearable={false}
      label={t("chat.productN", { n: index + 1 })}
      placeholder={products === null ? t("chat.loading") : t("chat.selectProduct")}
      options={productOptions}
      value={line.product_public_id}
      onChange={(value) => pickProduct(index, value)}
      notFoundText={t("chat.noResults")}
      disabled={products === null}
      testId="order-product"
    />
  );

  return (
    <div className="mt-2 space-y-2" data-testid="order-create-form">
      <div>
        <label className={labelClass} htmlFor="order-name">
          {t("chat.name")}
        </label>
        <Input unstyled id="order-name" type="text" value={draft.name} onChange={(event) => setField("name")(event.target.value)} placeholder={t("chat.namePh")} className={cn(fieldClass, dragTarget === "name" && dropTarget)} {...dropProps("name", setField("name"))} data-testid="order-name" />
      </div>
      <div>
        <label className={labelClass} htmlFor="order-phone">
          {t("chat.phone")}
        </label>
        <Input unstyled id="order-phone" type="tel" inputMode="tel" value={draft.phone} onChange={(event) => setField("phone")(event.target.value)} placeholder={t("chat.phonePh")} className={cn(fieldClass, dragTarget === "phone" && dropTarget)} {...dropProps("phone", setField("phone"))} data-testid="order-phone" />
      </div>

      {draft.lines.map((line, index) => (
        <div key={index} className={cn("rounded border border-msg-border bg-msg-raised/40 p-2", index >= 2 ? "space-y-1.5" : "space-y-2")} data-testid="order-line">
          <div className="flex items-center justify-between">
            <span className={cn("text-[10px] font-medium", index >= 2 ? "text-msg-subtle uppercase" : "text-msg-muted")}>{t("chat.productN", { n: index + 1 })}</span>
            {index === 0 ? (
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }))}
                className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium max-lg:min-h-11 max-lg:px-3 max-lg:text-xs text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
                data-testid="order-add-product"
              >
                <Plus className="size-3" aria-hidden="true" />
                {t("chat.addProduct")}
              </button>
            ) : (
              <Tip label={t("chat.removeProduct")} className={chatTipClass}>
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, lines: prev.lines.filter((_, position) => position !== index) }))}
                aria-label={t("chat.removeProduct")}
                className={cn("flex items-center gap-1 rounded p-0.5 transition-colors max-lg:size-11 max-lg:justify-center", index === 1 ? "text-rose-500 hover:bg-rose-500/20 hover:text-rose-400" : "text-red-500 hover:bg-red-500/20 dark:text-red-400")}
                data-testid="order-remove-product"
              >
                {index === 1 ? <Trash2 className="size-3.5" aria-hidden="true" /> : <X className="size-3" aria-hidden="true" />}
              </button>
              </Tip>
            )}
          </div>
          {productSelect(line, index)}
          <div className="grid grid-cols-2 gap-2">
            {index >= 2 ? (
              <>
                <Input unstyled type="text" inputMode="numeric" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} placeholder={t("chat.qty")} aria-label={t("chat.qty")} className={fieldClass} data-testid="order-qty" />
                <Input unstyled type="text" inputMode="decimal" value={line.price} onChange={(event) => updateLine(index, { price: event.target.value })} placeholder={t("chat.price")} aria-label={t("chat.price")} className={fieldClass} data-testid="order-price" />
              </>
            ) : (
              <>
                <div>
                  <label className={labelClass}>{t("chat.qty")}</label>
                  <Input
                    unstyled
                    type="text"
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(event) => updateLine(index, { quantity: event.target.value })}
                    aria-label={t("chat.qty")}
                    className={cn(fieldClass, index === 0 && dragTarget === "qty" && dropTarget)}
                    {...(index === 0 ? dropProps("qty", (value) => updateLine(0, { quantity: value })) : {})}
                    data-testid="order-qty"
                  />
                </div>
                <div>
                  <label className={labelClass}>{t("chat.price")}</label>
                  <Input
                    unstyled
                    type="text"
                    inputMode="decimal"
                    value={line.price}
                    onChange={(event) => updateLine(index, { price: event.target.value })}
                    aria-label={t("chat.price")}
                    className={cn(fieldClass, index === 0 && dragTarget === "price" && dropTarget)}
                    {...(index === 0 ? dropProps("price", (value) => updateLine(0, { price: value })) : {})}
                    data-testid="order-price"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      ))}

      <div>
        <span className={labelClass}>{t("chat.city")}</span>
        <ChatCombobox
          label={t("chat.city")}
          placeholder={t("chat.city")}
          options={cityOptions}
          value={draft.city}
          onChange={(value) => setDraft((prev) => ({ ...prev, city: value, district: "" }))}
          notFoundText={t("chat.noResults")}
          testId="order-city"
        />
      </div>
      <div>
        <span className={labelClass}>{t("chat.district")}</span>
        <ChatCombobox
          label={t("chat.district")}
          placeholder={t("chat.district")}
          options={(draft.city ? districtsOf(draft.city) : []).map((district) => ({ value: district, label: district }))}
          value={draft.district}
          onChange={(value) => setDraft((prev) => ({ ...prev, district: value }))}
          disabled={!draft.city}
          notFoundText={draft.city ? t("chat.districtNone") : t("chat.districtNeedsCity")}
          testId="order-district"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="order-address">
          {t("chat.address")}
        </label>
        <Textarea
          unstyled
          id="order-address"
          rows={2}
          value={draft.address}
          onChange={(event) => setField("address")(event.target.value)}
          placeholder={t("chat.address")}
          className={cn(fieldClass, "resize-none", dragTarget === "address" && dropTarget)}
          {...dropProps("address", setField("address"))}
          data-testid="order-address"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="order-note">
          {t("chat.note")}
        </label>
        <Textarea unstyled id="order-note" rows={1} value={draft.notes} onChange={(event) => setField("notes")(event.target.value)} placeholder={t("chat.notePh")} className={cn(fieldClass, "resize-none")} data-testid="order-note" />
      </div>
      <div>
        <span className={labelClass}>{t("chat.shipping")}</span>
        <ToggleGroup
          type="single"
          value={draft.cargo}
          onValueChange={(value) => value && setDraft((prev) => ({ ...prev, cargo: value as "ptt" | "surat" }))}
          aria-label={t("chat.shipping")}
          className="gap-2"
        >
          {(["ptt", "surat"] as const).map((cargo) => (
            <ToggleGroupItem
              key={cargo}
              value={cargo}
              className={cn(
                "flex min-h-0 flex-1 items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-1 max-lg:min-h-11",
                "border-msg-border-strong bg-msg-field text-msg-muted hover:bg-msg-field-focus",
                cargo === "surat"
                  ? "data-[state=on]:border-blue-500/50 data-[state=on]:bg-blue-600/20 data-[state=on]:text-blue-700 data-[state=on]:ring-1 data-[state=on]:ring-blue-500/40 dark:data-[state=on]:text-blue-300"
                  : "data-[state=on]:border-indigo-500/50 data-[state=on]:bg-indigo-600/20 data-[state=on]:text-indigo-700 data-[state=on]:ring-1 data-[state=on]:ring-indigo-500/40 dark:data-[state=on]:text-indigo-300",
              )}
              data-testid={`order-cargo-${cargo}`}
            >
              <BrandIcon brand={cargo} className="size-3.5" title="" />
              {cargo === "ptt" ? "PTT Kargo" : "Sürat Kargo"}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {coverage?.warning && (
          <p className="mt-1 flex items-start gap-1 text-xs text-red-600 dark:text-red-400" role="status" data-testid="order-surat-coverage">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {coverage.uncovered_areas.length > 0 ? t("chat.atPrecheckAreas", { areas: coverage.uncovered_areas.slice(0, 5).join(", ") }) : t("chat.atPrecheck")}
          </p>
        )}
      </div>
      <div className={stickySubmit ? "sticky bottom-0 z-10 -mx-3 border-t border-msg-border bg-msg-raised px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "pt-1"} data-testid="order-submit-bar">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className={cn("w-full rounded py-2 text-xs font-semibold transition-colors max-lg:min-h-11 max-lg:text-sm", saving ? "cursor-not-allowed bg-slate-500 text-white dark:bg-slate-600" : duplicateWarned ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-msg-primary text-msg-on-primary hover:bg-msg-primary/90")}
          data-testid="order-submit"
        >
          {saving ? t("chat.submitting") : duplicateWarned ? t("chat.submitAnyway") : t("chat.submit")}
        </button>
      </div>

      <ChatDialog
        open={atWarning !== null}
        onClose={() => setAtWarning(null)}
        tone="danger"
        icon={<AlertCircle className="size-6 shrink-0 text-white" aria-hidden="true" />}
        title={t("chat.atTitle")}
        testId="at-warning"
        footer={
          <button
            type="button"
            onClick={() => {
              setAtWarning(null);
              setAtBypassed(true);
              void submit(true);
            }}
            className="rounded bg-red-600 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
            data-testid="at-warning-create"
          >
            {t("chat.atCreate")}
          </button>
        }
      >
        <p className="mb-3 text-sm font-semibold text-red-600 dark:text-red-400">{atWarning?.message}</p>
        <div className="space-y-1 rounded border border-msg-border bg-msg-raised p-3 text-xs text-msg-fg-soft">
          {atWarning?.city && (
            <div>
              <span className="text-msg-subtle">{t("chat.atCity")}</span> {atWarning.city}
            </div>
          )}
          {atWarning?.district && (
            <div>
              <span className="text-msg-subtle">{t("chat.atDistrict")}</span> {atWarning.district}
            </div>
          )}
          {atWarning?.address && (
            <div>
              <span className="text-msg-subtle">{t("chat.atAddress")}</span> {atWarning.address}
            </div>
          )}
        </div>
      </ChatDialog>
    </div>
  );
}
