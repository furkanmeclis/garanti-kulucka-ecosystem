import { XCircle } from "lucide-react";
import { cx } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { useUiMessageText } from "../../i18n/messages/status.js";

export function OrderCreateModal({ ctx }: { ctx: DashboardController }) {
  const orderFormText = useUiMessageText();
  const {
    handleSubmitOrderForm,
    orderForm,
    orderFormMessage,
    orderFormSubmitting,
    setOrderForm,
    setOrderFormOpen,
  } = ctx;

  return (
    <div className="order-form-backdrop" data-testid="order-create-modal">
            <form
              className="order-form-modal"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmitOrderForm();
              }}
            >
              <div className="order-form-header">
                <h2>Sipariş Oluştur</h2>
                <button className="secondary-action icon-only" type="button" onClick={() => setOrderFormOpen(false)} aria-label="Kapat">
                  <XCircle size={16} aria-hidden="true" />
                </button>
              </div>
              {orderFormMessage && <div className="order-form-message" data-testid="order-form-message">{orderFormText(orderFormMessage)}</div>}
              <div className="order-form-grid">
                <label>
                  <span>İsim</span>
                  <input className="inline-input" data-testid="order-form-name" value={orderForm.customer_name} onChange={(event) => setOrderForm((current) => ({ ...current, customer_name: event.target.value }))} />
                </label>
                <label>
                  <span>Telefon</span>
                  <input className="inline-input" data-testid="order-form-phone" value={orderForm.customer_phone} onChange={(event) => setOrderForm((current) => ({ ...current, customer_phone: event.target.value }))} />
                </label>
                <label>
                  <span>Şehir</span>
                  <input className="inline-input" data-testid="order-form-city" value={orderForm.city} onChange={(event) => setOrderForm((current) => ({ ...current, city: event.target.value }))} />
                </label>
                <label>
                  <span>İlçe</span>
                  <input className="inline-input" data-testid="order-form-district" value={orderForm.district} onChange={(event) => setOrderForm((current) => ({ ...current, district: event.target.value }))} />
                </label>
              </div>
              <label className="order-form-full">
                <span>Adres</span>
                <textarea className="inline-input" data-testid="order-form-address" rows={2} value={orderForm.address_line} onChange={(event) => setOrderForm((current) => ({ ...current, address_line: event.target.value }))} />
              </label>
              <div className="order-form-cargo" data-testid="order-form-cargo">
                <span>Kargo</span>
                <button className={cx("secondary-action", orderForm.cargo_provider === "ptt" && "selected")} type="button" onClick={() => setOrderForm((current) => ({ ...current, cargo_provider: "ptt" }))}>PTT Kargo</button>
                <button className={cx("secondary-action", orderForm.cargo_provider === "surat" && "selected")} type="button" onClick={() => setOrderForm((current) => ({ ...current, cargo_provider: "surat" }))}>Sürat Kargo</button>
              </div>
              <button className="primary-action order-form-submit" data-testid="order-form-submit" disabled={orderFormSubmitting} type="submit">
                {orderFormSubmitting ? "Oluşturuluyor..." : "Sipariş Oluştur"}
              </button>
            </form>
          </div>
  );
}

