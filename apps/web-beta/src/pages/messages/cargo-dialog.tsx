import type { ShipmentSummary } from "@garanti-kulucka/shared";
import { Loader2, MapPin, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { BrandIcon } from "@/components/brand-icons";
import { Tip } from "@/components/ui/tooltip";
import { humanize } from "@/lib/chat";
import { formatDateTime } from "@/lib/format";
import { statusKey, statusTone } from "@/lib/status";
import { errorText, idempotencyKey } from "../accounting-shared";
import { ChatDialog, LegacyBadge, useChatToast } from "./chat-ui";
import { chatTipClass } from "./top-bar";

/** Legacy KargoTakipModal: shipment summary, provider query and the movement history. */
export function CargoDialog({ shipmentPublicId, onClose }: { shipmentPublicId: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const toast = useChatToast();
  const [shipment, setShipment] = useState<ShipmentSummary | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    setShipment(null);
    setFailed(null);
    if (!shipmentPublicId) return;
    let active = true;
    api
      .getShipment(shipmentPublicId)
      .then((row) => active && setShipment(row))
      .catch((error: unknown) => active && setFailed(errorText(error)));
    return () => {
      active = false;
    };
  }, [api, shipmentPublicId]);

  async function track() {
    if (!shipment) return;
    setTracking(true);
    try {
      await api.trackShipment(shipment.public_id, idempotencyKey(`track_${shipment.public_id}`));
      toast.success(t("chat.trackQueued"));
    } catch (error) {
      toast.error(t("chat.failed", { error: errorText(error) }));
    } finally {
      setTracking(false);
    }
  }

  const provider = (shipment?.provider ?? "").toLowerCase().includes("ptt") ? "ptt" : "surat";
  const statusLabel = (value: string) => {
    const key = statusKey(value);
    return key ? t(`status.${key}` as "status.delivered") : humanize(value);
  };

  return (
    <ChatDialog
      open={shipmentPublicId !== null}
      onClose={onClose}
      icon={<MapPin className="size-5 text-msg-muted" aria-hidden="true" />}
      title={t("chat.cargoTitle")}
      testId="cargo-dialog"
      footer={
        <button
          type="button"
          onClick={() => void track()}
          disabled={!shipment?.tracking_number || tracking}
          className="flex items-center gap-1.5 rounded-lg bg-msg-primary px-4 py-2 text-sm font-medium text-msg-on-primary hover:bg-msg-primary/90 disabled:opacity-50"
          data-testid="cargo-track"
        >
          <RefreshCw className={tracking ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
          {t("chat.track")}
        </button>
      }
    >
      {failed ? (
        <p className="text-sm text-red-600 dark:text-red-400">{failed}</p>
      ) : !shipment ? (
        <div className="flex items-center justify-center gap-2 py-6">
          <Loader2 className="size-4 animate-spin text-msg-muted" aria-hidden="true" />
          <span className="text-xs text-msg-muted">{t("chat.loading")}</span>
        </div>
      ) : (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-mono text-sm text-msg-fg-strong">
              <BrandIcon brand={provider} className="size-5" />
              {shipment.tracking_number ?? shipment.barcode_number ?? "-"}
            </span>
            <Tip label={t("chat.shipmentStatusHint", { status: statusLabel(shipment.status) })} className={chatTipClass}>
              <span tabIndex={0} className="inline-flex shrink-0">
                <LegacyBadge tone={statusTone(shipment.status)}>{statusLabel(shipment.status)}</LegacyBadge>
              </span>
            </Tip>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
            <span className="text-msg-subtle">{t("chat.recipient")}</span>
            <span className="text-msg-fg-soft">{shipment.recipient_name ?? "-"}</span>
            <span className="text-msg-subtle">{t("chat.city")}</span>
            <span className="text-msg-fg-soft">{[shipment.recipient_city, shipment.recipient_district].filter(Boolean).join(" / ") || "-"}</span>
            <span className="text-msg-subtle">{t("chat.lastEvent")}</span>
            <span className="text-msg-fg-soft">{shipment.last_event_text ?? "-"}</span>
          </div>
          <section className="space-y-2 border-t border-msg-border pt-3" data-testid="cargo-history">
            <h4 className="text-[10px] font-semibold tracking-wide text-msg-muted uppercase">{t("chat.history")}</h4>
            {(shipment.tracking_events ?? []).length === 0 ? (
              <p className="text-msg-subtle">{t("chat.noEvents")}</p>
            ) : (
              <ol className="space-y-2">
                {shipment.tracking_events!.map((event) => (
                  <li key={event.public_id} className="border-l-2 border-msg-primary/40 pl-3">
                    <p className="font-medium text-msg-fg">{event.description ?? statusLabel(event.status)}</p>
                    <p className="text-[10px] text-msg-subtle">
                      {event.location ?? "-"} · {formatDateTime(event.occurred_at, i18n.language)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </ChatDialog>
  );
}
