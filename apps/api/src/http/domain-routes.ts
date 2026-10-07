import { BalanceRepository } from "../balances/repository.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppDatabase } from "@garanti-kulucka/database";
import { jobEnvelopeSchema, planOutboundDelivery, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import {
  DomainRepository,
  DuplicateProductSkuError,
  InsufficientStockError,
  ProductNotFoundError,
  type ListOrdersFilter,
  type ListShipmentsFilter,
  serializeConversation,
  serializeConversationSummary,
  serializeCustomer,
  serializeCustomerDetail,
  serializeCustomerSummary,
  serializeMessage,
  serializeMessageShortcut,
  serializeOrder,
  serializeProduct,
  serializeProductSummary,
  serializeShipment,
  serializeShipmentSummary,
  serializeStockMovement,
} from "../domain/repository.js";
import { calculateVatInclusiveOrder, moneyToCents } from "../domain/order-totals.js";


const limitSchema = z.coerce.number().int().min(1).max(200).default(50);
const offsetSchema = z.coerce.number().int().min(0).default(0);
const orderSortSchema = z.enum(["created_at", "updated_at", "order_number", "status", "total_amount"]).default("created_at");
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

const optionalTrimmed = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === null || value.trim() === "" ? null : value.trim()));

const updateCustomerSchema = z
  .object({
    full_name: z.string().trim().min(1, "Müşteri adı gerekli").max(200).optional(),
    phone: optionalTrimmed(40),
    email: optionalTrimmed(320).refine((value) => value == null || z.string().email().safeParse(value).success, {
      message: "Geçersiz e-posta",
    }),
    username: optionalTrimmed(200),
    notes: z.string().max(10_000).nullable().optional(),
  })
  .strict()
  .refine((payload) => Object.values(payload).some((value) => value !== undefined), {
    message: "En az bir alan gerekli",
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

const productCategorySchema = z.enum(["incubator", "spare_part", "other"]);
const productUnitSchema = z.enum(["Adet", "Kg", "Lt", "Mt", "Koli"]);
const moneySchema = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/);
const stockQuantitySchema = z.number().int().min(0).max(1_000_000_000);
const optionalTextSchema = (max: number) =>
  z.string().trim().max(max).nullable().transform((value) => (value ? value : null));

const listInventoryProductsQuerySchema = z.object({
  limit: limitSchema,
  category: productCategorySchema.optional(),
  search: z.string().trim().max(200).optional(),
  active: z.enum(["true", "false", "all"]).default("all"),
});

const createProductSchema = z.object({
  name: z.string().trim().min(1, "Ürün adı gerekli").max(300),
  sku: optionalTextSchema(64).default(null),
  category: productCategorySchema.nullable().default(null),
  unit: productUnitSchema.default("Adet"),
  unit_price: moneySchema.default("0"),
  stock_quantity: stockQuantitySchema.default(0),
  description: optionalTextSchema(2000).default(null),
  external_product_id: optionalTextSchema(64).default(null),
}).strict();

const updateProductSchema = z.object({
  name: z.string().trim().min(1, "Ürün adı boş olamaz").max(300).optional(),
  sku: optionalTextSchema(64).optional(),
  category: productCategorySchema.optional(),
  unit: productUnitSchema.optional(),
  unit_price: moneySchema.optional(),
  stock_quantity: stockQuantitySchema.optional(),
  description: optionalTextSchema(2000).optional(),
  external_product_id: optionalTextSchema(64).optional(),
}).strict().refine((payload) => Object.values(payload).some((value) => value !== undefined), {
  message: "At least one product field is required",
});

const createStockMovementSchema = z.object({
  movement_type: z.enum(["in", "out"]),
  quantity: z.number().int().min(1, "Miktar 0'dan büyük olmalı").max(1_000_000_000),
  notes: optionalTextSchema(2000).default(null),
}).strict();

const createOrderSchema = z.object({
  customer_public_id: z.string().min(1).nullable().default(null),
  customer: z
    .object({
      full_name: z.string().trim().min(1),
      phone: z.string().trim().min(1),
      email: z.string().trim().min(1).nullable().optional(),
      username: z.string().trim().min(1).nullable().optional(),
    })
    .optional(),
  address: z.object({
    address_line: z.string().trim().min(1),
    city: z.string().trim().min(1),
    district: z.string().trim().min(1),
    country: z.string().trim().min(1).default("Türkiye"),
    postal_code: z.string().trim().min(1).nullable().optional(),
  }),
  conversation_public_id: z.string().min(1).nullable().default(null),
  status: z.string().min(1).default("draft"),
  source: z.string().min(1).default("manual"),
  cargo_provider: z.enum(["ptt", "surat"]),
  currency: z.string().min(3).max(3).default("TRY"),
  notes: z.string().nullable().default(null),
  items: z.array(z.object({
    product_public_id: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(1),
    quantity: z.coerce.number().int().min(1),
    unit_price: z.string().regex(/^\d+(\.\d{1,2})?$/),
    external_product_id: z.string().min(1).nullable().optional(),
  })).min(1),
  force_duplicate: z.boolean().default(false),
  force_surat_at: z.boolean().default(false),
}).refine((payload) => payload.customer_public_id !== null || payload.customer !== undefined, {
  message: "Customer identity is required",
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

const trackShipmentSchema = z.object({
  idempotency_key: z.string().min(1).optional(),
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

function canManageInventory(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const inventoryValidationMessages = new Set(["Ürün adı gerekli", "Ürün adı boş olamaz", "Miktar 0'dan büyük olmalı"]);

function firstIssueMessage(error: z.ZodError, fallback: string) {
  const message = error.issues[0]?.message;
  return message && inventoryValidationMessages.has(message) ? message : fallback;
}

function inventoryErrorResponse(context: Context<AppBindings>, error: unknown) {
  if (error instanceof ProductNotFoundError) {
    return context.json({ error: { code: "not_found", message: "Ürün bulunamadı" } }, 404);
  }
  if (error instanceof InsufficientStockError) {
    return context.json({
      error: {
        code: "insufficient_stock",
        message: error.message,
        current_quantity: error.currentQuantity,
        requested_quantity: error.requestedQuantity,
      },
    }, 409);
  }
  if (error instanceof DuplicateProductSkuError) {
    return context.json({ error: { code: "duplicate_sku", message: "Bu stok kodu zaten kullanılıyor" } }, 409);
  }
  throw error;
}

function canReadOrders(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan" || role === "kargo_operatoru";
}

const canUseOrderCreateForm = canReadOrders;

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

async function queueOutboundDelivery(
  context: Context<AppBindings>,
  db: AppDatabase,
  message: { public_id: string; body: string | null; attachments: Array<{ file_public_id: string; original_name?: string | null }> },
) {
  const target = await new DomainRepository(db).getConversationDeliveryTarget(context.req.param("conversation_public_id") ?? "");
  if (!target) return null;
  const plan = planOutboundDelivery({
    target,
    messagePublicId: message.public_id,
    body: message.body,
    attachments: message.attachments.map((attachment) => ({ file_public_id: attachment.file_public_id, original_name: attachment.original_name })),
    requestId: context.get("requestId"),
  });
  if ("reason" in plan) {
    return { provider: plan.provider, queued: false, job_ids: [], skipped_reason: plan.reason, skipped_attachments: 0, live_gate: plan.provider ? `providers.${plan.provider}.live_mode` : null };
  }
  const publisher = context.get("providerDeliveryQueuePublisher");
  const jobIds: string[] = [];
  for (const job of plan.jobs) {
    const jobId = await publisher.publish(job);
    if (jobId) jobIds.push(jobId);
  }
  return {
    provider: plan.provider,
    queued: jobIds.length === plan.jobs.length && jobIds.length > 0,
    job_ids: jobIds,
    skipped_reason: null,
    skipped_attachments: plan.skipped_attachments,
    live_gate: `providers.${plan.provider}.live_mode`,
  };
}

function jobIdFromIdempotencyKey(key: string) {
  return `job_${key.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96)}`;
}

function requestIdFromIdempotencyKey(prefix: string, key: string) {
  return `${prefix}_${key.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96)}`;
}

function providerKeyFromShipmentProvider(provider: string) {
  const normalized = provider.toLocaleLowerCase("tr-TR");
  if (normalized.includes("ptt")) return "ptt";
  if (normalized.includes("sürat") || normalized.includes("surat")) return "surat";
  return normalized.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "ptt";
}

function normalizePhoneTail(value: string) {
  return value.replace(/\D/g, "").slice(-10);
}

function isSuratAtWarningAddress(payload: { cargo_provider: string; address: { city: string; district: string; address_line: string } }) {
  if (payload.cargo_provider !== "surat") return false;
  const addressText = `${payload.address.city} ${payload.address.district} ${payload.address.address_line}`.toLocaleLowerCase("tr-TR");
  return addressText.includes("at dışı") || addressText.includes("at disi") || addressText.includes("teslimat yok");
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
    const search = context.req.query("search")?.trim();
    const offset = Number.parseInt(context.req.query("offset") ?? "0", 10);
    const conversations = await new DomainRepository(db).listConversations({
      limit: limitSchema.parse(context.req.query("limit")),
      ...(search ? { search: search.slice(0, 100) } : {}),
      ...(Number.isFinite(offset) && offset > 0 ? { offset: Math.min(offset, 100_000) } : {}),
      ...(assigned === "unassigned" ? { assignedUserId: null } : {}),
      ...(channels ? { channels } : channel ? { channel } : {}),
      ...(status ? { status } : {}),
    });

    return context.json({ data: conversations.map(serializeConversation) });
  });

  routes.post("/conversations/mark-all-read", async (context) => {
    if (!canReadConversations(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Conversation access is not allowed" } }, 403);
    }
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }
    const body = (await context.req.json().catch(() => ({}))) as { channel?: unknown };
    const channel = typeof body.channel === "string" && body.channel !== "all" && body.channel !== "hepsi" ? body.channel : null;
    // Legacy kanal filtresi: facebook covers both stored Messenger channel names.
    const channels = channel ? (channel === "facebook" || channel === "messenger" ? ["facebook", "messenger"] : [channel]) : undefined;
    const updated = await new DomainRepository(db).markAllConversationsRead(channels ? { channels } : {});
    return context.json({ updated });
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

    const page = await new DomainRepository(db).listMessagesPage(
      context.req.param("conversation_public_id"),
      limitSchema.parse(context.req.query("limit")),
      context.req.query("before")?.trim() || null,
    );

    return context.json({ data: page.messages.map(serializeMessage), has_more: page.hasMore });
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

  routes.get("/customers/:customer_public_id", async (context) => {
    if (!canReadCustomers(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Customer directory access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const detail = await new DomainRepository(db).getCustomerDetail(context.req.param("customer_public_id"));
    if (!detail) {
      return context.json({ error: { code: "not_found", message: "Müşteri bulunamadı" } }, 404);
    }
    return context.json(serializeCustomerDetail(detail));
  });

  routes.patch("/customers/:customer_public_id", async (context) => {
    if (!canReadCustomers(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Customer update is not allowed" } }, 403);
    }

    const payload = updateCustomerSchema.safeParse(await readJsonBody(context.req.raw));
    if (!payload.success) {
      const message = payload.error.issues[0]?.message;
      return context.json(
        {
          error: {
            code: "invalid_request",
            message: message === "Müşteri adı gerekli" || message === "Geçersiz e-posta" || message === "En az bir alan gerekli"
              ? message
              : "Invalid customer payload",
          },
        },
        400,
      );
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const customer = await new DomainRepository(db).updateCustomer({
      customerPublicId: context.req.param("customer_public_id"),
      fullName: payload.data.full_name,
      phone: payload.data.phone,
      email: payload.data.email,
      username: payload.data.username,
      notes: payload.data.notes,
    });
    if (!customer) {
      return context.json({ error: { code: "not_found", message: "Müşteri bulunamadı" } }, 404);
    }
    return context.json(serializeCustomer(customer));
  });

  routes.patch("/customers/:customer_public_id/notes", async (context) => {
    if (!canReadCustomers(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Customer notes access is not allowed" } }, 403);
    }

    const payload = updateNoteSchema.safeParse(await readJsonBody(context.req.raw));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid customer note payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const customer = await new DomainRepository(db).updateCustomer({
      customerPublicId: context.req.param("customer_public_id"),
      notes: payload.data.notes,
    });
    if (!customer) {
      return context.json({ error: { code: "not_found", message: "Müşteri bulunamadı" } }, 404);
    }
    return context.json(serializeCustomer(customer));
  });

  routes.get("/orders/customer-lookup", async (context) => {
    if (!canUseOrderCreateForm(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Order customer lookup is not allowed" } }, 403);
    }

    const phone = context.req.query("phone") ?? "";
    if (!normalizePhoneTail(phone)) {
      return context.json({ customer: null, default_address: null });
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const lookup = await new DomainRepository(db).lookupCustomerByPhone(phone);
    return context.json({
      customer: lookup.customer ? serializeCustomer(lookup.customer) : null,
      default_address: lookup.defaultAddress
        ? {
            address_line: lookup.defaultAddress.address_line,
            city: lookup.defaultAddress.city,
            district: lookup.defaultAddress.district,
            country: lookup.defaultAddress.country,
            postal_code: lookup.defaultAddress.postal_code,
          }
        : null,
    });
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

    const delivery = message.sender_type === "user" ? await queueOutboundDelivery(context, db, message) : null;
    return context.json({ ...serializeMessage(message), delivery }, 201);
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

    const role = context.get("auth")?.role;
    const actorUserId = context.get("actorUserId");
    const scopeUserId = role === "admin" || role === "owner" ? null : actorUserId;
    if (scopeUserId === null && role !== "admin" && role !== "owner") {
      return context.json({ error: { code: "forbidden", message: "Balance summary access is not allowed" } }, 403);
    }
    const summary = await new BalanceRepository(db).getSummary(scopeUserId);
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
    const query = listInventoryProductsQuerySchema.safeParse({
      limit: context.req.query("limit"),
      category: context.req.query("category") || undefined,
      search: context.req.query("search") || undefined,
      active: context.req.query("active") || undefined,
    });
    if (!query.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid inventory filter" } }, 400);
    }
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }
    const repository = new DomainRepository(db);
    const hasInventoryFilter = Boolean(query.data.category || query.data.search || query.data.active !== "all");
    if (!hasInventoryFilter) {
      const products = await repository.listProducts(query.data.limit);
      return context.json({ data: products.map(serializeProduct) });
    }
    const products = await repository.listInventoryProducts({
      limit: query.data.limit,
      ...(query.data.category ? { category: query.data.category } : {}),
      ...(query.data.search ? { search: query.data.search } : {}),
      ...(query.data.active !== "all" ? { active: query.data.active === "true" } : {}),
    });
    return context.json({ data: products.map(serializeProduct) });
  });

  routes.get("/orders/product-options", async (context) => {
    if (!canUseOrderCreateForm(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Order product lookup is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const products = await new DomainRepository(db).listOrderProductOptions(limitSchema.parse(context.req.query("limit")));
    return context.json({ data: products.map(serializeProduct) });
  });

  routes.post("/products", async (context) => {
    if (!canManageInventory(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Inventory management is not allowed" } }, 403);
    }
    const payload = createProductSchema.safeParse(await readJsonBody(context.req.raw));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: firstIssueMessage(payload.error, "Invalid product payload") } }, 400);
    }
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }
    try {
      const product = await new DomainRepository(db).createProduct({
        name: payload.data.name,
        sku: payload.data.sku,
        category: payload.data.category,
        unit: payload.data.unit,
        unitPrice: payload.data.unit_price,
        stockQuantity: payload.data.stock_quantity,
        description: payload.data.description,
        externalProductId: payload.data.external_product_id,
        actorUserId: context.get("actorUserId") ?? null,
      });
      return context.json(serializeProduct(product), 201);
    } catch (error) {
      return inventoryErrorResponse(context, error);
    }
  });

  routes.patch("/products/:product_public_id", async (context) => {
    if (!canManageInventory(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Inventory management is not allowed" } }, 403);
    }
    const payload = updateProductSchema.safeParse(await readJsonBody(context.req.raw));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: firstIssueMessage(payload.error, "Invalid product payload") } }, 400);
    }
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }
    try {
      const product = await new DomainRepository(db).updateProduct({
        productPublicId: context.req.param("product_public_id"),
        ...(payload.data.name !== undefined ? { name: payload.data.name } : {}),
        ...(payload.data.sku !== undefined ? { sku: payload.data.sku } : {}),
        ...(payload.data.category !== undefined ? { category: payload.data.category } : {}),
        ...(payload.data.unit !== undefined ? { unit: payload.data.unit } : {}),
        ...(payload.data.unit_price !== undefined ? { unitPrice: payload.data.unit_price } : {}),
        ...(payload.data.stock_quantity !== undefined ? { stockQuantity: payload.data.stock_quantity } : {}),
        ...(payload.data.description !== undefined ? { description: payload.data.description } : {}),
        ...(payload.data.external_product_id !== undefined ? { externalProductId: payload.data.external_product_id } : {}),
        actorUserId: context.get("actorUserId") ?? null,
      });
      return context.json(serializeProduct(product));
    } catch (error) {
      return inventoryErrorResponse(context, error);
    }
  });

  routes.delete("/products/:product_public_id", async (context) => {
    if (!canManageInventory(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Inventory management is not allowed" } }, 403);
    }
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }
    try {
      const product = await new DomainRepository(db).deactivateProduct(context.req.param("product_public_id"));
      return context.json(serializeProduct(product));
    } catch (error) {
      return inventoryErrorResponse(context, error);
    }
  });

  routes.get("/products/:product_public_id/stock-movements", async (context) => {
    if (!canReadInventory(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Inventory access is not allowed" } }, 403);
    }
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }
    try {
      const movements = await new DomainRepository(db).listStockMovements(
        context.req.param("product_public_id"),
        limitSchema.parse(context.req.query("limit")),
      );
      return context.json({ data: movements.map(serializeStockMovement) });
    } catch (error) {
      return inventoryErrorResponse(context, error);
    }
  });

  routes.post("/products/:product_public_id/stock-movements", async (context) => {
    if (!canManageInventory(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Inventory management is not allowed" } }, 403);
    }
    const payload = createStockMovementSchema.safeParse(await readJsonBody(context.req.raw));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: firstIssueMessage(payload.error, "Invalid stock movement payload") } }, 400);
    }
    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }
    try {
      const result = await new DomainRepository(db).createStockMovement({
        productPublicId: context.req.param("product_public_id"),
        movementType: payload.data.movement_type,
        quantity: payload.data.quantity,
        notes: payload.data.notes,
        actorUserId: context.get("actorUserId") ?? null,
      });
      return context.json(
        { product: serializeProduct(result.product), movement: serializeStockMovement(result.movement) },
        201,
      );
    } catch (error) {
      return inventoryErrorResponse(context, error);
    }
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

    const repository = new DomainRepository(db);
    const customerName = payload.data.customer?.full_name ?? "";
    const customerPhone = payload.data.customer?.phone ?? "";
    const duplicateOrders = payload.data.customer && !payload.data.force_duplicate
      ? await repository.findDuplicateActiveOrders({ phone: customerPhone, fullName: customerName })
      : { phoneMatches: [], nameMatches: [] };
    if (duplicateOrders.phoneMatches.length > 0) {
      return context.json(
        {
          error: {
            code: "duplicate_phone_warning",
            message: "Aynı telefon numarasıyla başka aktif sipariş bulunuyor.",
          },
        },
        409,
      );
    }
    if (duplicateOrders.nameMatches.length > 0) {
      return context.json(
        {
          error: {
            code: "duplicate_name_warning",
            message: "Aynı ad-soyad ile başka aktif sipariş bulunuyor.",
          },
        },
        409,
      );
    }
    if (!payload.data.force_surat_at && isSuratAtWarningAddress(payload.data)) {
      return context.json(
        {
          error: {
            code: "surat_at_warning",
            message: "Bu adrese sürat kargo teslimat yapmamaktadır",
          },
        },
        409,
      );
    }

    const calculatedOrder = calculateVatInclusiveOrder(payload.data.items);
    const totalCents = moneyToCents(calculatedOrder.totalAmount);
    if (totalCents <= 0) {
      return context.json({ error: { code: "invalid_order_total", message: "Sipariş tutarı 0 TL olamaz. Lütfen fiyat bilgisini kontrol edin." } }, 400);
    }

    const order = await repository.createOrderFromForm({
      customerPublicId: payload.data.customer_public_id,
      customer: payload.data.customer
        ? {
            fullName: payload.data.customer.full_name,
            phone: payload.data.customer.phone,
            email: payload.data.customer.email ?? null,
            username: payload.data.customer.username ?? null,
          }
        : null,
      address: {
        addressLine: payload.data.address.address_line,
        city: payload.data.address.city,
        district: payload.data.address.district,
        country: payload.data.address.country,
        postalCode: payload.data.address.postal_code ?? null,
      },
      conversationPublicId: payload.data.conversation_public_id,
      createdByUserId: context.get("actorUserId"),
      status: payload.data.status,
      source: payload.data.source,
      cargoProvider: payload.data.cargo_provider,
      totalAmount: calculatedOrder.totalAmount,
      currency: payload.data.currency,
      notes: payload.data.notes,
      items: calculatedOrder.items,
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
      actorRole: context.get("auth")?.role ?? null,
      actorUserId: context.get("actorUserId"),
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
    const shipmentFilter: ListShipmentsFilter = {
      limit: limitSchema.parse(context.req.query("limit")),
      offset: offsetSchema.parse(context.req.query("offset")),
    };
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
    const search = context.req.query("search");
    if (search) {
      shipmentFilter.search = search;
    }
    const notReceived = context.req.query("not_received");
    const stage = context.req.query("stage");
    const createdFrom = context.req.query("created_from");
    const createdTo = context.req.query("created_to");
    const isDate = (value: string | undefined) => value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value);
    if ((notReceived !== undefined && notReceived !== "ptt" && notReceived !== "surat") || (stage !== undefined && stage !== "new" && stage !== "shipped") || !isDate(createdFrom) || !isDate(createdTo)) {
      return context.json({ error: { code: "invalid_request", message: "Invalid shipment filter" } }, 400);
    }
    if (notReceived) shipmentFilter.notReceived = notReceived;
    if (stage) shipmentFilter.stage = stage;
    const createdBy = context.req.query("created_by_user_public_id");
    if (createdBy) shipmentFilter.createdByUserPublicId = createdBy;
    if (createdFrom) shipmentFilter.createdFrom = createdFrom;
    if (createdTo) shipmentFilter.createdTo = createdTo;
    const shipments = await new DomainRepository(db).listShipmentsPage(shipmentFilter);
    return context.json({
      data: shipments.rows.map(serializeShipment),
      meta: {
        total_count: shipments.total_count,
        limit: shipments.limit,
        offset: shipments.offset,
      },
    });
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

  routes.get("/shipments/:shipment_public_id", async (context) => {
    if (!canReadShipments(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment access is not allowed" } }, 403);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const shipment = await new DomainRepository(db).getShipmentByPublicId(context.req.param("shipment_public_id"));
    if (!shipment) {
      return context.json({ error: { code: "not_found", message: "Shipment was not found" } }, 404);
    }

    return context.json(serializeShipment(shipment));
  });

  routes.post("/shipments/:shipment_public_id/track", async (context) => {
    if (!canReadShipments(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Shipment access is not allowed" } }, 403);
    }

    const payload = trackShipmentSchema.safeParse(await context.req.json().catch(() => ({})));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid shipment tracking payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const shipment = await new DomainRepository(db).getShipmentByPublicId(context.req.param("shipment_public_id"));
    if (!shipment) {
      return context.json({ error: { code: "not_found", message: "Shipment was not found" } }, 404);
    }
    const provider = providerKeyFromShipmentProvider(shipment.provider);
    const idempotencyKey = payload.data.idempotency_key ?? `track_${shipment.public_id}`;
    const occurredAt = new Date().toISOString();
    const requestId = requestIdFromIdempotencyKey(`req_${provider}_track`, idempotencyKey);
    const providerPayload = providerDeliveryJobPayloadSchema.parse({
      envelope: {
        request_id: requestId,
        provider,
        operation: "shipment.track",
        direction: "outbound",
        channel: "cargo",
        occurred_at: occurredAt,
        payload: {
          shipment_public_id: shipment.public_id,
          tracking_number: shipment.tracking_number,
          barcode_number: shipment.barcode_number,
          order_number: shipment.order_number,
          customer_full_name: shipment.customer_full_name,
        },
        legacy_contract: {
          source: "legacy-kargo-list",
          legacy_event: "takip_guncelle",
        },
      },
    });
    const job = jobEnvelopeSchema.parse({
      job_id: jobIdFromIdempotencyKey(idempotencyKey),
      queue: "provider-delivery",
      name: `${provider}.shipment.track`,
      payload: providerPayload,
      requested_at: occurredAt,
      request_id: context.get("requestId"),
    });
    const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);

    return context.json(
      {
        provider,
        operation: "shipment.track",
        request_id: requestId,
        job_id: jobId,
        queued: jobId !== null,
        shipment_public_id: shipment.public_id,
        tracking_number: shipment.tracking_number,
        live_call_permitted: false,
        live_gate: `providers.${provider}.live_mode`,
      },
      202,
    );
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
    context.get("realtimePublisher").broadcast({
      event: "shipment.updated",
      id: `shipment_${shipment.public_id}_${Date.now()}`,
      occurred_at: new Date().toISOString(),
      payload: {
        shipment_public_id: shipment.public_id,
        status: shipment.status,
        tracking_number: shipment.tracking_number,
      },
    });

    return context.json(serializeShipment(shipment));
  });

  return routes;
}
