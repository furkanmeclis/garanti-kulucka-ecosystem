import { z } from "zod";

export const providerNameSchema = z.enum([
  "ptt",
  "surat",
  "kolaybi",
  "meta",
  "whatsapp",
  "instagram",
  "messenger",
  "netgsm",
  "vapi",
  "sip",
]);

export const providerOperationSchema = z.enum([
  "shipment.create",
  "shipment.track",
  "invoice.create",
  "message.send",
  "message.webhook",
  "sms.send",
  "call.create",
  "call.webhook",
  "sip.config.sync",
]);

export const providerDirectionSchema = z.enum(["inbound", "outbound"]);

export const providerChannelSchema = z.enum([
  "cargo",
  "accounting",
  "whatsapp",
  "instagram",
  "messenger",
  "sms",
  "voice",
  "sip",
]);

export const providerLegacyContractSchema = z.object({
  source: z.string().min(1),
  fixture_name: z.string().min(1).optional(),
  legacy_event: z.string().min(1).optional(),
});

export const providerRequestEnvelopeSchema = z.object({
  request_id: z.string().min(1),
  provider: providerNameSchema,
  operation: providerOperationSchema,
  direction: providerDirectionSchema,
  channel: providerChannelSchema,
  account_public_id: z.string().min(1).optional(),
  occurred_at: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
  legacy_contract: providerLegacyContractSchema.optional(),
});

export const providerResponseEnvelopeSchema = z.object({
  request_id: z.string().min(1),
  provider: providerNameSchema,
  operation: providerOperationSchema,
  status: z.enum(["accepted", "ignored", "failed"]),
  occurred_at: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      retryable: z.boolean(),
    })
    .optional(),
});

export const providerWebhookJobPayloadSchema = z.object({
  envelope: providerRequestEnvelopeSchema.extend({
    direction: z.literal("inbound"),
  }),
});

export const providerDeliveryJobPayloadSchema = z.object({
  envelope: providerRequestEnvelopeSchema.extend({
    direction: z.literal("outbound"),
  }),
});

export const providerAttemptSchema = z.object({
  provider: providerNameSchema,
  operation: providerOperationSchema,
  direction: providerDirectionSchema,
  request_id: z.string().min(1),
  account_public_id: z.string().min(1).optional(),
  started_at: z.string().datetime(),
  duration_ms: z.number().int().nonnegative(),
  status: z.enum(["success", "retryable_failure", "terminal_failure"]),
  status_code: z.number().int().min(100).max(599).nullable(),
  retry_decision: z.enum(["none", "retry", "dead_letter"]),
  next_retry_at: z.string().datetime().nullable(),
  idempotency_key: z.string().min(1).nullable(),
  request_metadata: z.record(z.string(), z.unknown()),
  response_metadata: z.record(z.string(), z.unknown()),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .nullable(),
});

export type ProviderName = z.infer<typeof providerNameSchema>;
export type ProviderOperation = z.infer<typeof providerOperationSchema>;
export type ProviderDirection = z.infer<typeof providerDirectionSchema>;
export type ProviderChannel = z.infer<typeof providerChannelSchema>;
export type ProviderLegacyContract = z.infer<typeof providerLegacyContractSchema>;
export type ProviderRequestEnvelope = z.infer<typeof providerRequestEnvelopeSchema>;
export type ProviderResponseEnvelope = z.infer<typeof providerResponseEnvelopeSchema>;
export type ProviderWebhookJobPayload = z.infer<typeof providerWebhookJobPayloadSchema>;
export type ProviderDeliveryJobPayload = z.infer<typeof providerDeliveryJobPayloadSchema>;
export type ProviderAttempt = z.infer<typeof providerAttemptSchema>;
