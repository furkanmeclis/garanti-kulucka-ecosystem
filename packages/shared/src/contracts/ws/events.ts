import { z } from "zod";

export const realtimeEventNameSchema = z.enum([
  "conversation.created",
  "conversation.assigned",
  "message.created",
  "message.read",
  "order.created",
  "order.updated",
  "shipment.updated",
  "presence.updated",
  "settings.changed",
]);

export const realtimeEnvelopeSchema = z.object({
  event: realtimeEventNameSchema,
  id: z.string().min(1),
  occurred_at: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export type RealtimeEventName = z.infer<typeof realtimeEventNameSchema>;
export type RealtimeEnvelope = z.infer<typeof realtimeEnvelopeSchema>;
