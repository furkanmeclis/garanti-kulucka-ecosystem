import { createHash } from "node:crypto";
import type { AppDatabase } from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";

/**
 * Legacy `ivrWebhookHandler` (server.js `/api/netgsm/webhook/sesli-mesaj`): NetGSM posts the result of the
 * teyit (IVR) call as JSON, form fields or query parameters. state 1 = answered, 2 = not answered,
 * 3 = unreachable, 6 = invalid number, 7 = busy; push_button 9 = cancel request.
 */

export interface IvrWebhookResult {
  bulkId: string;
  callStatus: "cevaplandi" | "cevaplanmadi" | "ulasilamadi" | "gecersiz_numara" | "mesgul";
  pressedKey: string | null;
  listenSeconds: number;
  confirmationStatus: "teyit_edildi" | "iptal_istegi" | "gecersiz_numara" | "ulasilamadi";
}

const stateMap: Record<string, IvrWebhookResult["callStatus"]> = {
  "1": "cevaplandi",
  "2": "cevaplanmadi",
  "3": "ulasilamadi",
  "6": "gecersiz_numara",
  "7": "mesgul",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Normalizes the three NetGSM payload shapes (JSON body, form body, query with `detail[push_button]`). */
export function ivrPayloadFrom(body: unknown, query: Record<string, string>): Record<string, unknown> {
  if (isRecord(body) && Object.keys(body).length > 0) return body;
  const payload: Record<string, unknown> = { ...query };
  if (query["detail[push_button]"]) payload.detail = { push_button: query["detail[push_button]"] };
  return payload;
}

/** null when the payload has no bulk id or an unknown state (legacy: log and answer 200). */
export function parseIvrWebhook(payload: Record<string, unknown>): IvrWebhookResult | null {
  const bulkId = text(payload.bulkid ?? payload.bulk_id ?? payload.bulkId);
  const callStatus = stateMap[text(payload.state) ?? ""];
  if (!bulkId || !callStatus) return null;
  const detail = isRecord(payload.detail) ? payload.detail : {};
  const pressedKey = text(payload.push_button ?? detail.push_button);
  const listenSeconds = Math.max(0, Number.parseInt(text(payload.bilsec) ?? "0", 10) || 0);
  const confirmationStatus: IvrWebhookResult["confirmationStatus"] =
    callStatus === "cevaplandi" ? (pressedKey === "9" ? "iptal_istegi" : "teyit_edildi") : callStatus === "gecersiz_numara" ? "gecersiz_numara" : "ulasilamadi";
  return { bulkId, callStatus, pressedKey, listenSeconds, confirmationStatus };
}

export class IvrWebhookRepository {
  constructor(private readonly db: AppDatabase) {}

  async webhookToken(): Promise<string | null> {
    const row = await this.db.selectFrom("settings").select(["value"]).where("scope", "=", "global").where("key", "=", "netgsm.ivr_webhook_token").executeTakeFirst();
    return typeof row?.value === "string" && row.value.trim() ? row.value.trim() : null;
  }

  /** Stores the raw callback like other provider webhooks (shown on the debug pages). */
  async recordEvent(payload: Record<string, unknown>, status: "processed" | "ignored") {
    const provider = await this.db.selectFrom("integration_providers").select("id").where("key", "=", "netgsm").executeTakeFirst();
    if (!provider) return;
    const raw = JSON.stringify(payload);
    await this.db
      .insertInto("webhook_events")
      .values({
        public_id: newPublicId("whe"),
        provider_id: provider.id,
        account_id: null,
        event_type: "call.confirmation.webhook",
        external_event_id: text(payload.bulkid) ?? null,
        status,
        payload_hash: createHash("sha256").update(raw).digest("hex"),
        raw_payload: raw,
        processed_at: new Date(),
      })
      .execute();
  }

  /** Applies the result to the order that owns the bulk id; null when no order has that bulk id. */
  async apply(result: IvrWebhookResult): Promise<{ public_id: string; status: string } | null> {
    const updated = await this.db
      .updateTable("orders")
      .set({
        confirmation_call_status: result.callStatus,
        confirmation_pressed_key: result.pressedKey,
        confirmation_listen_seconds: result.listenSeconds,
        confirmation_status: result.confirmationStatus,
        updated_at: new Date(),
      })
      .where("confirmation_call_bulk_id", "=", result.bulkId)
      .where("deleted_at", "is", null)
      .returning(["public_id", "status"])
      .executeTakeFirst();
    return updated ?? null;
  }
}
