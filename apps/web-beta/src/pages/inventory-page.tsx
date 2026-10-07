import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, History, Package, Pencil, Plus, Trash2, AlertTriangle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import type { ProductCategory, ProductSummary, ProductUnit, StockMovementSummary } from "@/lib/inventory-balances";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";
import { errorText, FeedbackLine, Field, NativeSelect, type Feedback } from "./accounting-shared";

const categories: Array<{ key: ProductCategory; title: "categoryIncubatorTitle" | "categorySparePartTitle" | "categoryOtherTitle"; subtitle: "categoryIncubatorSubtitle" | "categorySparePartSubtitle" | "categoryOtherSubtitle" }> = [
  { key: "incubator", title: "categoryIncubatorTitle", subtitle: "categoryIncubatorSubtitle" },
  { key: "spare_part", title: "categorySparePartTitle", subtitle: "categorySparePartSubtitle" },
  { key: "other", title: "categoryOtherTitle", subtitle: "categoryOtherSubtitle" },
];
const units: ProductUnit[] = ["Adet", "Kg", "Lt", "Mt", "Koli"];
type StockState = "out" | "critical" | "normal";
type Mode = { kind: "create" } | { kind: "edit" | "in" | "out" | "history"; product: ProductSummary };

function stockState(product: ProductSummary, threshold: number): StockState {
  if (product.stock_quantity <= 0) return "out";
  return product.stock_quantity <= threshold ? "critical" : "normal";
}

function StockBadge({ state }: { state: StockState }) {
  const { t } = useTranslation();
  const label = state === "out" ? "statusOutOfStock" : state === "critical" ? "statusCritical" : "statusNormal";
  return <Badge tone={state === "out" ? "danger" : state === "critical" ? "warning" : "success"}>{t(`inventory.${label}`)}</Badge>;
}

/** /stok — legacy StokPage: category cards, per-category list with search and stock state, stock in/out, edit, history, delete. */
export function InventoryPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["category", "state"] as const);
  const category = categories.some((entry) => entry.key === list.filters.category) ? (list.filters.category as ProductCategory) : null;
  const stateFilter = list.filters.state;
  const summary = useQuery("inventory:summary", () => api.productSummary());
  const threshold = summary.data?.critical_threshold ?? 3;
  const products = useQuery(`inventory:${category ?? ""}:${list.query}`, () => api.listProducts({ ...(category ? { category } : {}), ...(list.query ? { search: list.query } : {}) }), { enabled: category !== null });
  const [mode, setMode] = useState<Mode | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const reloadAll = () => {
    summary.reload();
    products.reload();
  };

  async function remove(product: ProductSummary) {
    if (!window.confirm(t("inventory.confirmDelete", { name: product.name }))) return;
    setFeedback(null);
    try {
      await api.deactivateProduct(product.public_id);
      setFeedback({ tone: "success", text: t("inventory.deleted", { name: product.name }) });
      reloadAll();
    } catch (error) {
      setFeedback({ tone: "error", text: t("inventory.deleteFailed", { error: errorText(error) }) });
    }
  }

  const rows = (products.data?.data ?? []).filter((product) => product.is_active && (stateFilter === "all" || stockState(product, threshold) === stateFilter));
  const columns: Column<ProductSummary>[] = [
    {
      key: "name",
      header: t("inventory.fieldName").replace(" *", ""),
      mobile: "title",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.name}</span>
          <span className="truncate text-xs text-muted-foreground">{t("inventory.productMeta", { code: row.sku ?? t("common.none"), unit: row.unit ?? "Adet" })}</span>
        </span>
      ),
    },
    { key: "state", header: t("inventory.stockStatus"), mobile: "badge", cell: (row) => <StockBadge state={stockState(row, threshold)} /> },
    { key: "stock", header: t("inventory.currentStock"), cell: (row) => <span data-testid="inventory-quantity">{`${formatNumber(row.stock_quantity, i18n.language)} ${row.unit ?? "Adet"}`}</span> },
    { key: "price", header: t("inventory.salePrice"), cell: (row) => formatMoney(row.unit_price, "TRY", i18n.language) },
    {
      key: "actions",
      header: t("inventory.productActions", { name: "" }).trim(),
      className: "max-w-none overflow-visible",
      cell: (row) => (
        <div className="flex flex-wrap justify-end gap-1.5 md:justify-start">
          <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => setMode({ kind: "in", product: row })} data-testid="inventory-in">
            <ArrowDownToLine className="size-4" aria-hidden="true" />
            {t("inventory.stockIn")}
          </Button>
          <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => setMode({ kind: "out", product: row })} data-testid="inventory-out">
            <ArrowUpFromLine className="size-4" aria-hidden="true" />
            {t("inventory.stockOut")}
          </Button>
          <Button size="icon" variant="ghost" className="size-11 md:size-8" aria-label={`${t("inventory.edit")}: ${row.name}`} onClick={() => setMode({ kind: "edit", product: row })} data-testid="inventory-edit">
            <Pencil className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" className="size-11 md:size-8" aria-label={`${t("inventory.stockMovements")}: ${row.name}`} onClick={() => setMode({ kind: "history", product: row })} data-testid="inventory-history">
            <History className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" className="size-11 text-destructive md:size-8" aria-label={`${t("inventory.delete")}: ${row.name}`} onClick={() => void remove(row)} data-testid="inventory-delete">
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  const header = (
    <PageHeader
      title={category ? t(`inventory.${categories.find((entry) => entry.key === category)!.title}`) : t("inventory.pageTitle")}
      description={category ? t("inventory.listingCount", { count: rows.length }) : t("inventory.selectCategoryHint")}
      actions={
        <Button className="min-h-11" onClick={() => setMode({ kind: "create" })} data-testid="inventory-new">
          <Plus className="size-4" aria-hidden="true" />
          {t("inventory.newStock")}
        </Button>
      }
    />
  );

  return (
    <section data-testid="page-inventory">
      {header}
      <div className="mb-3">
        <FeedbackLine feedback={feedback} testId="inventory-feedback" />
      </div>
      {summary.data && summary.data.critical_count > 0 && !category && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-md bg-amber-500/15 p-3 text-sm text-amber-800 dark:text-amber-200" data-testid="inventory-critical">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {t("inventory.criticalWarning", { count: summary.data.critical_count })}
        </p>
      )}
      {!category ? (
        summary.error && !summary.data ? (
          <ErrorState onRetry={summary.reload} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="inventory-categories">
            {categories.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => list.update({ category: entry.key })}
                className="text-left"
                data-testid={`inventory-category-${entry.key}`}
              >
                <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:bg-accent">
                  <Package className="size-6 text-primary" aria-hidden="true" />
                  <span className="font-semibold">{t(`inventory.${entry.title}`)}</span>
                  <span className="text-sm text-muted-foreground">{t(`inventory.${entry.subtitle}`)}</span>
                  <span className="mt-auto text-sm font-medium">{t("inventory.productCount", { count: summary.data?.category_counts[entry.key] ?? 0 })}</span>
                </Card>
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <Button variant="ghost" className="mb-3 min-h-11 px-2" onClick={() => list.clear()} data-testid="inventory-back">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t("inventory.backToCategories")}
          </Button>
          <ListToolbar query={list.query} placeholder={t("inventory.searchInCategoryPlaceholder")} onQuery={(q) => list.update({ q })} hasFilters={list.query !== "" || stateFilter !== "all"} onClear={() => list.update({ q: null, state: null })}>
            <FilterSelect
              testId="filter-state"
              label={t("inventory.stockStatus")}
              value={stateFilter}
              onChange={(value) => list.update({ state: value })}
              options={[
                { value: "all", label: t("inventory.allStatuses") },
                { value: "normal", label: t("inventory.statusNormal") },
                { value: "critical", label: t("inventory.statusCritical") },
                { value: "out", label: t("inventory.statusOutOfStock") },
              ]}
            />
          </ListToolbar>
          {products.error && !products.data ? (
            <ErrorState onRetry={products.reload} />
          ) : (
            <DataList testId="inventory" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={products.loading} />
          )}
        </>
      )}
      <ProductSheet
        mode={mode}
        category={category ?? "incubator"}
        onClose={() => setMode(null)}
        onDone={(text) => {
          setMode(null);
          setFeedback({ tone: "success", text });
          reloadAll();
        }}
      />
    </section>
  );
}

function ProductSheet({ mode, category, onClose, onDone }: { mode: Mode | null; category: ProductCategory; onClose: () => void; onDone: (text: string) => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const product = mode && mode.kind !== "create" ? mode.product : null;
  const [form, setForm] = useState({ sku: "", name: "", external: "", quantity: "", unit: "Adet" as ProductUnit, price: "", description: "" });
  const [movements, setMovements] = useState<StockMovementSummary[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [kolaybi, setKolaybi] = useState<{ products: Array<{ id: string; name: string | null }>; total: number; synced_at: string | null } | null>(null);
  const [kolaybiNote, setKolaybiNote] = useState<string | null>(null);

  useEffect(() => {
    if (mode?.kind !== "create" && mode?.kind !== "edit") return;
    setKolaybiNote(null);
    api
      .listKolaybiProducts()
      .then(setKolaybi)
      .catch(() => setKolaybi(null));
  }, [mode, api]);

  async function refreshKolaybi() {
    try {
      await api.refreshKolaybiProducts();
      setKolaybiNote(t("inventory.kolaybiListQueued"));
      window.setTimeout(() => void api.listKolaybiProducts().then(setKolaybi).catch(() => undefined), 3000);
    } catch (error) {
      setKolaybiNote(errorText(error));
    }
  }

  useEffect(() => {
    setFeedback(null);
    setMovements(null);
    if (!mode) return;
    const source = mode.kind === "create" ? null : mode.product;
    setForm({
      sku: source?.sku ?? "",
      name: source?.name ?? "",
      external: source?.external_product_id ?? "",
      quantity: mode.kind === "edit" ? String(source?.stock_quantity ?? 0) : mode.kind === "create" ? "0" : "",
      unit: source?.unit ?? "Adet",
      price: source?.unit_price ?? "",
      description: mode.kind === "in" || mode.kind === "out" ? "" : source?.description ?? "",
    });
    if (mode.kind === "history") {
      api
        .listStockMovements(mode.product.public_id)
        .then((result) => setMovements(result.data))
        .catch(() => setFeedback({ tone: "error", text: t("inventory.loadMovementsError") }));
    }
  }, [mode, api, t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!mode || mode.kind === "history") return;
    setFeedback(null);
    const quantity = Number(form.quantity.replace(",", "."));
    try {
      setSaving(true);
      if (mode.kind === "in" || mode.kind === "out") {
        if (!(quantity > 0)) return setFeedback({ tone: "error", text: t("inventory.quantityMustBePositive") });
        if (mode.kind === "out" && quantity > mode.product.stock_quantity) {
          return setFeedback({ tone: "error", text: t("inventory.insufficientStock", { current: mode.product.stock_quantity, quantity }) });
        }
        const result = await api.createStockMovement(mode.product.public_id, { movement_type: mode.kind, quantity, ...(form.description.trim() ? { notes: form.description.trim() } : {}) });
        onDone(t("inventory.movementSaved", { movement: t(mode.kind === "in" ? "inventory.movementIn" : "inventory.movementOut"), quantity, unit: result.product.unit ?? "Adet", stock: result.product.stock_quantity }));
        return;
      }
      if (!form.name.trim()) return setFeedback({ tone: "error", text: t("inventory.nameRequired") });
      if (form.price.trim() && !Number.isFinite(Number(form.price.replace(",", ".")))) return setFeedback({ tone: "error", text: t("inventory.invalidUnitPrice") });
      if (!Number.isFinite(quantity) || quantity < 0) return setFeedback({ tone: "error", text: t("inventory.quantityMustBeNonNegative") });
      const input = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        external_product_id: form.external.trim() || null,
        unit: form.unit,
        unit_price: (form.price.trim() || "0").replace(",", "."),
        stock_quantity: quantity,
        description: form.description.trim() || null,
      };
      if (mode.kind === "create") {
        await api.createProduct({ ...input, category });
        onDone(t("inventory.cardCreated"));
      } else {
        await api.updateProduct(mode.product.public_id, input);
        onDone(t("inventory.cardUpdated"));
      }
    } catch (error) {
      setFeedback({ tone: "error", text: t("inventory.operationFailed", { error: errorText(error) }) });
    } finally {
      setSaving(false);
    }
  }

  const title =
    mode?.kind === "create"
      ? t("inventory.modalCreateTitle")
      : mode?.kind === "in"
        ? t("inventory.modalStockInTitle")
        : mode?.kind === "out"
          ? t("inventory.modalStockOutTitle")
          : mode?.kind === "edit"
            ? t("inventory.modalEditTitle")
            : t("inventory.historyTitle", { name: product?.name ?? "" });
  const input = (field: keyof typeof form, label: string, extra: { inputMode?: "decimal" | "numeric"; className?: string } = {}) => (
    <Field label={label} className={extra.className}>
      <Input value={form[field]} inputMode={extra.inputMode} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} className="h-11 md:h-9" data-testid={`product-${field}`} />
    </Field>
  );

  return (
    <Sheet open={mode !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("inventory.close")} className="w-[min(32rem,100vw)] overflow-y-auto p-0" data-testid="inventory-sheet">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{product ? t("inventory.currentStockWithUnit", { quantity: product.stock_quantity, unit: product.unit ?? "Adet" }) : t("inventory.selectCategoryHint")}</SheetDescription>
        </SheetHeader>
        {mode?.kind === "history" ? (
          <div className="px-4 pb-4">
            <FeedbackLine feedback={feedback} testId="inventory-sheet-feedback" />
            {movements && movements.length === 0 && <p className="text-sm text-muted-foreground">{t("inventory.historyEmpty")}</p>}
            <ul className="flex flex-col divide-y text-sm" data-testid="inventory-movements">
              {(movements ?? []).map((movement) => (
                <li key={movement.public_id} className="flex flex-col gap-0.5 py-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {t(movement.movement_type === "in" ? "inventory.movementIn" : movement.movement_type === "out" ? "inventory.movementOut" : "inventory.movementAdjustment")} · {movement.quantity}
                    </span>
                    <span className="text-muted-foreground">
                      {movement.previous_quantity} → {movement.new_quantity}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(movement.created_at, i18n.language)} · {movement.created_by_user_email ?? t("common.none")}
                    {movement.notes ? ` · ${movement.notes}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <form className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
            {mode?.kind === "in" || mode?.kind === "out" ? (
              <>
                <p className="text-sm text-muted-foreground sm:col-span-2">{t(mode.kind === "in" ? "inventory.hintStockIn" : "inventory.hintStockOut")}</p>
                {input("quantity", t("inventory.fieldQuantity"), { inputMode: "decimal" })}
                {input("description", t("inventory.fieldDescription"))}
              </>
            ) : (
              <>
                {input("name", t("inventory.fieldName"), { className: "sm:col-span-2" })}
                {input("sku", t("inventory.fieldCode"))}
                <Field label={t("inventory.fieldKolaybiMatch")}>
                  <Input list="beta-kolaybi-products" value={form.external} onChange={(event) => setForm((current) => ({ ...current, external: event.target.value }))} className="h-11 md:h-9" data-testid="product-external" />
                  <datalist id="beta-kolaybi-products">
                    {(kolaybi?.products ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name ?? item.id}
                      </option>
                    ))}
                  </datalist>
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground sm:col-span-2">
                  <span data-testid="product-kolaybi-info">
                    {kolaybi?.synced_at ? t("inventory.kolaybiListInfo", { count: kolaybi.total, date: formatDateTime(kolaybi.synced_at, i18n.language) }) : t("inventory.kolaybiListEmpty")}
                    {kolaybiNote ? ` · ${kolaybiNote}` : ""}
                  </span>
                  <Button type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={() => void refreshKolaybi()} data-testid="product-kolaybi-refresh">
                    {t("inventory.kolaybiListRefresh")}
                  </Button>
                </div>
                {input("quantity", t("inventory.fieldQuantity"), { inputMode: "decimal" })}
                <Field label={t("inventory.fieldUnit")}>
                  <NativeSelect value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value as ProductUnit }))} data-testid="product-unit">
                    {units.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {input("price", t("inventory.fieldUnitPrice"), { inputMode: "decimal" })}
                {input("description", t("inventory.fieldDescription"), { className: "sm:col-span-2" })}
              </>
            )}
            <div className="sm:col-span-2">
              <FeedbackLine feedback={feedback} testId="inventory-sheet-feedback" />
            </div>
            <Button type="submit" className="min-h-11 sm:col-span-2" disabled={saving} data-testid="inventory-submit">
              {saving ? t("inventory.saving") : mode?.kind === "in" || mode?.kind === "out" ? t("inventory.confirm") : t("inventory.save")}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
