import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import {
  DomainRepository,
  type ListOrdersFilter,
  type ListShipmentsFilter,
  serializeConversation,
  serializeConversationSummary,
  serializeCustomer,
  serializeCustomerSummary,
  serializeMessage,
  serializeMessageShortcut,
  serializeOrder,
  serializeProduct,
  serializeProductSummary,
  serializeShipment,
  serializeShipmentSummary,
} from "../domain/repository.js";

const limitSchema = z.coerce.number().int().min(1).max(200).default(50);
const offsetSchema = z.coerce.number().int().min(0).default(0);
const orderSortSchema = z.enum(["created_at", "order_number", "status", "total_amount"]).default("created_at");
const sortDirectionSchema = z.enum(["asc", "desc"]).default("desc");

const createMessageSchema = z.object({
  sender_type: z.enum(["customer", "user", "ai", "system"]).default("user"),
  sender_name: z.string().min(1).nullable().default(null),
  body: z.string().nullable().default(null),
  external_message_id: z.string().min(1).nullable().default(null),
  raw_payload: z.unknown().nullable().default(null),
  attachments: z.array(z.object({
    file_public_id: z.string().min(1),
    attachment_type: z.enum(["image", "video", "document", "file"]),
  })).max(10).default([]),
});

const attachmentSchema = z.object({
  file_public_id: z.string().min(1),
  attachment_type: z.enum(["image", "video", "document", "file"]),
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

const updateNoteSchema = z.object({
  notes: z.string().max(10_000).nullable().default(null),
});

const createShortcutSchema = z.object({
  code: z.string().trim().min(1).max(64),
  message: z.string().max(10_000).nullable().default(null),
  type: z.enum(["default", "custom"]).default("custom"),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(100_000).default(999),
  attachments: z.array(attachmentSchema).max(10).default([]),
}).refine((payload) => Boolean(payload.message?.trim()) || payload.attachments.length > 0, {
  message: "Message or attachment is required",
});

const updateShortcutSchema = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  message: z.string().max(10_000).nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100_000).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
}).refine((payload) => Object.values(payload).some((value) => value !== undefined), {
  message: "At least one shortcut field is required",
});

const aiReplySuggestionSchema = z.object({
  conversation_public_id: z.string().min(1),
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

const updateOrderStatusSchema = z.object({
  status: z.string().min(1),
  notes: z.string().nullable().optional(),
});

const createPaymentRequestSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().min(3).max(3).default("TRY"),
  idempotency_key: z.string().min(1),
});

const updateShipmentStatusSchema = z.object({
  status: z.string().min(1),
  last_event_text: z.string().nullable().default(null),
  raw_payload: z.unknown().nullable().default(null),
});

const sendSmsSchema = z.object({
  recipient_phone: z.string().min(1),
  message: z.string().min(1).max(1000),
  idempotency_key: z.string().min(1),
  shipment_public_id: z.string().min(1),
});

function canReadCustomers(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

function canReadConversations(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

function canReadCommentModeration(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

function canReadInventory(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

function canReadOrders(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan" || role === "kargo_operatoru";
}

function canReadShipments(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan" || role === "kargo_operatoru";
}

function canReadBalanceSummary(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

function canReadShipmentPipeline(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan" || role === "kargo_operatoru";
}

function canReadReports(role: string | undefined) {
  return role === "admin";
}

function canSendSms(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan" || role === "kargo_operatoru";
}

function canRequestPayment(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

function canManageMessages(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

function jobIdFromIdempotencyKey(key: string) {
  return `job_${key.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96)}`;
}

function requestIdFromIdempotencyKey(prefix: string, key: string) {
  return `${prefix}_${key.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96)}`;
}

export function createDomainRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);

  routes.get("/conversations", async (context) => {
    if (!canReadConversations(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Conversation access is not allowed" } }, 403);
    }

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

  routes.get("/conversations/summary", async (context) => {
    if (!canReadConversations(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Conversation access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const summary = await new DomainRepository(db).getConversationSummary();
    return context.json(serializeConversationSummary(summary));
  });

  routes.get("/comments/moderation-summary", async (context) => {
    if (!canReadCommentModeration(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Comment moderation access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const conversations = await new DomainRepository(db).listConversations({ limit: 200 });
    const summary = conversations.reduce(
      (current, conversation) => {
        const channel = conversation.channel.toLocaleLowerCase("tr-TR");
        if (channel.includes("instagram")) current.instagram += 1;
        if (channel.includes("facebook") || channel.includes("messenger")) current.facebook += 1;
        if (conversation.status === "closed" || conversation.status === "resolved") {
          current.answered += 1;
        } else if (conversation.human_agent_enabled || conversation.unread_count > 0) {
          current.manual_queue += 1;
        } else if (conversation.is_in_pool) {
          current.automatic_queue += 1;
        }
        return current;
      },
      {
        manual_queue: 0,
        automatic_queue: 0,
        answered: 0,
        instagram: 0,
        facebook: 0,
      },
    );

    return context.json(summary);
  });

  routes.get("/reports/summary", async (context) => {
    if (!canReadReports(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Reports summary access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const summary = await new DomainRepository(db).getReportSummary();
    return context.json(summary);
  });

  routes.get("/conversations/:conversation_public_id/messages", async (context) => {
    if (!canReadConversations(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Conversation access is not allowed" } }, 403);
    }

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

  routes.get("/message-shortcuts", async (context) => {
    if (!canManageMessages(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Message shortcut access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const shortcuts = await new DomainRepository(db).listMessageShortcuts();
    return context.json({ data: shortcuts.map(serializeMessageShortcut) });
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

  routes.get("/customers/summary", async (context) => {
    if (!canReadCustomers(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Customer directory access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const summary = await new DomainRepository(db).getCustomerSummary();
    return context.json(serializeCustomerSummary(summary));
  });

  routes.post("/conversations/:conversation_public_id/messages", async (context) => {
    if (!canReadConversations(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Conversation access is not allowed" } }, 403);
    }

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
      attachments: payload.data.attachments.map((attachment) => ({
        filePublicId: attachment.file_public_id,
        attachmentType: attachment.attachment_type,
      })),
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

  routes.patch("/conversations/:conversation_public_id/notes", async (context) => {
    if (!canManageMessages(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Conversation notes access is not allowed" } }, 403);
    }

    const payload = updateNoteSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid conversation note payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const conversation = await new DomainRepository(db).updateConversationNotes({
      conversationPublicId: context.req.param("conversation_public_id"),
      notes: payload.data.notes,
    });
    return context.json(serializeConversation(conversation));
  });

  routes.patch("/conversations/:conversation_public_id/customer-notes", async (context) => {
    if (!canManageMessages(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Customer notes access is not allowed" } }, 403);
    }

    const payload = updateNoteSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid customer note payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const customer = await new DomainRepository(db).updateCustomerNotes({
      conversationPublicId: context.req.param("conversation_public_id"),
      notes: payload.data.notes,
    });
    return context.json(serializeCustomer(customer));
  });

  routes.post("/message-shortcuts", async (context) => {
    if (!canManageMessages(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Message shortcut management is not allowed" } }, 403);
    }

    const payload = createShortcutSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid shortcut payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const shortcut = await new DomainRepository(db).createMessageShortcut({
      code: payload.data.code,
      message: payload.data.message,
      type: payload.data.type,
      isActive: payload.data.is_active,
      sortOrder: payload.data.sort_order,
      createdByUserId: context.get("actorUserId"),
      attachments: payload.data.attachments.map((attachment) => ({
        filePublicId: attachment.file_public_id,
        attachmentType: attachment.attachment_type,
      })),
    });
    return context.json(serializeMessageShortcut(shortcut), 201);
  });

  routes.patch("/message-shortcuts/:shortcut_public_id", async (context) => {
    if (!canManageMessages(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Message shortcut management is not allowed" } }, 403);
    }

    const payload = updateShortcutSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid shortcut payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const shortcut = await new DomainRepository(db).updateMessageShortcut({
      shortcutPublicId: context.req.param("shortcut_public_id"),
      ...(payload.data.code !== undefined ? { code: payload.data.code } : {}),
      ...(payload.data.message !== undefined ? { message: payload.data.message } : {}),
      ...(payload.data.is_active !== undefined ? { isActive: payload.data.is_active } : {}),
      ...(payload.data.sort_order !== undefined ? { sortOrder: payload.data.sort_order } : {}),
      ...(payload.data.attachments !== undefined
        ? {
            attachments: payload.data.attachments.map((attachment) => ({
              filePublicId: attachment.file_public_id,
              attachmentType: attachment.attachment_type,
            })),
          }
        : {}),
    });
    return context.json(serializeMessageShortcut(shortcut));
  });

  routes.delete("/message-shortcuts/:shortcut_public_id", async (context) => {
    if (!canManageMessages(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Message shortcut management is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const shortcut = await new DomainRepository(db).deleteMessageShortcut(context.req.param("shortcut_public_id"));
    return context.json(serializeMessageShortcut(shortcut));
  });

  routes.post("/ai/reply-suggestion", async (context) => {
    if (!canManageMessages(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "AI reply suggestion is not allowed" } }, 403);
    }

    const payload = aiReplySuggestionSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid AI reply suggestion payload" } }, 400);
    }

    return context.json({
      provider: "openai",
      operation: "messages.reply_suggestion",
      dry_run: true,
      live_call_permitted: false,
      conversation_public_id: payload.data.conversation_public_id,
      suggestion: "AI yanıt önerisi backend dry-run sınırında tutuldu.",
    });
  });

  routes.post("/sms/send", async (context) => {
    if (!canSendSms(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "SMS sending is not allowed" } }, 403);
    }

    const payload = sendSmsSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid SMS payload" } }, 400);
    }

    const occurredAt = new Date().toISOString();
    const requestId = `req_${randomUUID().replaceAll("-", "")}`;
    const providerPayload = providerDeliveryJobPayloadSchema.parse({
      envelope: {
        request_id: requestId,
        provider: "netgsm",
        operation: "sms.send",
        direction: "outbound",
        channel: "sms",
        occurred_at: occurredAt,
        payload: {
          recipient_phone: payload.data.recipient_phone,
          message: payload.data.message,
          idempotency_key: payload.data.idempotency_key,
          shipment_public_id: payload.data.shipment_public_id,
        },
        legacy_contract: {
          source: "legacy-manual-sms",
          legacy_event: "manual_sms_send",
        },
      },
    });
    const job = jobEnvelopeSchema.parse({
      job_id: jobIdFromIdempotencyKey(payload.data.idempotency_key),
      queue: "provider-delivery",
      name: "netgsm.sms.send",
      payload: providerPayload,
      requested_at: occurredAt,
      request_id: context.get("requestId"),
    });
    const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);

    return context.json(
      {
        provider: "netgsm",
        operation: "sms.send",
        request_id: requestId,
        job_id: jobId,
        queued: jobId !== null,
        recipient_phone: payload.data.recipient_phone,
        message_preview: payload.data.message.slice(0, 80),
        live_call_permitted: false,
      },
      202,
    );
  });

  routes.patch("/conversations/:conversation_public_id/state", async (context) => {
    if (!canReadConversations(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Conversation access is not allowed" } }, 403);
    }

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
    const conversationUpdatedEnvelope = {
      event: "conversation.updated",
      id: `evt_${conversation.public_id}_${Date.now()}`,
      occurred_at: new Date().toISOString(),
      payload: {
        conversation_public_id: conversation.public_id,
        status: conversation.status,
        unread_count: Number(conversation.unread_count),
        is_in_pool: conversation.is_in_pool,
        human_agent_enabled: conversation.human_agent_enabled,
      },
    } as const;
    const realtimePublisher = context.get("realtimePublisher");
    realtimePublisher.publishToConversation(conversation.public_id, conversationUpdatedEnvelope);
    realtimePublisher.broadcast(conversationUpdatedEnvelope);

    return context.json(serializeConversation(conversation));
  });

  routes.get("/orders", async (context) => {
    if (!canReadOrders(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Order access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const orderFilter: ListOrdersFilter = {
      limit: limitSchema.parse(context.req.query("limit")),
      offset: offsetSchema.parse(context.req.query("offset")),
      sortBy: orderSortSchema.parse(context.req.query("sort_by")),
      sortDirection: sortDirectionSchema.parse(context.req.query("sort_direction")),
    };
    const status = context.req.query("status");
    const confirmationStatus = context.req.query("confirmation_status");
    const search = context.req.query("search");
    const source = context.req.query("source");
    const cargoProvider = context.req.query("cargo_provider");
    const createdByUserPublicId = context.req.query("created_by_user_public_id");
    const createdFrom = context.req.query("created_from");
    const createdTo = context.req.query("created_to");
    const orders = await new DomainRepository(db).listOrdersPage({
      ...orderFilter,
      ...(status ? { status } : {}),
      ...(confirmationStatus ? { confirmationStatus } : {}),
      ...(search ? { search } : {}),
      ...(source ? { source } : {}),
      ...(cargoProvider ? { cargoProvider } : {}),
      ...(createdByUserPublicId ? { createdByUserPublicId } : {}),
      ...(createdFrom ? { createdFrom: new Date(`${createdFrom}T00:00:00.000Z`) } : {}),
      ...(createdTo ? { createdTo: new Date(`${createdTo}T23:59:59.999Z`) } : {}),
    });
    return context.json({
      data: orders.rows.map(serializeOrder),
      meta: {
        total_count: orders.total_count,
        limit: orders.limit,
        offset: orders.offset,
      },
    });
  });

  routes.get("/orders/summary", async (context) => {
    if (!canReadOrders(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Order access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const summary = await new DomainRepository(db).getOrderSummary();
    return context.json(summary);
  });

  routes.get("/balances/summary", async (context) => {
    if (!canReadBalanceSummary(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Balance summary access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const summary = await new DomainRepository(db).getBalanceSummary();
    return context.json(summary);
  });

  routes.get("/products/summary", async (context) => {
    if (!canReadInventory(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Inventory access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const summary = await new DomainRepository(db).getProductSummary();
    return context.json(serializeProductSummary(summary));
  });

  routes.get("/products", async (context) => {
    if (!canReadInventory(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Inventory access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const products = await new DomainRepository(db).listProducts(limitSchema.parse(context.req.query("limit")));
    return context.json({ data: products.map(serializeProduct) });
  });

  routes.post("/orders", async (context) => {
    if (!canReadOrders(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Order access is not allowed" } }, 403);
    }

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

  routes.patch("/orders/:order_public_id/status", async (context) => {
    if (!canReadOrders(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Order access is not allowed" } }, 403);
    }

    const payload = updateOrderStatusSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid order status payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const order = await new DomainRepository(db).updateOrderStatus({
      orderPublicId: context.req.param("order_public_id"),
      status: payload.data.status,
      ...(payload.data.notes !== undefined ? { notes: payload.data.notes } : {}),
    });

    return context.json(serializeOrder(order));
  });

  routes.post("/orders/:order_public_id/payment-request", async (context) => {
    if (!canRequestPayment(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Payment requests require order management permissions" } }, 403);
    }

    const payload = createPaymentRequestSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid payment request payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const orderPublicId = context.req.param("order_public_id");
    const requestId = requestIdFromIdempotencyKey("payreq", payload.data.idempotency_key);
    let paymentRequest;
    try {
      paymentRequest = await new DomainRepository(db).requestOrderPayment({
        orderPublicId,
        amount: payload.data.amount,
        currency: payload.data.currency,
        idempotencyKey: payload.data.idempotency_key,
        requestId,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("idempotency key reuse mismatch")) {
        return context.json({ error: { code: "idempotency_conflict", message: "Payment request idempotency key was reused with different payload" } }, 409);
      }
      throw error;
    }
    const attemptRequestMetadata = paymentRequest.attempt.request_metadata as {
      order_public_id?: string;
      amount?: string;
      currency?: string;
    };

    return context.json(
      {
        provider: "kolaybi",
        operation: "balance.payment_request",
        request_id: paymentRequest.attempt.request_id,
        queued: false,
        live_call_permitted: false,
        order_public_id: attemptRequestMetadata.order_public_id ?? orderPublicId,
        amount: attemptRequestMetadata.amount ?? payload.data.amount,
        currency: attemptRequestMetadata.currency ?? payload.data.currency,
        replayed: paymentRequest.replayed,
        order: serializeOrder(paymentRequest.order),
      },
      202,
    );
  });

  routes.get("/shipments", async (context) => {
    if (!canReadShipments(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment access is not allowed" } }, 403);
    }

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

  routes.get("/shipments/summary", async (context) => {
    if (!canReadShipments(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const summary = await new DomainRepository(db).getShipmentSummary();
    return context.json(serializeShipmentSummary(summary));
  });

  routes.get("/shipments/pipeline-summary", async (context) => {
    if (!canReadShipmentPipeline(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment pipeline access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const summary = await new DomainRepository(db).getShipmentPipelineSummary();
    return context.json(summary);
  });

  routes.patch("/shipments/:shipment_public_id/status", async (context) => {
    if (!canReadShipments(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment access is not allowed" } }, 403);
    }

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
