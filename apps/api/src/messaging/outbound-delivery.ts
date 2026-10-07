import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema, type JobEnvelope } from "@garanti-kulucka/shared";
import type { ConversationDeliveryTarget } from "../domain/repository.js";

export type OutboundProvider = "whatsapp" | "instagram" | "messenger";

export interface OutboundAttachment {
  file_public_id: string;
  original_name?: string | null | undefined;
}

export interface OutboundDeliveryPlan {
  provider: OutboundProvider;
  recipient: string;
  jobs: JobEnvelope[];
  skipped_attachments: number;
}

export type OutboundDeliverySkip = { provider: OutboundProvider | null; reason: "unsupported_channel" | "missing_recipient" | "empty_message" };

/** Legacy server.js sent panel replies straight to the channel; here they become provider-delivery jobs behind the live gate. */
export function outboundProviderForChannel(channel: string): OutboundProvider | null {
  const normalized = channel.trim().toLowerCase();
  if (normalized === "whatsapp") return "whatsapp";
  if (normalized === "instagram") return "instagram";
  if (normalized === "messenger" || normalized === "facebook") return "messenger";
  return null;
}

function recipientFor(provider: OutboundProvider, target: ConversationDeliveryTarget): string | null {
  if (provider === "whatsapp") {
    const digits = (target.customer_phone ?? target.external_thread_id ?? "").replace(/\D/g, "");
    if (digits.length < 10) return null;
    // Legacy normalisation: 05xx… → 905xx…, 5xx… → 905xx…
    if (digits.startsWith("0")) return `9${digits}`;
    if (digits.length === 10) return `90${digits}`;
    return digits;
  }
  const thread = target.external_thread_id?.trim();
  return thread ? thread : null;
}

function jobSuffix(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

export function planOutboundDelivery(input: {
  target: ConversationDeliveryTarget;
  messagePublicId: string;
  body: string | null;
  attachments: OutboundAttachment[];
  requestId: string | undefined;
  occurredAt?: string;
}): OutboundDeliveryPlan | OutboundDeliverySkip {
  const provider = outboundProviderForChannel(input.target.channel);
  if (!provider) return { provider: null, reason: "unsupported_channel" };
  const recipient = recipientFor(provider, input.target);
  if (!recipient) return { provider, reason: "missing_recipient" };
  const text = input.body?.trim() ?? "";
  const mediaAttachments = provider === "whatsapp" ? input.attachments : [];
  if (!text && mediaAttachments.length === 0) return { provider, reason: "empty_message" };

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const parts: Array<Record<string, unknown>> = [];
  if (mediaAttachments.length > 0) {
    // WhatsApp carries the text as the first media caption, the way the legacy panel sent media replies.
    mediaAttachments.forEach((attachment, index) => {
      parts.push({
        message: index === 0 ? text : "",
        attachment: {
          file_public_id: attachment.file_public_id,
          caption: index === 0 ? text : "",
          ...(attachment.original_name ? { filename: attachment.original_name } : {}),
        },
      });
    });
  } else {
    parts.push({ message: text });
  }

  const jobs = parts.map((part, index) => {
    const idempotencyKey = `panel_${input.messagePublicId}_${index}`;
    const suffix = jobSuffix(idempotencyKey);
    const payload = providerDeliveryJobPayloadSchema.parse({
      envelope: {
        request_id: `req_${suffix}`,
        provider,
        operation: "message.send",
        direction: "outbound",
        channel: provider,
        occurred_at: occurredAt,
        payload: {
          to: recipient,
          ...part,
          ...(provider === "whatsapp" ? {} : { human_agent: true }),
          conversation_public_id: input.target.public_id,
          message_public_id: input.messagePublicId,
          idempotency_key: idempotencyKey,
        },
        legacy_contract: { source: "server.js POST /api/mesajlar/gonder", legacy_event: "panel_message_send" },
      },
    });
    return jobEnvelopeSchema.parse({
      job_id: `job_${suffix}`,
      queue: "provider-delivery",
      name: `${provider}.message.send`,
      payload,
      requested_at: occurredAt,
      ...(input.requestId ? { request_id: input.requestId } : {}),
    });
  });

  return {
    provider,
    recipient,
    jobs,
    skipped_attachments: provider === "whatsapp" ? 0 : input.attachments.length,
  };
}
