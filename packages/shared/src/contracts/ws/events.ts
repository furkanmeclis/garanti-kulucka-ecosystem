import { z } from "zod";

const publicIdSchema = z.string().min(1).regex(/^[a-z]{3}_[A-Za-z0-9_-]+$/);

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

export const realtimeRoomTypeSchema = z.enum(["broadcast", "user", "conversation", "order", "shipment"]);

export const realtimeRoomSchema = z.union([
  z.literal("broadcast"),
  z.templateLiteral(["user:", publicIdSchema]),
  z.templateLiteral(["conversation:", publicIdSchema]),
  z.templateLiteral(["order:", publicIdSchema]),
  z.templateLiteral(["shipment:", publicIdSchema]),
]);

export const conversationCreatedPayloadSchema = z.object({
  conversation_public_id: publicIdSchema,
  channel: z.string().min(1),
});

export const conversationAssignedPayloadSchema = z.object({
  conversation_public_id: publicIdSchema,
  assigned_user_public_id: publicIdSchema.nullable(),
});

export const messageCreatedPayloadSchema = z.object({
  message_public_id: publicIdSchema,
  conversation_public_id: publicIdSchema,
  sender_type: z.string().min(1),
});

export const messageReadPayloadSchema = z.object({
  message_public_id: publicIdSchema,
  conversation_public_id: publicIdSchema,
  reader_user_public_id: publicIdSchema,
});

export const orderChangedPayloadSchema = z.object({
  order_public_id: publicIdSchema,
  status: z.string().min(1),
});

export const shipmentUpdatedPayloadSchema = z.object({
  shipment_public_id: publicIdSchema,
  status: z.string().min(1),
  tracking_number: z.string().min(1).nullable(),
});

export const presenceUpdatedPayloadSchema = z.object({
  user_public_id: publicIdSchema,
  status: z.enum(["online", "away", "offline"]),
});

export const settingsChangedPayloadSchema = z.object({
  scope: z.string().min(1),
  key: z.string().min(1),
});

export const realtimePayloadSchemaByEvent = {
  "conversation.created": conversationCreatedPayloadSchema,
  "conversation.assigned": conversationAssignedPayloadSchema,
  "message.created": messageCreatedPayloadSchema,
  "message.read": messageReadPayloadSchema,
  "order.created": orderChangedPayloadSchema,
  "order.updated": orderChangedPayloadSchema,
  "shipment.updated": shipmentUpdatedPayloadSchema,
  "presence.updated": presenceUpdatedPayloadSchema,
  "settings.changed": settingsChangedPayloadSchema,
} as const;

export const realtimeEnvelopeSchema = z.object({
  event: realtimeEventNameSchema,
  id: z.string().min(1),
  occurred_at: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
}).superRefine((envelope, context) => {
  const payloadSchema = realtimePayloadSchemaByEvent[envelope.event];
  const result = payloadSchema.safeParse(envelope.payload);
  if (!result.success) {
    context.addIssue({
      code: "custom",
      message: `Invalid payload for realtime event ${envelope.event}`,
      path: ["payload"],
    });
  }
});

export const realtimeClientCommandNameSchema = z.enum(["conversation.join", "conversation.leave"]);

export const realtimeClientCommandSchema = z.object({
  command: realtimeClientCommandNameSchema,
  conversation_public_id: publicIdSchema,
});

export type RealtimeEventName = z.infer<typeof realtimeEventNameSchema>;
export type RealtimeRoom = z.infer<typeof realtimeRoomSchema>;
export type RealtimeEnvelope = z.infer<typeof realtimeEnvelopeSchema>;
export type RealtimeClientCommandName = z.infer<typeof realtimeClientCommandNameSchema>;
export type RealtimeClientCommand = z.infer<typeof realtimeClientCommandSchema>;

export function realtimeUserRoom(userPublicId: string): RealtimeRoom {
  return realtimeRoomSchema.parse(`user:${userPublicId}`);
}

export function realtimeConversationRoom(conversationPublicId: string): RealtimeRoom {
  return realtimeRoomSchema.parse(`conversation:${conversationPublicId}`);
}

export function realtimeOrderRoom(orderPublicId: string): RealtimeRoom {
  return realtimeRoomSchema.parse(`order:${orderPublicId}`);
}

export function realtimeShipmentRoom(shipmentPublicId: string): RealtimeRoom {
  return realtimeRoomSchema.parse(`shipment:${shipmentPublicId}`);
}

export function parseRealtimeEnvelope(input: unknown): RealtimeEnvelope {
  return realtimeEnvelopeSchema.parse(input);
}
