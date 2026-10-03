import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import {
  DomainRepository,
  serializeConversation,
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
    const conversations = await new DomainRepository(db).listConversations({
      limit: limitSchema.parse(context.req.query("limit")),
      ...(assigned === "unassigned" ? { assignedUserId: null } : {}),
      ...(channel ? { channel } : {}),
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

    return context.json(serializeMessage(message), 201);
  });

  routes.get("/orders", async (context) => {
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const orders = await new DomainRepository(db).listOrders(limitSchema.parse(context.req.query("limit")));
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

    const shipments = await new DomainRepository(db).listShipments(limitSchema.parse(context.req.query("limit")));
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
