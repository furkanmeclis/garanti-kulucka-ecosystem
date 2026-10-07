import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { assertProviderEnvelope } from "./registry.js";

export interface ProviderTransportPayload {
  provider: ProviderRequestEnvelope["provider"];
  operation: ProviderRequestEnvelope["operation"];
  direction: ProviderRequestEnvelope["direction"];
  channel: ProviderRequestEnvelope["channel"];
  request_id: string;
  body: Record<string, unknown>;
}

const forbiddenPayloadKeys = new Set([
  "access_token",
  "refresh_token",
  "authorization",
  "api_key",
  "apikey",
  "password",
  "secret",
]);

function assertNoSecretPayloadKeys(input: unknown, path: string[] = []): void {
  if (Array.isArray(input)) {
    input.forEach((item, index) => assertNoSecretPayloadKeys(item, [...path, String(index)]));
    return;
  }

  if (!input || typeof input !== "object") {
    return;
  }

  for (const [key, value] of Object.entries(input)) {
    const normalized = key.toLowerCase().replaceAll("-", "_");
    const currentPath = [...path, key];
    if (forbiddenPayloadKeys.has(normalized) || normalized.endsWith("_token")) {
      throw new Error(`Provider payload contains a secret-looking key: ${currentPath.join(".")}`);
    }
    assertNoSecretPayloadKeys(value, currentPath);
  }
}

function pick(payload: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(payload, key))
      .map((key) => [key, payload[key]]),
  );
}

function buildBody(envelope: ProviderRequestEnvelope): Record<string, unknown> {
  const payload = envelope.payload;

  switch (envelope.operation) {
    case "shipment.create":
      return {
        ...pick(payload, ["order_public_id", "idempotency_key"]),
        recipient: pick(payload, ["recipient_name", "recipient_phone"]),
      };
    case "shipment.track":
      return pick(payload, ["tracking_number"]);
    case "invoice.create":
      return pick(payload, ["order_public_id", "currency", "total_amount", "idempotency_key"]);
    case "invoice.get":
      return pick(payload, ["invoice_id", "document_id"]);
    case "invoice.e_document.create":
      return pick(payload, ["document_id", "invoice_id", "idempotency_key"]);
    case "invoice.e_document.cancel":
      return pick(payload, ["document_id", "invoice_id", "cancel_date", "cancel_time", "idempotency_key"]);
    case "contact.find":
      return pick(payload, ["identity_no", "email", "phone", "musteri_telefon"]);
    case "contact.create":
      return pick(payload, ["order_public_id", "musteri_ad", "name", "surname", "idempotency_key"]);
    case "contact.update":
      return pick(payload, ["contact_id", "contact_public_id", "name", "surname", "idempotency_key"]);
    case "invoice.payment.create":
      return pick(payload, ["document_id", "invoice_public_id", "payment_public_id", "amount", "idempotency_key"]);
    case "product.list":
      return pick(payload, ["per_page", "max_pages"]);
    case "call.confirmation.create":
      return pick(payload, ["order_public_id", "telefon", "phone", "idempotency_key"]);
    case "voice.message.send":
      return pick(payload, ["voice_message_public_id", "recipient_count", "audio_id", "ringtime", "idempotency_key"]);
    case "voice.message.report":
      return pick(payload, ["voice_message_public_id", "bulk_id"]);
    case "call.confirmation.status":
      return pick(payload, ["order_public_id", "bulk_id", "ivr_bulk_id"]);
    case "message.send":
      return pick(payload, [
        "conversation_public_id",
        "recipient_id",
        "message",
        "attachment",
        "idempotency_key",
      ]);
    case "message.webhook":
      return {
        object: payload.object,
        entry: Array.isArray(payload.entry) ? payload.entry : [],
      };
    case "sms.send":
      return pick(payload, ["recipient_phone", "message", "idempotency_key"]);
    case "call.create":
      return pick(payload, [
        "customer_phone",
        "customer_name",
        "cargo_provider",
        "tracking_number",
        "last_event_text",
        "idempotency_key",
      ]);
    case "call.get":
      return pick(payload, ["vapi_call_id", "call_public_id"]);
    case "call.report":
      return pick(payload, ["start_date", "stop_date"]);
    case "call.webhook":
      return pick(payload, ["type", "call"]);
    case "sip.config.sync":
      return pick(payload, ["user_public_id", "sip_username", "password_state"]);
    case "media.publish":
      return pick(payload, ["media_type", "image_url", "video_url", "caption", "idempotency_key"]);
    case "comment.reply":
    case "comment.private_reply":
      return pick(payload, ["comment_id", "message", "idempotency_key"]);
    case "comment.hide":
    case "comment.delete":
      return pick(payload, ["comment_id"]);
  }
}

export function buildProviderTransportPayload(
  envelope: ProviderRequestEnvelope,
): ProviderTransportPayload {
  assertProviderEnvelope(envelope, envelope.direction === "inbound" ? "webhook" : "delivery");
  assertNoSecretPayloadKeys(envelope.payload);

  return {
    provider: envelope.provider,
    operation: envelope.operation,
    direction: envelope.direction,
    channel: envelope.channel,
    request_id: envelope.request_id,
    body: buildBody(envelope),
  };
}
