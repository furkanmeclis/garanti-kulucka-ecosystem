import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, MapPin, MessageCircle, Pencil, ShoppingCart, StickyNote, User } from "lucide-react";
import type { CustomerDetail, createDomainClient } from "../../api/domain-client.js";
import { BackendRequestError } from "../../api/http-client.js";
import { formatMoney, orderStatusLabel } from "../app/shared.js";
import { localeFor, useLanguage, useT } from "../i18n/index.js";
import { customerDetailMessages } from "../i18n/messages/customerDetail.js";
import { ClickToCall } from "../softphone/Softphone.js";

type DomainClient = ReturnType<typeof createDomainClient>;
type LoadState = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; detail: CustomerDetail };
type Notice = { tone: "success" | "error"; text: string } | null;

interface EditDraft {
  full_name: string;
  phone: string;
  email: string;
  username: string;
}

function draftFrom(detail: CustomerDetail): EditDraft {
  return {
    full_name: detail.customer.full_name,
    phone: detail.customer.phone ?? "",
    email: detail.customer.email ?? "",
    username: detail.customer.username ?? "",
  };
}

function errorMessage(error: unknown) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: string } } | null;
    return body?.error?.message ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** /musteriler/:id — customer card with editing, notes and links to the customer's orders and conversations. */
export function CustomerDetailPage(props: {
  customerPublicId: string;
  domain: DomainClient;
  onBack: () => void;
  onOpenOrder: (orderNumber: string) => void;
  onOpenConversation: (conversationPublicId: string) => void;
  onCustomerUpdated?: () => void;
}) {
  const { customerPublicId, domain, onCustomerUpdated } = props;
  const t = useT(customerDetailMessages);
  const { language } = useLanguage();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>({ full_name: "", phone: "", email: "", username: "" });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<"profile" | "notes" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const detail = await domain.getCustomer(customerPublicId);
      setState({ kind: "ready", detail });
      setDraft(draftFrom(detail));
      setNotes(detail.customer.notes ?? "");
    } catch (error) {
      setState(error instanceof BackendRequestError && error.status === 404 ? { kind: "missing" } : { kind: "error" });
    }
  }, [customerPublicId, domain]);

  useEffect(() => {
    setEditing(false);
    setNotice(null);
    void load();
  }, [load]);

  const formatDateTime = (value: string | null) =>
    value ? new Date(value).toLocaleString(localeFor(language), { dateStyle: "medium", timeStyle: "short" }) : "-";

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (state.kind !== "ready") return;
    if (!draft.full_name.trim()) {
      setNotice({ tone: "error", text: t("nameRequired") });
      return;
    }
    setSaving("profile");
    setNotice(null);
    try {
      const customer = await domain.updateCustomer(customerPublicId, {
        full_name: draft.full_name.trim(),
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        username: draft.username.trim() || null,
      });
      setState({ kind: "ready", detail: { ...state.detail, customer: { ...state.detail.customer, ...customer } } });
      setEditing(false);
      setNotice({ tone: "success", text: t("saved") });
      onCustomerUpdated?.();
    } catch (error) {
      setNotice({ tone: "error", text: t("saveFailed", { message: errorMessage(error) }) });
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveNotes() {
    if (state.kind !== "ready") return;
    setSaving("notes");
    setNotice(null);
    try {
      const customer = await domain.saveCustomerProfileNotes(customerPublicId, notes.trim() ? notes : null);
      setState({ kind: "ready", detail: { ...state.detail, customer: { ...state.detail.customer, ...customer } } });
      setNotice({ tone: "success", text: t("notesSaved") });
      onCustomerUpdated?.();
    } catch (error) {
      setNotice({ tone: "error", text: t("saveFailed", { message: errorMessage(error) }) });
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="flow-panel customer-detail" data-testid="customer-detail">
      <button type="button" className="link-button customer-detail-back" onClick={props.onBack} data-testid="customer-detail-back">
        <ArrowLeft size={16} aria-hidden="true" />
        {t("back")}
      </button>

      {state.kind === "loading" && (
        <p className="muted-line" role="status">
          {t("loading")}
        </p>
      )}
      {state.kind === "missing" && (
        <p className="customer-detail-notice error" data-testid="customer-detail-missing">
          {t("notFound")}
        </p>
      )}
      {state.kind === "error" && (
        <p className="customer-detail-notice error" role="alert">
          {t("loadFailed")}
        </p>
      )}

      {state.kind === "ready" && (
        <>
          <h1>
            <User size={18} aria-hidden="true" />
            <span data-testid="customer-detail-name">{state.detail.customer.full_name}</span>
          </h1>
          {notice && (
            <p className={`customer-detail-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} data-testid="customer-detail-notice">
              {notice.text}
            </p>
          )}

          <div className="customer-detail-grid">
            <section className="detail-panel" data-testid="customer-detail-profile">
              <div className="customer-detail-heading">
                <h2>{t("profileTitle")}</h2>
                {!editing && (
                  <button type="button" className="secondary-action" onClick={() => setEditing(true)} data-testid="customer-edit">
                    <Pencil size={14} aria-hidden="true" />
                    {t("edit")}
                  </button>
                )}
              </div>
              {editing ? (
                <form className="customer-detail-form" onSubmit={handleSave} data-testid="customer-edit-form">
                  {(["full_name", "phone", "email", "username"] as const).map((field) => (
                    <label key={field}>
                      <span className="field-label">
                        {t(field === "full_name" ? "fullName" : field)}
                      </span>
                      <input
                        name={field}
                        type={field === "email" ? "email" : field === "phone" ? "tel" : "text"}
                        value={draft[field]}
                        required={field === "full_name"}
                        onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
                      />
                    </label>
                  ))}
                  <div className="customer-detail-actions">
                    <button type="submit" className="primary-action" disabled={saving !== null} data-testid="customer-save">
                      {saving === "profile" ? t("saving") : t("save")}
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => {
                        setEditing(false);
                        setDraft(draftFrom(state.detail));
                      }}
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <dl className="customer-detail-fields">
                  <dt>{t("phone")}</dt>
                  <dd>
                    {state.detail.customer.phone ?? "-"} <ClickToCall number={state.detail.customer.phone} />
                  </dd>
                  <dt>{t("email")}</dt>
                  <dd>{state.detail.customer.email ?? "-"}</dd>
                  <dt>{t("username")}</dt>
                  <dd>{state.detail.customer.username ?? "-"}</dd>
                  <dt>{t("createdAt")}</dt>
                  <dd>{formatDateTime(state.detail.customer.created_at)}</dd>
                  <dt>{t("updatedAt")}</dt>
                  <dd>{formatDateTime(state.detail.customer.updated_at)}</dd>
                </dl>
              )}
            </section>

            <section className="detail-panel" data-testid="customer-detail-notes">
              <h2>
                <StickyNote size={16} aria-hidden="true" /> {t("notesTitle")}
              </h2>
              <textarea
                className="customer-detail-notes"
                aria-label={t("notesTitle")}
                placeholder={t("notesPlaceholder")}
                rows={5}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                data-testid="customer-notes-input"
              />
              <div className="customer-detail-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={saving !== null || notes === (state.detail.customer.notes ?? "")}
                  onClick={() => void handleSaveNotes()}
                  data-testid="customer-notes-save"
                >
                  {saving === "notes" ? t("saving") : t("saveNotes")}
                </button>
              </div>
            </section>

            <section className="detail-panel" data-testid="customer-detail-addresses">
              <h2>
                <MapPin size={16} aria-hidden="true" /> {t("addressesTitle")}
              </h2>
              {state.detail.addresses.length === 0 ? (
                <p className="muted-line">{t("noAddresses")}</p>
              ) : (
                <ul className="customer-detail-list">
                  {state.detail.addresses.map((address) => (
                    <li key={address.public_id}>
                      <strong>{address.label ?? address.city ?? "-"}</strong>
                      {address.is_default && <span className="status-pill">{t("defaultAddress")}</span>}
                      <span className="muted-line">
                        {[address.address_line, address.district, address.city, address.postal_code].filter(Boolean).join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="detail-panel" data-testid="customer-detail-orders">
            <h2>
              <ShoppingCart size={16} aria-hidden="true" /> {t("ordersTitle", { count: state.detail.orders.length })}
            </h2>
            {state.detail.orders.length === 0 ? (
              <p className="muted-line">{t("noOrders")}</p>
            ) : (
              <ul className="customer-detail-list">
                {state.detail.orders.map((order) => (
                  <li key={order.public_id}>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => props.onOpenOrder(order.order_number)}
                      aria-label={`${t("openOrder")}: ${order.order_number}`}
                      data-testid="customer-order-link"
                    >
                      {order.order_number}
                    </button>
                    <span className="status-pill">{orderStatusLabel(order.status, language)}</span>
                    <span>{formatMoney(Number(order.total_amount), order.currency)}</span>
                    <span className="muted-line">{formatDateTime(order.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="detail-panel" data-testid="customer-detail-conversations">
            <h2>
              <MessageCircle size={16} aria-hidden="true" /> {t("conversationsTitle", { count: state.detail.conversations.length })}
            </h2>
            {state.detail.conversations.length === 0 ? (
              <p className="muted-line">{t("noConversations")}</p>
            ) : (
              <ul className="customer-detail-list">
                {state.detail.conversations.map((conversation) => (
                  <li key={conversation.public_id}>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => props.onOpenConversation(conversation.public_id)}
                      aria-label={`${t("openConversation")}: ${conversation.channel}`}
                      data-testid="customer-conversation-link"
                    >
                      {conversation.channel}
                    </button>
                    {conversation.unread_count > 0 && (
                      <span className="status-pill">{t("unread", { count: conversation.unread_count })}</span>
                    )}
                    <span>{conversation.last_message_text ?? "-"}</span>
                    <span className="muted-line">{formatDateTime(conversation.last_message_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
