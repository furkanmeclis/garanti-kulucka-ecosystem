import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { BalancePaymentRequestError, BalanceRepository } from "../balances/repository.js";
import { moneyToCents, paymentRequestStatuses } from "../balances/rules.js";

/**
 * Legacy `/bakiye` (frontend/src/pages/bakiye/BakiyePage.jsx + supabase bakiye RPCs) as backend routes.
 * Staff (calisan) only ever see their own ledger; admin sees every staff member and processes requests.
 */

const limitSchema = z.coerce.number().int().min(1).max(500).default(200);
const offsetSchema = z.coerce.number().int().min(0).default(0);

const listQuerySchema = z.object({
  limit: limitSchema,
  offset: offsetSchema,
  user_public_id: z.string().min(1).optional(),
  status: z.enum(paymentRequestStatuses).optional(),
});

const createPaymentRequestSchema = z.object({
  amount: z.union([z.string().regex(/^\d+(\.\d{1,2})?$/), z.number().positive()]),
  idempotency_key: z.string().trim().min(1).max(160),
});

const processSchema = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
});

function isAdmin(role: string | undefined) {
  return role === "admin" || role === "owner";
}

function canUseBalances(role: string | undefined) {
  return isAdmin(role) || role === "calisan";
}

function forbidden(context: Context<AppBindings>, message = "Balance access is not allowed") {
  return context.json({ error: { code: "forbidden", message } }, 403);
}

async function readJson(context: Context<AppBindings>) {
  try {
    return (await context.req.json()) as unknown;
  } catch {
    return {};
  }
}

function errorResponse(context: Context<AppBindings>, error: unknown) {
  if (error instanceof BalancePaymentRequestError) {
    const status = error.code === "not_found" ? 404 : error.code === "invalid_amount" ? 400 : 409;
    return context.json({ error: { code: error.code, message: error.message } }, status);
  }
  throw error;
}

export function createBalanceRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);
  routes.use("*", async (context, next) => {
    if (!canUseBalances(context.get("auth")?.role)) {
      return forbidden(context);
    }
    if (!isAdmin(context.get("auth")?.role) && context.get("actorUserId") === null) {
      return forbidden(context);
    }
    await next();
  });

  const repository = (context: Context<AppBindings>) => new BalanceRepository(context.get("db")!);

  routes.get("/staff", async (context) => {
    if (!isAdmin(context.get("auth")?.role)) return forbidden(context, "Staff balances require admin");
    return context.json({ data: await repository(context).listStaffBalances() });
  });

  routes.get("/staff/:user_public_id/orders", async (context) => {
    if (!isAdmin(context.get("auth")?.role)) return forbidden(context, "Staff orders require admin");
    const repo = repository(context);
    const user = await repo.findUserIdByPublicId(context.req.param("user_public_id"));
    if (!user) return context.json({ error: { code: "not_found", message: "Personel bulunamadı" } }, 404);
    return context.json({ data: await repo.listStaffOrders(user.id, 100) });
  });

  routes.post("/staff/:user_public_id/reset", async (context) => {
    if (!isAdmin(context.get("auth")?.role)) return forbidden(context, "Balance reset requires admin");
    const repo = repository(context);
    const actorUserId = context.get("actorUserId");
    const admin = actorUserId === null
      ? null
      : await context.get("db")!.selectFrom("users").select(["first_name"]).where("id", "=", actorUserId).executeTakeFirst();
    try {
      const result = await repo.resetBalance({
        userPublicId: context.req.param("user_public_id"),
        adminUserId: actorUserId,
        adminName: admin?.first_name ?? "",
      });
      return context.json(result);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.get("/movements", async (context) => {
    const query = listQuerySchema.safeParse(context.req.query());
    if (!query.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid balance movement query" } }, 400);
    }
    const repo = repository(context);
    let userId: number | null = isAdmin(context.get("auth")?.role) ? null : context.get("actorUserId");
    if (userId === null && query.data.user_public_id) {
      const user = await repo.findUserIdByPublicId(query.data.user_public_id);
      if (!user) return context.json({ data: [], total: 0 });
      userId = user.id;
    }
    return context.json(await repo.listMovements({ userId, limit: query.data.limit, offset: query.data.offset }));
  });

  routes.get("/payment-requests", async (context) => {
    const query = listQuerySchema.safeParse(context.req.query());
    if (!query.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid payment request query" } }, 400);
    }
    const repo = repository(context);
    let userId: number | null = isAdmin(context.get("auth")?.role) ? null : context.get("actorUserId");
    if (userId === null && query.data.user_public_id) {
      const user = await repo.findUserIdByPublicId(query.data.user_public_id);
      if (!user) return context.json({ data: [], total: 0 });
      userId = user.id;
    }
    return context.json(await repo.listPaymentRequests({
      userId,
      ...(query.data.status ? { status: query.data.status } : {}),
      limit: query.data.limit,
      offset: query.data.offset,
    }));
  });

  routes.post("/payment-requests", async (context) => {
    const actorUserId = context.get("actorUserId");
    if (actorUserId === null) return forbidden(context);
    const payload = createPaymentRequestSchema.safeParse(await readJson(context));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_amount", message: "Geçerli bir tutar girin" } }, 400);
    }
    try {
      const result = await repository(context).createPaymentRequest({
        userId: actorUserId,
        amountCents: moneyToCents(payload.data.amount),
        idempotencyKey: payload.data.idempotency_key,
      });
      return context.json({ ...result, message: "Ödeme isteği oluşturuldu" }, result.replayed ? 200 : 201);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  for (const [action, decision] of [["approve", "approved"], ["reject", "rejected"]] as const) {
    routes.post(`/payment-requests/:payment_request_public_id/${action}`, async (context) => {
      if (!isAdmin(context.get("auth")?.role)) return forbidden(context, "Payment request processing requires admin");
      const payload = processSchema.safeParse(await readJson(context));
      if (!payload.success) {
        return context.json({ error: { code: "invalid_request", message: "Invalid payment request decision" } }, 400);
      }
      try {
        const result = await repository(context).processPaymentRequest({
          publicId: context.req.param("payment_request_public_id"),
          decision,
          adminUserId: context.get("actorUserId"),
          note: payload.data.note ?? null,
        });
        return context.json(result);
      } catch (error) {
        return errorResponse(context, error);
      }
    });
  }

  return routes;
}
