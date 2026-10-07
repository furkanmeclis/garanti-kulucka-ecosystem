import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUp,
  Box,
  History,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type {
  KolaybiProductList,
  ProductCategory,
  ProductSummary,
  ProductUnit,
  StockMovementSummary,
  createDomainClient,
} from "../../api/domain-client.js";
import { localeFor, useLanguage, useT, type UiLanguage } from "../i18n/index.js";
import { inventoryMessages } from "../i18n/messages/inventory.js";

type DomainClient = ReturnType<typeof createDomainClient>;
type ModalMode = "create" | "edit" | "giris" | "cikis";
type StockStatusKey = "tukendi" | "kritik" | "normal";
type StockStatusFilter = "all" | StockStatusKey;
type InventoryKey = keyof (typeof inventoryMessages)["tr"];

/** Legacy StokPage thresholds: <=0 Tükendi, <10 Kritik, otherwise Normal. */
const LEGACY_CRITICAL_STOCK_LIMIT = 10;
const UNITS: ProductUnit[] = ["Adet", "Kg", "Lt", "Mt", "Koli"];

const CATEGORY_CARDS: Array<{
  key: ProductCategory;
  title: InventoryKey;
  subtitle: InventoryKey;
  icon: typeof Package;
  tone: string;
}> = [
  { key: "incubator", title: "categoryIncubatorTitle", subtitle: "categoryIncubatorSubtitle", icon: Package, tone: "blue" },
  { key: "spare_part", title: "categorySparePartTitle", subtitle: "categorySparePartSubtitle", icon: Settings, tone: "orange" },
  { key: "other", title: "categoryOtherTitle", subtitle: "categoryOtherSubtitle", icon: Box, tone: "slate" },
];

const MOVEMENT_LABELS: Record<StockMovementSummary["movement_type"], InventoryKey> = {
  in: "movementIn",
  out: "movementOut",
  adjustment: "movementAdjustment",
};

interface StockForm {
  code: string;
  name: string;
  quantity: string;
  unit: ProductUnit;
  unit_price: string;
  description: string;
  kolaybi_product_id: string;
}

const emptyForm: StockForm = {
  code: "",
  name: "",
  quantity: "0",
  unit: "Adet",
  unit_price: "0",
  description: "",
  kolaybi_product_id: "",
};

function productCategory(product: ProductSummary): ProductCategory {
  if (product.category === "incubator" || product.category === "spare_part" || product.category === "other") {
    return product.category;
  }
  const name = product.name.toLocaleLowerCase("tr");
  if (name.includes("kuluçka") || name.includes("makine")) return "incubator";
  if (
    name.includes("yedek") ||
    name.includes("parça") ||
    name.includes("termostat") ||
    name.includes("fan") ||
    name.includes("adaptör") ||
    name.includes("rezistans")
  ) {
    return "spare_part";
  }
  return "other";
}

function stockStatus(quantity: number): { key: StockStatusKey; label: InventoryKey } {
  if (quantity <= 0) return { key: "tukendi", label: "statusOutOfStock" };
  if (quantity < LEGACY_CRITICAL_STOCK_LIMIT) return { key: "kritik", label: "statusCritical" };
  return { key: "normal", label: "statusNormal" };
}

function formatPrice(value: string, language: UiLanguage) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString(localeFor(language), { minimumFractionDigits: 2 })
    : (0).toLocaleString(localeFor(language), { minimumFractionDigits: 2 });
}

function formatDate(value: string, language: UiLanguage) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(localeFor(language));
}

function normalizeMoney(value: string) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : null;
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function StokPage(props: { domain: DomainClient }) {
  const { domain } = props;
  const t = useT(inventoryMessages);
  const { language } = useLanguage();
  /** Latest translator for the loader, so a language switch does not re-create it (and refetch). */
  const tRef = useRef(t);
  tRef.current = t;
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<StockStatusFilter>("all");
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductSummary | null>(null);
  const [form, setForm] = useState<StockForm>(emptyForm);
  const [kolaybiList, setKolaybiList] = useState<KolaybiProductList | null>(null);
  const [kolaybiNote, setKolaybiNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [historyProduct, setHistoryProduct] = useState<ProductSummary | null>(null);
  const [movements, setMovements] = useState<StockMovementSummary[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await domain.listInventoryProducts({ active: "true", limit: 200 });
      setProducts(response.data);
    } catch {
      setNotice({ tone: "error", text: tRef.current("loadProductsError") });
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    const close = () => setActiveDropdown(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setModalMode(null);
      setHistoryProduct(null);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const categorized = useMemo(() => {
    const groups: Record<ProductCategory, ProductSummary[]> = { incubator: [], spare_part: [], other: [] };
    for (const product of products) {
      groups[productCategory(product)].push(product);
    }
    return groups;
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (!selectedCategory) return [];
    const term = debouncedSearch.trim().toLocaleLowerCase("tr");
    return categorized[selectedCategory].filter((product) => {
      const matchesSearch =
        !term ||
        product.name.toLocaleLowerCase("tr").includes(term) ||
        (product.sku ?? "").toLocaleLowerCase("tr").includes(term);
      const matchesStatus = statusFilter === "all" || stockStatus(product.stock_quantity).key === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [categorized, selectedCategory, debouncedSearch, statusFilter]);

  const criticalProducts = useMemo(
    () => products.filter((product) => product.stock_quantity < LEGACY_CRITICAL_STOCK_LIMIT),
    [products],
  );
  const outOfStockCount = criticalProducts.filter((product) => product.stock_quantity <= 0).length;

  const totalPrice = useMemo(() => {
    const quantity = Number.parseFloat(form.quantity);
    const price = Number.parseFloat(form.unit_price);
    return Number.isFinite(quantity) && Number.isFinite(price) ? (quantity * price).toFixed(2) : "";
  }, [form.quantity, form.unit_price]);

  const openModal = useCallback((mode: ModalMode, product: ProductSummary | null = null) => {
    setModalMode(mode);
    setSelectedProduct(product);
    setActiveDropdown(null);
    if (mode === "create" || !product) {
      setForm(emptyForm);
      return;
    }
    setForm({
      code: product.sku ?? "",
      name: product.name,
      quantity: mode === "edit" ? String(product.stock_quantity) : "",
      unit: product.unit ?? "Adet",
      unit_price: product.unit_price,
      description: mode === "edit" ? (product.description ?? "") : "",
      kolaybi_product_id: product.external_product_id ?? "",
    });
  }, []);

  const openHistory = useCallback(
    async (product: ProductSummary) => {
      setActiveDropdown(null);
      setHistoryProduct(product);
      setMovements([]);
      setMovementsLoading(true);
      try {
        const response = await domain.listProductStockMovements(product.public_id, 50);
        setMovements(response.data);
      } catch {
        setNotice({ tone: "error", text: t("loadMovementsError") });
      } finally {
        setMovementsLoading(false);
      }
    },
    [domain, t],
  );

  const handleDelete = useCallback(
    async (product: ProductSummary) => {
      setActiveDropdown(null);
      if (!window.confirm(t("confirmDelete", { name: product.name }))) return;
      try {
        await domain.deactivateProduct(product.public_id);
        setProducts((current) => current.filter((item) => item.public_id !== product.public_id));
        setNotice({ tone: "success", text: t("deleted", { name: product.name }) });
      } catch (error) {
        setNotice({ tone: "error", text: t("deleteFailed", { error: error instanceof Error ? error.message : t("unknownError") }) });
      }
    },
    [domain, t],
  );

  const handleSave = async () => {
    if (saving || !modalMode) return;
    const fail = (text: string) => setNotice({ tone: "error", text });

    if (modalMode === "giris" || modalMode === "cikis") {
      if (!selectedProduct) return;
      const quantity = Number.parseInt(form.quantity, 10) || 0;
      if (quantity <= 0) return fail(t("quantityMustBePositive"));
      const current = selectedProduct.stock_quantity;
      if (modalMode === "cikis" && current - quantity < 0) {
        return fail(t("insufficientStock", { current, quantity }));
      }
      setSaving(true);
      try {
        const result = await domain.createProductStockMovement(selectedProduct.public_id, {
          movement_type: modalMode === "giris" ? "in" : "out",
          quantity,
          notes: form.description.trim() || null,
        });
        setNotice({
          tone: "success",
          text: t("movementSaved", {
            movement: t(modalMode === "giris" ? "movementIn" : "movementOut"),
            quantity,
            unit: form.unit,
            stock: result.product.stock_quantity,
          }),
        });
        setModalMode(null);
        await fetchProducts();
      } catch (error) {
        fail(t("operationFailed", { error: error instanceof Error ? error.message : t("unknownError") }));
      } finally {
        setSaving(false);
      }
      return;
    }

    const name = form.name.trim();
    if (!name) return fail(t(modalMode === "create" ? "nameRequired" : "nameEmpty"));
    const unitPrice = normalizeMoney(form.unit_price || "0");
    if (unitPrice === null) return fail(t("invalidUnitPrice"));
    const quantityText = form.quantity.trim();
    const quantity = quantityText === "" ? null : Number.parseInt(quantityText, 10);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) return fail(t("quantityMustBeNonNegative"));

    setSaving(true);
    try {
      if (modalMode === "create") {
        await domain.createProduct({
          name,
          sku: form.code.trim() || null,
          unit: form.unit,
          unit_price: unitPrice,
          stock_quantity: quantity ?? 0,
          description: form.description.trim() || null,
          external_product_id: form.kolaybi_product_id.trim() || null,
        });
        setNotice({ tone: "success", text: t("cardCreated") });
      } else if (selectedProduct) {
        await domain.updateProduct(selectedProduct.public_id, {
          name,
          sku: form.code.trim() || selectedProduct.sku || null,
          unit: form.unit,
          unit_price: unitPrice,
          stock_quantity: quantity ?? selectedProduct.stock_quantity,
          description: form.description.trim() || null,
          external_product_id: form.kolaybi_product_id.trim() || null,
        });
        setNotice({ tone: "success", text: t("cardUpdated") });
      }
      setModalMode(null);
      await fetchProducts();
    } catch (error) {
      fail(t("operationFailed", { error: error instanceof Error ? error.message : t("unknownError") }));
    } finally {
      setSaving(false);
    }
  };

  const selectedCategoryCard = CATEGORY_CARDS.find((card) => card.key === selectedCategory) ?? null;
  const isStockMovement = modalMode === "giris" || modalMode === "cikis";
  const isCardEdit = modalMode === "create" || modalMode === "edit";

  useEffect(() => {
    if (!isCardEdit) return;
    setKolaybiNote(null);
    void domain
      .listKolaybiProducts()
      .then(setKolaybiList)
      .catch(() => setKolaybiList(null));
  }, [domain, isCardEdit]);

  async function refreshKolaybiList() {
    try {
      await domain.refreshKolaybiProducts();
      setKolaybiNote(t("kolaybiListQueued"));
      window.setTimeout(() => void domain.listKolaybiProducts().then(setKolaybiList).catch(() => undefined), 3000);
    } catch {
      setKolaybiNote(null);
    }
  }

  return (
    <section className="flow-panel stok-page" data-testid="inventory-flow">
      <div className="stok-header">
        <div className="stok-heading">
          {selectedCategory && (
            <button
              aria-label={t("backToCategories")}
              className="stok-icon-button"
              onClick={() => {
                setSelectedCategory(null);
                setSearch("");
                setStatusFilter("all");
              }}
              type="button"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div>
            <h1>{selectedCategoryCard ? t(selectedCategoryCard.title) : t("pageTitle")}</h1>
            <p>
              {selectedCategory
                ? t("listingCount", { count: filteredProducts.length })
                : t("selectCategoryHint")}
            </p>
          </div>
        </div>
        <div className="stok-actions">
          <button className="secondary-action" disabled={loading} onClick={() => void fetchProducts()} type="button">
            <RefreshCw className={loading ? "stok-spin" : undefined} size={16} /> {t("refresh")}
          </button>
          <button className="primary-action" onClick={() => openModal("create")} type="button">
            <Plus size={16} /> {t("newStock")}
          </button>
        </div>
      </div>

      {notice && (
        <div className={`stok-notice ${notice.tone}`} data-testid="stok-notice" role="status">
          <span>{notice.text}</span>
          <button aria-label={t("closeNotice")} onClick={() => setNotice(null)} type="button">
            <X size={14} />
          </button>
        </div>
      )}

      {!loading && criticalProducts.length > 0 && (
        <div className="stok-critical-warning" data-testid="stok-critical-warning" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>
              {t("criticalWarning", { count: criticalProducts.length })}
              {outOfStockCount > 0 ? t("criticalOutOfStock", { count: outOfStockCount }) : ""}
            </strong>
            <span>{criticalProducts.map((product) => `${product.name} (${product.stock_quantity})`).join(", ")}</span>
          </div>
        </div>
      )}

      {!selectedCategory && (
        <div className="stok-category-grid" data-testid="stok-categories">
          {CATEGORY_CARDS.map((card) => {
            const Icon = card.icon;
            const items = categorized[card.key];
            const total = items.reduce((sum, product) => sum + product.stock_quantity, 0);
            return (
              <button
                className={`stok-category-card ${card.tone}`}
                data-testid={`stok-category-${card.key}`}
                disabled={loading}
                key={card.key}
                onClick={() => setSelectedCategory(card.key)}
                type="button"
              >
                <span className="stok-category-icon">
                  <Icon size={22} />
                </span>
                <span className="stok-category-title">{t(card.title)}</span>
                <span className="stok-category-subtitle">{t(card.subtitle)}</span>
                <span className="stok-category-footer">
                  <span>
                    {loading ? "…" : t("productCount", { count: items.length })}
                    {!loading && <small>{t("unitCount", { count: total })}</small>}
                  </span>
                  <span>{t("inspect")}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selectedCategory && (
        <>
          <div className="stok-filter-bar">
            <label className="stok-search">
              <Search size={16} />
              <input
                aria-label={t("searchInCategory")}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchInCategoryPlaceholder")}
                type="text"
                value={search}
              />
              {search && (
                <button aria-label={t("clearSearch")} onClick={() => setSearch("")} type="button">
                  <X size={14} />
                </button>
              )}
            </label>
            <select
              aria-label={t("stockStatus")}
              className="inline-input"
              onChange={(event) => setStatusFilter(event.target.value as StockStatusFilter)}
              value={statusFilter}
            >
              <option value="all">{t("allStatuses")}</option>
              <option value="normal">{t("statusNormal")}</option>
              <option value="kritik">{t("statusCritical")}</option>
              <option value="tukendi">{t("statusOutOfStock")}</option>
            </select>
          </div>

          {loading ? (
            <p className="stok-empty">{t("loading")}</p>
          ) : filteredProducts.length === 0 ? (
            <div className="stok-empty" data-testid="stok-empty">
              <Package size={36} />
              <strong>{t("emptyTitle")}</strong>
              <span>{t("emptyDescription")}</span>
            </div>
          ) : (
            <div className="stok-product-grid" data-testid="stok-products">
              {filteredProducts.map((product) => {
                const status = stockStatus(product.stock_quantity);
                return (
                  <article
                    className="stok-product-card"
                    data-testid={`stok-product-${product.public_id}`}
                    key={product.public_id}
                    onClick={() => openModal("edit", product)}
                  >
                    <div className="stok-product-top">
                      <span className={`stok-badge ${status.key}`}>{t(status.label)}</span>
                      <div className="stok-menu">
                        <button
                          aria-label={t("productActions", { name: product.name })}
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveDropdown((current) => (current === product.public_id ? null : product.public_id));
                          }}
                          type="button"
                        >
                          <MoreVertical size={16} />
                        </button>
                        {activeDropdown === product.public_id && (
                          <div className="stok-menu-list" onClick={(event) => event.stopPropagation()} role="menu">
                            <button className="in" onClick={() => openModal("giris", product)} role="menuitem" type="button">
                              <ArrowUp size={15} /> {t("stockIn")}
                            </button>
                            <button className="out" onClick={() => openModal("cikis", product)} role="menuitem" type="button">
                              <ArrowDown size={15} /> {t("stockOut")}
                            </button>
                            <hr />
                            <button onClick={() => openModal("edit", product)} role="menuitem" type="button">
                              <ArrowRightLeft size={15} /> {t("edit")}
                            </button>
                            <button onClick={() => void openHistory(product)} role="menuitem" type="button">
                              <History size={15} /> {t("stockMovements")}
                            </button>
                            <button className="out" onClick={() => void handleDelete(product)} role="menuitem" type="button">
                              <Trash2 size={15} /> {t("delete")}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <h3 title={product.name}>{product.name}</h3>
                    <p className="stok-product-meta">
                      {t("productMeta", { code: product.sku || "-", unit: product.unit ?? "Adet" })}
                    </p>
                    <div className="stok-product-bottom">
                      <div>
                        <span>{t("currentStock")}</span>
                        <strong>{product.stock_quantity}</strong>
                      </div>
                      <div className="right">
                        <span>{t("salePrice")}</span>
                        <strong className="price">{formatPrice(product.unit_price, language)} ₺</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {modalMode && (
        <div className="stok-modal-backdrop" onClick={() => setModalMode(null)}>
          <div
            aria-labelledby="stok-modal-title"
            aria-modal="true"
            className="stok-modal"
            data-testid="stok-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <h2 id="stok-modal-title">
                {modalMode === "create"
                  ? t("modalCreateTitle")
                  : modalMode === "giris"
                    ? t("modalStockInTitle")
                    : modalMode === "cikis"
                      ? t("modalStockOutTitle")
                      : t("modalEditTitle")}
              </h2>
              <button aria-label={t("close")} onClick={() => setModalMode(null)} type="button">
                <X size={18} />
              </button>
            </header>
            <div className="stok-modal-body">
              {isStockMovement && selectedProduct && (
                <div className="stok-modal-product">
                  <strong>{selectedProduct.name}</strong>
                  <span>
                    {t("currentStockWithUnit", { quantity: selectedProduct.stock_quantity, unit: selectedProduct.unit ?? "Adet" })}
                  </span>
                </div>
              )}
              {isCardEdit && (
                <>
                  <label>
                    {t("fieldCode")}
                    <input
                      onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
                      type="text"
                      value={form.code}
                    />
                  </label>
                  <label>
                    {t("fieldName")}
                    <input
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      type="text"
                      value={form.name}
                    />
                  </label>
                  <label>
                    {t("fieldKolaybiMatch")}
                    <input
                      list="stok-kolaybi-products"
                      onChange={(event) => setForm((current) => ({ ...current, kolaybi_product_id: event.target.value }))}
                      placeholder={t("fieldKolaybiPlaceholder")}
                      type="text"
                      value={form.kolaybi_product_id}
                      data-testid="stok-kolaybi-id"
                    />
                    <datalist id="stok-kolaybi-products">
                      {(kolaybiList?.products ?? []).map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name ?? product.id}
                        </option>
                      ))}
                    </datalist>
                    <small>{t("fieldKolaybiHint")}</small>
                  </label>
                  <div className="stok-kolaybi-list">
                    <small data-testid="stok-kolaybi-info">
                      {kolaybiList?.synced_at
                        ? t("kolaybiListInfo", { count: kolaybiList.total, date: new Date(kolaybiList.synced_at).toLocaleString(localeFor(language)) })
                        : t("kolaybiListEmpty")}
                      {kolaybiNote ? ` · ${kolaybiNote}` : ""}
                    </small>
                    <button type="button" className="secondary-action" onClick={() => void refreshKolaybiList()} data-testid="stok-kolaybi-refresh">
                      {t("kolaybiListRefresh")}
                    </button>
                  </div>
                </>
              )}
              <div className="stok-modal-row">
                <label>
                  {t("fieldQuantity")}
                  <input
                    min={0}
                    onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                    type="number"
                    value={form.quantity}
                  />
                </label>
                <label>
                  {t("fieldUnit")}
                  <select
                    aria-label={t("fieldUnit")}
                    disabled={isStockMovement}
                    onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value as ProductUnit }))}
                    value={form.unit}
                  >
                    {UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="stok-modal-hint">
                {modalMode === "giris"
                  ? t("hintStockIn")
                  : modalMode === "cikis"
                    ? t("hintStockOut")
                    : t("hintEdit")}
              </div>
              {isCardEdit && (
                <div className="stok-modal-row">
                  <label>
                    {t("fieldUnitPrice")}
                    <input
                      min={0}
                      onChange={(event) => setForm((current) => ({ ...current, unit_price: event.target.value }))}
                      step="0.01"
                      type="number"
                      value={form.unit_price}
                    />
                  </label>
                  <label>
                    {t("fieldTotalPrice")}
                    <input readOnly type="number" value={totalPrice} />
                  </label>
                </div>
              )}
              <label>
                {t("fieldDescription")}
                <textarea
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  rows={3}
                  value={form.description}
                />
              </label>
            </div>
            <footer>
              <button className="secondary-action" onClick={() => setModalMode(null)} type="button">
                {t("cancel")}
              </button>
              <button
                className={modalMode === "cikis" ? "primary-action danger" : "primary-action"}
                disabled={saving}
                onClick={() => void handleSave()}
                type="button"
              >
                {saving ? <RefreshCw className="stok-spin" size={16} /> : <Save size={16} />}
                {saving ? t("saving") : modalMode === "create" ? t("save") : t("confirm")}
              </button>
            </footer>
          </div>
        </div>
      )}

      {historyProduct && (
        <div className="stok-modal-backdrop" onClick={() => setHistoryProduct(null)}>
          <div
            aria-labelledby="stok-history-title"
            aria-modal="true"
            className="stok-modal wide"
            data-testid="stok-history"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <h2 id="stok-history-title">{t("historyTitle", { name: historyProduct.name })}</h2>
              <button aria-label={t("close")} onClick={() => setHistoryProduct(null)} type="button">
                <X size={18} />
              </button>
            </header>
            <div className="stok-modal-body">
              {movementsLoading ? (
                <p className="stok-empty">{t("loading")}</p>
              ) : movements.length === 0 ? (
                <p className="stok-empty">{t("historyEmpty")}</p>
              ) : (
                <table className="stok-history-table">
                  <thead>
                    <tr>
                      <th>{t("columnDate")}</th>
                      <th>{t("columnOperation")}</th>
                      <th>{t("columnQuantity")}</th>
                      <th>{t("columnPreviousNew")}</th>
                      <th>{t("columnDescription")}</th>
                      <th>{t("columnUser")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr key={movement.public_id}>
                        <td>{formatDate(movement.created_at, language)}</td>
                        <td>
                          <span className={`stok-badge movement-${movement.movement_type}`}>
                            {t(MOVEMENT_LABELS[movement.movement_type])}
                          </span>
                        </td>
                        <td>{movement.quantity}</td>
                        <td>
                          {movement.previous_quantity} → {movement.new_quantity}
                        </td>
                        <td>{movement.notes ?? "-"}</td>
                        <td>{movement.created_by_user_email ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
