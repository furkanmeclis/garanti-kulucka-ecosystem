import type { CustomerDetail } from "@garanti-kulucka/shared";
import { ArrowLeft, CheckCircle2, Loader2, MapPin, MessageCircle, Pencil, ShoppingCart, StickyNote } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { ErrorState, StatusBadge } from "@/components/data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/layout/page-header";
import { ApiError } from "@/lib/api";
import { channelLabel, formatDateTime, formatMoney } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { channelBrand, ProviderLabel } from "@/components/provider-label";
import { Textarea } from "@/components/ui/textarea";

type Feedback = { tone: "success" | "error"; text: string } | null;
const fields = ["full_name", "phone", "email", "username"] as const;
type Field = (typeof fields)[number];
const fieldLabelKey: Record<Field, "fullName" | "phone" | "email" | "username"> = {
  full_name: "fullName",
  phone: "phone",
  email: "email",
  username: "username",
};

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p
      role={feedback.tone === "error" ? "alert" : "status"}
      className={feedback.tone === "error" ? "text-sm text-destructive" : "flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300"}
      data-testid="customer-feedback"
    >
      {feedback.tone === "success" && <CheckCircle2 className="size-4" aria-hidden="true" />}
      {feedback.text}
    </p>
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** /musteriler/:id — customer card, edit form, notes and links to the customer's orders and conversations. */
export function CustomerDetailPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const { id = "" } = useParams();
  const query = useQuery(`customer:${id}`, () => api.getCustomer(id));
  const [detail, setDetail] = useState<CustomerDetail>();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<"profile" | "notes" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!query.data) return;
    setDetail(query.data);
    setNotes(query.data.customer.notes ?? "");
  }, [query.data]);

  if (query.error && !detail) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <section data-testid="page-customer-detail">
          <BackLink />
          <Card className="mt-4 p-8 text-center text-muted-foreground" data-testid="customer-not-found">
            {t("customerDetail.notFound")}
          </Card>
        </section>
      );
    }
    return (
      <section data-testid="page-customer-detail">
        <BackLink />
        <ErrorState onRetry={query.reload} />
      </section>
    );
  }

  if (!detail) {
    return (
      <section data-testid="page-customer-detail" aria-busy="true">
        <BackLink />
        <Skeleton className="mt-4 h-10 w-64" />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </section>
    );
  }

  const { customer } = detail;

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: Field) => String(form.get(name) ?? "").trim();
    setSaving("profile");
    setFeedback(null);
    try {
      const updated = await api.updateCustomer(id, {
        full_name: value("full_name"),
        phone: value("phone") || null,
        email: value("email") || null,
        username: value("username") || null,
      });
      setDetail((current) => (current ? { ...current, customer: { ...current.customer, ...updated } } : current));
      setEditing(false);
      setFeedback({ tone: "success", text: t("customerDetail.saved") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("customerDetail.saveFailed", { message: errorText(error) }) });
    } finally {
      setSaving(null);
    }
  }

  async function saveNotes() {
    setSaving("notes");
    setFeedback(null);
    try {
      const updated = await api.saveCustomerNotes(id, notes.trim() ? notes : null);
      setDetail((current) => (current ? { ...current, customer: { ...current.customer, ...updated } } : current));
      setFeedback({ tone: "success", text: t("customerDetail.notesSaved") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("customerDetail.saveFailed", { message: errorText(error) }) });
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="flex flex-col gap-4" data-testid="page-customer-detail">
      <BackLink />
      <PageHeader
        title={customer.full_name}
        {...(customer.phone || customer.email ? { description: customer.phone ?? customer.email ?? "" } : {})}
        actions={
          !editing && (
            <Button variant="outline" onClick={() => setEditing(true)} data-testid="customer-edit">
              <Pencil aria-hidden="true" />
              {t("customerDetail.edit")}
            </Button>
          )
        }
      />
      <FeedbackLine feedback={feedback} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="customer-profile">
          <CardHeader>
            <CardTitle>{t("customerDetail.profile")}</CardTitle>
          </CardHeader>
          <CardContent>
            {editing ? (
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitProfile} data-testid="customer-edit-form">
                {fields.map((field) => (
                  <div key={field} className="flex flex-col gap-2">
                    <Label htmlFor={`customer-${field}`}>{t(`customerDetail.${fieldLabelKey[field]}`)}</Label>
                    <Input
                      id={`customer-${field}`}
                      name={field}
                      type={field === "email" ? "email" : field === "phone" ? "tel" : "text"}
                      defaultValue={customer[field] ?? ""}
                      required={field === "full_name"}
                    />
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <Button type="submit" disabled={saving !== null} data-testid="customer-save">
                    {saving === "profile" && <Loader2 className="animate-spin" aria-hidden="true" />}
                    {saving === "profile" ? t("common.saving") : t("common.save")}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                    {t("customerDetail.cancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                {(["phone", "email", "username"] as const).map((field) => (
                  <div key={field} className="contents">
                    <dt className="text-muted-foreground">{t(`customerDetail.${field}`)}</dt>
                    <dd className="break-words">{customer[field] ?? t("common.none")}</dd>
                  </div>
                ))}
                <dt className="text-muted-foreground">{t("customerDetail.created")}</dt>
                <dd>{formatDateTime(customer.created_at, i18n.language)}</dd>
                <dt className="text-muted-foreground">{t("customerDetail.updated")}</dt>
                <dd>{formatDateTime(customer.updated_at, i18n.language)}</dd>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card data-testid="customer-notes">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <StickyNote className="size-4" aria-hidden="true" />
              {t("customerDetail.notes")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              aria-label={t("customerDetail.notes")}
              className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
              placeholder={t("customerDetail.notesPlaceholder")}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              data-testid="customer-notes-input"
            />
            <div>
              <Button
                onClick={() => void saveNotes()}
                disabled={saving !== null || notes === (customer.notes ?? "")}
                data-testid="customer-notes-save"
              >
                {saving === "notes" && <Loader2 className="animate-spin" aria-hidden="true" />}
                {t("customerDetail.saveNotes")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="customer-addresses">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="size-4" aria-hidden="true" />
            {t("customerDetail.addresses")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {detail.addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("customerDetail.noAddresses")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {detail.addresses.map((address) => (
                <li key={address.public_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{address.label ?? address.city ?? t("common.none")}</span>
                  {address.is_default && <Badge tone="success">{t("customerDetail.defaultAddress")}</Badge>}
                  <span className="w-full text-muted-foreground">
                    {[address.address_line, address.district, address.city, address.postal_code].filter(Boolean).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="customer-orders">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="size-4" aria-hidden="true" />
              {t("customerDetail.orders", { count: detail.orders.length })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detail.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("customerDetail.noOrders")}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {detail.orders.map((order) => (
                  <li key={order.public_id}>
                    <Link
                      to={`/siparisler?q=${encodeURIComponent(order.order_number)}`}
                      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm hover:bg-muted/40"
                      data-testid="customer-order-link"
                    >
                      <span className="font-medium text-primary">{order.order_number}</span>
                      <StatusBadge value={order.status} />
                      <span className="ml-auto tabular-nums">{formatMoney(order.total_amount, order.currency, i18n.language)}</span>
                      <span className="w-full text-xs text-muted-foreground">{formatDateTime(order.created_at, i18n.language)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card data-testid="customer-conversations">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="size-4" aria-hidden="true" />
              {t("customerDetail.conversations", { count: detail.conversations.length })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detail.conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("customerDetail.noConversations")}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {detail.conversations.map((conversation) => (
                  <li key={conversation.public_id}>
                    <Link
                      to={`/mesajlar?konusma=${encodeURIComponent(conversation.public_id)}`}
                      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm hover:bg-muted/40"
                      data-testid="customer-conversation-link"
                    >
                      <span className="font-medium text-primary">
                        <ProviderLabel brand={channelBrand(conversation.channel)}>{channelLabel(conversation.channel)}</ProviderLabel>
                      </span>
                      {conversation.unread_count > 0 && <Badge tone="info">{t("customerDetail.unread", { count: conversation.unread_count })}</Badge>}
                      <span className="w-full truncate text-muted-foreground">{conversation.last_message_text ?? t("common.none")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link to="/musteriler" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="customer-back">
      <ArrowLeft className="size-4" aria-hidden="true" />
      {t("customerDetail.back")}
    </Link>
  );
}
