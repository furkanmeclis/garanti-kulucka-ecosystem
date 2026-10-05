import { useCallback, useEffect, useMemo, useState } from "react";
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
  ProductCategory,
  ProductSummary,
  ProductUnit,
  StockMovementSummary,
  createDomainClient,
} from "../../api/domain-client.js";

type DomainClient = ReturnType<typeof createDomainClient>;
type ModalMode = "create" | "edit" | "giris" | "cikis";
type StockStatusKey = "tukendi" | "kritik" | "normal";
type StockStatusFilter = "all" | StockStatusKey;

/** Legacy StokPage thresholds: <=0 Tükendi, <10 Kritik, otherwise Normal. */
const LEGACY_CRITICAL_STOCK_LIMIT = 10;
const UNITS: ProductUnit[] = ["Adet", "Kg", "Lt", "Mt", "Koli"];

const CATEGORY_CARDS: Array<{
  key: ProductCategory;
  title: string;
  subtitle: string;
  icon: typeof Package;
  tone: string;
}> = [
  { key: "incubator", title: "Kuluçka Makineleri", subtitle: "Ana ürün grubu", icon: Package, tone: "blue" },
  { key: "spare_part", title: "Yedek Parçalar", subtitle: "Tamir ve bakım parçaları", icon: Settings, tone: "orange" },
  { key: "other", title: "Diğer Malzemeler", subtitle: "Sarf malzemeleri ve diğerleri", icon: Box, tone: "slate" },
];

const MOVEMENT_LABELS: Record<StockMovementSummary["movement_type"], string> = {
  in: "Giriş",
  out: "Çıkış",
  adjustment: "Düzeltme",
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

function stockStatus(quantity: number): { key: StockStatusKey; label: string } {
  if (quantity <= 0) return { key: "tukendi", label: "Tükendi" };
  if (quantity < LEGACY_CRITICAL_STOCK_LIMIT) return { key: "kritik", label: "Kritik" };
  return { key: "normal", label: "Normal" };
}

function formatPrice(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "0,00";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("tr-TR");
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
      setNotice({ tone: "error", text: "Stok verileri alınamadı" });
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
        setNotice({ tone: "error", text: "Stok hareketleri alınamadı" });
      } finally {
        setMovementsLoading(false);
      }
    },
    [domain],
  );

  const handleDelete = useCallback(
    async (product: ProductSummary) => {
      setActiveDropdown(null);
      if (!window.confirm(`"${product.name}" stok kartını silmek istediğinize emin misiniz?`)) return;
      try {
        await domain.deactivateProduct(product.public_id);
        setProducts((current) => current.filter((item) => item.public_id !== product.public_id));
        setNotice({ tone: "success", text: `"${product.name}" silindi` });
      } catch (error) {
        setNotice({ tone: "error", text: `Silinemedi: ${error instanceof Error ? error.message : "bilinmeyen hata"}` });
      }
    },
    [domain],
  );

  const handleSave = async () => {
    if (saving || !modalMode) return;
    const fail = (text: string) => setNotice({ tone: "error", text });

    if (modalMode === "giris" || modalMode === "cikis") {
      if (!selectedProduct) return;
      const quantity = Number.parseInt(form.quantity, 10) || 0;
      if (quantity <= 0) return fail("Miktar 0'dan büyük olmalı");
      const current = selectedProduct.stock_quantity;
      if (modalMode === "cikis" && current - quantity < 0) {
        return fail(`Yetersiz stok! Mevcut: ${current}, Çıkış: ${quantity}`);
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
          text: `${modalMode === "giris" ? "Giriş" : "Çıkış"}: ${quantity} ${form.unit} → Yeni stok: ${result.product.stock_quantity}`,
        });
        setModalMode(null);
        await fetchProducts();
      } catch (error) {
        fail(`İşlem sırasında hata oluştu: ${error instanceof Error ? error.message : "bilinmeyen hata"}`);
      } finally {
        setSaving(false);
      }
      return;
    }

    const name = form.name.trim();
    if (!name) return fail(modalMode === "create" ? "Ürün adı gerekli" : "Ürün adı boş olamaz");
    const unitPrice = normalizeMoney(form.unit_price || "0");
    if (unitPrice === null) return fail("Geçerli bir birim tutar giriniz");
    const quantityText = form.quantity.trim();
    const quantity = quantityText === "" ? null : Number.parseInt(quantityText, 10);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) return fail("Miktar 0 veya daha büyük olmalı");

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
        setNotice({ tone: "success", text: "Yeni stok kartı oluşturuldu" });
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
        setNotice({ tone: "success", text: "Stok kartı güncellendi" });
      }
      setModalMode(null);
      await fetchProducts();
    } catch (error) {
      fail(`İşlem sırasında hata oluştu: ${error instanceof Error ? error.message : "bilinmeyen hata"}`);
    } finally {
      setSaving(false);
    }
  };

  const selectedCategoryCard = CATEGORY_CARDS.find((card) => card.key === selectedCategory) ?? null;
  const isStockMovement = modalMode === "giris" || modalMode === "cikis";
  const isCardEdit = modalMode === "create" || modalMode === "edit";

  return (
    <section className="flow-panel stok-page" data-testid="inventory-flow">
      <div className="stok-header">
        <div className="stok-heading">
          {selectedCategory && (
            <button
              aria-label="Kategorilere dön"
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
            <h1>{selectedCategoryCard ? selectedCategoryCard.title : "Stok Kategorileri"}</h1>
            <p>
              {selectedCategory
                ? `Toplam ${filteredProducts.length} ürün listeleniyor`
                : "Stoklarınızı yönetmek için kategori seçiniz."}
            </p>
          </div>
        </div>
        <div className="stok-actions">
          <button className="secondary-action" disabled={loading} onClick={() => void fetchProducts()} type="button">
            <RefreshCw className={loading ? "stok-spin" : undefined} size={16} /> Yenile
          </button>
          <button className="primary-action" onClick={() => openModal("create")} type="button">
            <Plus size={16} /> Yeni Stok
          </button>
        </div>
      </div>

      {notice && (
        <div className={`stok-notice ${notice.tone}`} data-testid="stok-notice" role="status">
          <span>{notice.text}</span>
          <button aria-label="Bildirimi kapat" onClick={() => setNotice(null)} type="button">
            <X size={14} />
          </button>
        </div>
      )}

      {!loading && criticalProducts.length > 0 && (
        <div className="stok-critical-warning" data-testid="stok-critical-warning" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>
              Kritik stok uyarısı: {criticalProducts.length} ürün kritik seviyede
              {outOfStockCount > 0 ? `, ${outOfStockCount} ürün tükendi` : ""}
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
                <span className="stok-category-title">{card.title}</span>
                <span className="stok-category-subtitle">{card.subtitle}</span>
                <span className="stok-category-footer">
                  <span>
                    {loading ? "…" : `${items.length} Ürün`}
                    {!loading && <small> ({total} adet)</small>}
                  </span>
                  <span>İncele →</span>
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
                aria-label="Bu kategoride ara"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Bu kategoride ara..."
                type="text"
                value={search}
              />
              {search && (
                <button aria-label="Aramayı temizle" onClick={() => setSearch("")} type="button">
                  <X size={14} />
                </button>
              )}
            </label>
            <select
              aria-label="Stok durumu"
              className="inline-input"
              onChange={(event) => setStatusFilter(event.target.value as StockStatusFilter)}
              value={statusFilter}
            >
              <option value="all">Tüm Durumlar</option>
              <option value="normal">Normal</option>
              <option value="kritik">Kritik</option>
              <option value="tukendi">Tükendi</option>
            </select>
          </div>

          {loading ? (
            <p className="stok-empty">Yükleniyor...</p>
          ) : filteredProducts.length === 0 ? (
            <div className="stok-empty" data-testid="stok-empty">
              <Package size={36} />
              <strong>Bu kategoride ürün yok</strong>
              <span>Henüz bu kategoriye ait bir stok kartı eklenmemiş.</span>
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
                      <span className={`stok-badge ${status.key}`}>{status.label}</span>
                      <div className="stok-menu">
                        <button
                          aria-label={`${product.name} işlemleri`}
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
                              <ArrowUp size={15} /> Stok Giriş
                            </button>
                            <button className="out" onClick={() => openModal("cikis", product)} role="menuitem" type="button">
                              <ArrowDown size={15} /> Stok Çıkış
                            </button>
                            <hr />
                            <button onClick={() => openModal("edit", product)} role="menuitem" type="button">
                              <ArrowRightLeft size={15} /> Düzenle
                            </button>
                            <button onClick={() => void openHistory(product)} role="menuitem" type="button">
                              <History size={15} /> Stok Hareketleri
                            </button>
                            <button className="out" onClick={() => void handleDelete(product)} role="menuitem" type="button">
                              <Trash2 size={15} /> Sil
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <h3 title={product.name}>{product.name}</h3>
                    <p className="stok-product-meta">
                      Kod: {product.sku || "-"} | Birim: {product.unit ?? "Adet"}
                    </p>
                    <div className="stok-product-bottom">
                      <div>
                        <span>Mevcut Stok</span>
                        <strong>{product.stock_quantity}</strong>
                      </div>
                      <div className="right">
                        <span>Satış Fiyatı</span>
                        <strong className="price">{formatPrice(product.unit_price)} ₺</strong>
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
                  ? "Yeni Stok Kartı"
                  : modalMode === "giris"
                    ? "Stok Giriş İşlemi"
                    : modalMode === "cikis"
                      ? "Stok Çıkış İşlemi"
                      : "Stok Düzenle"}
              </h2>
              <button aria-label="Kapat" onClick={() => setModalMode(null)} type="button">
                <X size={18} />
              </button>
            </header>
            <div className="stok-modal-body">
              {isStockMovement && selectedProduct && (
                <div className="stok-modal-product">
                  <strong>{selectedProduct.name}</strong>
                  <span>
                    Mevcut Stok: {selectedProduct.stock_quantity} {selectedProduct.unit ?? "Adet"}
                  </span>
                </div>
              )}
              {isCardEdit && (
                <>
                  <label>
                    Stok Fiş Kodu / Kod
                    <input
                      onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
                      type="text"
                      value={form.code}
                    />
                  </label>
                  <label>
                    Ürün Adı *
                    <input
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      type="text"
                      value={form.name}
                    />
                  </label>
                  <label>
                    KolayBi Ürün Eşleştirme
                    <input
                      onChange={(event) => setForm((current) => ({ ...current, kolaybi_product_id: event.target.value }))}
                      placeholder="KolayBi ürün ID — boş: Eşleşme Yok"
                      type="text"
                      value={form.kolaybi_product_id}
                    />
                    <small>Fatura oluşturulurken bu KolayBi ürün ID'si kullanılır</small>
                  </label>
                </>
              )}
              <div className="stok-modal-row">
                <label>
                  Miktar *
                  <input
                    min={0}
                    onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                    type="number"
                    value={form.quantity}
                  />
                </label>
                <label>
                  Birim
                  <select
                    aria-label="Birim"
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
                  ? "Gireceğiniz miktar mevcut stoğun üzerine eklenecektir."
                  : modalMode === "cikis"
                    ? "Gireceğiniz miktar mevcut stoktan düşülecektir."
                    : "Mevcut stok miktarını güncelliyorsunuz."}
              </div>
              {isCardEdit && (
                <div className="stok-modal-row">
                  <label>
                    Birim Tutar
                    <input
                      min={0}
                      onChange={(event) => setForm((current) => ({ ...current, unit_price: event.target.value }))}
                      step="0.01"
                      type="number"
                      value={form.unit_price}
                    />
                  </label>
                  <label>
                    Toplam Tutar
                    <input readOnly type="number" value={totalPrice} />
                  </label>
                </div>
              )}
              <label>
                Açıklama
                <textarea
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  rows={3}
                  value={form.description}
                />
              </label>
            </div>
            <footer>
              <button className="secondary-action" onClick={() => setModalMode(null)} type="button">
                İptal
              </button>
              <button
                className={modalMode === "cikis" ? "primary-action danger" : "primary-action"}
                disabled={saving}
                onClick={() => void handleSave()}
                type="button"
              >
                {saving ? <RefreshCw className="stok-spin" size={16} /> : <Save size={16} />}
                {saving ? "Kaydediliyor..." : modalMode === "create" ? "Kaydet" : "Onayla"}
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
              <h2 id="stok-history-title">Stok Hareketleri — {historyProduct.name}</h2>
              <button aria-label="Kapat" onClick={() => setHistoryProduct(null)} type="button">
                <X size={18} />
              </button>
            </header>
            <div className="stok-modal-body">
              {movementsLoading ? (
                <p className="stok-empty">Yükleniyor...</p>
              ) : movements.length === 0 ? (
                <p className="stok-empty">Bu ürün için stok hareketi bulunmuyor.</p>
              ) : (
                <table className="stok-history-table">
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>İşlem</th>
                      <th>Miktar</th>
                      <th>Önceki → Yeni</th>
                      <th>Açıklama</th>
                      <th>Kullanıcı</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr key={movement.public_id}>
                        <td>{formatDate(movement.created_at)}</td>
                        <td>
                          <span className={`stok-badge movement-${movement.movement_type}`}>
                            {MOVEMENT_LABELS[movement.movement_type]}
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
