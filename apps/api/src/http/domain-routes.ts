import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import {
  DomainRepository,
  type ListShipmentsFilter,
  serializeConversation,
  serializeCustomer,
  serializeMessage,
  serializeOrder,
  serializeProduct,
  serializeShipment,
} from "../domain/repository.js";

const limitSchema = z.coerce.number().int().min(1).max(200).default(50);

const createMessageSchema = z.object({
  sender_type: z.enum(["customer", "user", "ai", "system"]).default("user"),
  sender_name: z.string().min(1).nullable().default(null),
  body: z.string().nullable().default(null),
  external_message_id: z.string().min(1).nullable().default(null),
  raw_payload: z.unknown().nullable().default(null),
});

const updateConversationStateSchema = z
  .object({
    status: z.string().min(1).optional(),
    unread_count: z.number().int().min(0).optional(),
    human_agent_enabled: z.boolean().optional(),
    is_in_pool: z.boolean().optional(),
    assign_to_me: z.boolean().optional(),
  })
  .refine((payload) => Object.values(payload).some((value) => value !== undefined), {
    message: "At least one conversation state field is required",
  });

const createOrderSchema = z.object({
  customer_public_id: z.string().min(1).nullable().default(null),
  conversation_public_id: z.string().min(1).nullable().default(null),
  order_number: z.string().min(1),
  status: z.string().min(1).default("draft"),
  source: z.string().min(1).default("manual"),
  total_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().min(3).max(3).default("TRY"),
  notes: z.string().nullable().default(null),
});

const updateShipmentStatusSchema = z.object({
  status: z.string().min(1),
  last_event_text: z.string().nullable().default(null),
  raw_payload: z.unknown().nullable().default(null),
});

function canReadCustomers(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

export function createDomainRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);

  routes.get("/conversations", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const assigned = context.req.query("assigned");
    const channel = context.req.query("channel");
    const status = context.req.query("status");
    const channels = channel?.includes(",")
      ? channel.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;
    const conversations = await new DomainRepository(db).listConversations({
      limit: limitSchema.parse(context.req.query("limit")),
      ...(assigned === "unassigned" ? { assignedUserId: null } : {}),
      ...(channels ? { channels } : channel ? { channel } : {}),
      ...(status ? { status } : {}),
    });

    return context.json({ data: conversations.map(serializeConversation) });
  });

  routes.get("/conversations/:conversation_public_id/messages", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const messages = await new DomainRepository(db).listMessages(
      context.req.param("conversation_public_id"),
      limitSchema.parse(context.req.query("limit")),
    );

    return context.json({ data: messages.map(serializeMessage) });
  });

  routes.get("/customers", async (context) => {
    if (!canReadCustomers(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Customer directory access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const customers = await new DomainRepository(db).listCustomers(limitSchema.parse(context.req.query("limit")));
    return context.json({ data: customers.map(serializeCustomer) });
  });

  routes.post("/conversations/:conversation_public_id/messages", async (context) => {
    const payload = createMessageSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid message payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const message = await new DomainRepository(db).createMessage({
      conversationPublicId: context.req.param("conversation_public_id"),
      senderType: payload.data.sender_type,
      senderName: payload.data.sender_name,
      body: payload.data.body,
      externalMessageId: payload.data.external_message_id,
      rawPayload: payload.data.raw_payload,
    });
    const messageCreatedEnvelope = {
      event: "message.created",
      id: `evt_${message.public_id}`,
      occurred_at: new Date().toISOString(),
      payload: {
        message_public_id: message.public_id,
        conversation_public_id: context.req.param("conversation_public_id"),
        sender_type: message.sender_type,
      },
    } as const;
    const realtimePublisher = context.get("realtimePublisher");
    realtimePublisher.publishToConversation(context.req.param("conversation_public_id"), messageCreatedEnvelope);
    realtimePublisher.broadcast(messageCreatedEnvelope);

    return context.json(serializeMessage(message), 201);
  });

  routes.patch("/conversations/:conversation_public_id/state", async (context) => {
    const payload = updateConversationStateSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid conversation state payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const actorUserId = context.get("actorUserId");
    if (payload.data.assign_to_me === true && !actorUserId) {
      return context.json({ error: { code: "forbidden", message: "Conversation assignment requires an authenticated user" } }, 403);
    }

    const conversation = await new DomainRepository(db).updateConversationState({
      conversationPublicId: context.req.param("conversation_public_id"),
      ...(payload.data.status !== undefined ? { status: payload.data.status } : {}),
      ...(payload.data.unread_count !== undefined ? { unreadCount: payload.data.unread_count } : {}),
      ...(payload.data.human_agent_enabled !== undefined ? { humanAgentEnabled: payload.data.human_agent_enabled } : {}),
      ...(payload.data.is_in_pool !== undefined ? { isInPool: payload.data.is_in_pool } : {}),
      ...(payload.data.assign_to_me !== undefined ? { assignedUserId: payload.data.assign_to_me ? actorUserId : null } : {}),
    });

    return context.json(serializeConversation(conversation));
  });

  routes.get("/orders", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const orderFilter = { limit: limitSchema.parse(context.req.query("limit")) };
    const status = context.req.query("status");
    const confirmationStatus = context.req.query("confirmation_status");
    const orders = await new DomainRepository(db).listOrders({
      ...orderFilter,
      ...(status ? { status } : {}),
      ...(confirmationStatus ? { confirmationStatus } : {}),
    });
    return context.json({ data: orders.map(serializeOrder) });
  });

  routes.get("/products", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const products = await new DomainRepository(db).listProducts(limitSchema.parse(context.req.query("limit")));
    return context.json({ data: products.map(serializeProduct) });
  });

  routes.post("/orders", async (context) => {
    const payload = createOrderSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid order payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const order = await new DomainRepository(db).createOrder({
      customerPublicId: payload.data.customer_public_id,
      conversationPublicId: payload.data.conversation_public_id,
      createdByUserId: context.get("actorUserId"),
      orderNumber: payload.data.order_number,
      status: payload.data.status,
      source: payload.data.source,
      totalAmount: payload.data.total_amount,
      currency: payload.data.currency,
      notes: payload.data.notes,
    });

    return context.json(serializeOrder(order), 201);
  });

  routes.get("/shipments", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const provider = context.req.query("provider");
    const shipmentFilter: ListShipmentsFilter = { limit: limitSchema.parse(context.req.query("limit")) };
    if (provider === "surat") {
      shipmentFilter.providers = ["surat", "Sürat"];
    } else if (provider === "other") {
      shipmentFilter.excludeProviders = ["ptt", "surat", "Sürat"];
    } else if (provider) {
      shipmentFilter.provider = provider;
    }
    const shipmentStatus = context.req.query("status");
    if (shipmentStatus) {
      shipmentFilter.status = shipmentStatus;
    }
    if (context.req.query("tracking_missing") === "true") {
      shipmentFilter.trackingMissing = true;
    }
    const shipments = await new DomainRepository(db).listShipments(shipmentFilter);
    return context.json({ data: shipments.map(serializeShipment) });
  });

  routes.patch("/shipments/:shipment_public_id/status", async (context) => {
    const payload = updateShipmentStatusSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid shipment status payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const shipment = await new DomainRepository(db).updateShipmentStatus({
      shipmentPublicId: context.req.param("shipment_public_id"),
      status: payload.data.status,
      lastEventText: payload.data.last_event_text,
      rawPayload: payload.data.raw_payload,
    });

    return context.json(serializeShipment(shipment));
  });

  return routes;
}
