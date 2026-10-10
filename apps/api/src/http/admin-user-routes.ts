import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import {
  AdminUsersRepository,
  DuplicateUserEmailError,
  managedUserRoles,
  ManagedUserNotFoundError,
  SelfDeactivationError,
  serializeAdminLog,
  serializeAdminUser,
} from "../admin/users-repository.js";
import { parseAuditLimit } from "../audit/repository.js";
import { SettingsRepository } from "../settings/repository.js";

const trimmed = (max: number) => z.string().trim().max(max);
const passwordSchema = z.string().min(6, "Şifre en az 6 karakter olmalı.").max(200);

const createUserSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta girin."),
  first_name: trimmed(100).min(1, "E-posta, ad ve şifre zorunlu."),
  last_name: trimmed(100).default(""),
  phone: trimmed(40).nullable().optional(),
  password: passwordSchema,
  role: z.enum(managedUserRoles).default("calisan"),
});

const updateUserSchema = z
  .object({
    first_name: trimmed(100).min(1, "Ad boş olamaz.").optional(),
    last_name: trimmed(100).optional(),
    phone: trimmed(40).nullable().optional(),
    role: z.enum(managedUserRoles).optional(),
    is_active: z.boolean().optional(),
    password: passwordSchema.optional(),
    sip_username: trimmed(100).nullable().optional(),
    sip_password: z.string().max(200).nullable().optional(),
  })
  .strict();

const presenceSchema = z.object({ online: z.literal(false) }).strict();

function validationError(context: Context<AppBindings>, error: z.ZodError) {
  return context.json({ error: { code: "invalid_request", message: error.issues[0]?.message ?? "Geçersiz istek" } }, 400);
}

function emptyToNull(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.length > 0 ? value : null;
}

function repository(context: Context<AppBindings>) {
  const db = context.get("db");
  if (!db) throw new Error("Database connection is not configured");
  return new AdminUsersRepository(db, context.get("encryptor"));
}

function handleKnownErrors(context: Context<AppBindings>, error: unknown) {
  if (error instanceof ManagedUserNotFoundError) {
    return context.json({ error: { code: "not_found", message: error.message } }, 404);
  }
  if (error instanceof DuplicateUserEmailError) {
    return context.json({ error: { code: "duplicate_email", message: error.message } }, 409);
  }
  if (error instanceof SelfDeactivationError) {
    return context.json({ error: { code: "self_deactivation", message: error.message } }, 409);
  }
  throw error;
}

/** Legacy `/api/admin/kullanicilar*` + işlem logları — admin only. */
export function createAdminUserRoutes() {
  const routes = new Hono<AppBindings>();
  for (const path of ["/users", "/users/*", "/logs"]) {
    routes.use(path, requireDatabase, authenticate, requireAdmin);
  }

  routes.get("/users", async (context) => {
    const users = await repository(context).list();
    return context.json({ data: users.map(serializeAdminUser), roles: managedUserRoles });
  });

  routes.post("/users", async (context) => {
    const parsed = createUserSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return validationError(context, parsed.error);
    try {
      const user = await repository(context).create({
        email: parsed.data.email,
        firstName: parsed.data.first_name,
        lastName: parsed.data.last_name,
        phone: emptyToNull(parsed.data.phone) ?? null,
        password: parsed.data.password,
        role: parsed.data.role,
        actorUserId: context.get("actorUserId"),
      });
      return context.json({ user: serializeAdminUser(user) }, 201);
    } catch (error) {
      return handleKnownErrors(context, error);
    }
  });

  routes.patch("/users/:user_public_id", async (context) => {
    const parsed = updateUserSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return validationError(context, parsed.error);
    const payload = parsed.data;
    try {
      const user = await repository(context).update({
        userPublicId: context.req.param("user_public_id"),
        ...(payload.first_name !== undefined ? { firstName: payload.first_name } : {}),
        ...(payload.last_name !== undefined ? { lastName: payload.last_name } : {}),
        ...(payload.phone !== undefined ? { phone: emptyToNull(payload.phone) ?? null } : {}),
        ...(payload.role !== undefined ? { role: payload.role } : {}),
        ...(payload.is_active !== undefined ? { isActive: payload.is_active } : {}),
        ...(payload.password !== undefined ? { password: payload.password } : {}),
        ...(payload.sip_username !== undefined ? { sipUsername: emptyToNull(payload.sip_username) ?? null } : {}),
        ...(payload.sip_password !== undefined ? { sipPassword: emptyToNull(payload.sip_password) ?? null } : {}),
        actorUserId: context.get("actorUserId"),
      });
      return context.json({ user: serializeAdminUser(user) });
    } catch (error) {
      return handleKnownErrors(context, error);
    }
  });

  // Legacy Mesajlar: a manager clicks an online agent chip to set them offline (only `online: false` is accepted).
  routes.patch("/users/:user_public_id/presence", async (context) => {
    const parsed = presenceSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return validationError(context, parsed.error);
    try {
      const user = await repository(context).setOffline({
        userPublicId: context.req.param("user_public_id"),
        actorUserId: context.get("actorUserId"),
      });
      const envelope = {
        event: "presence.updated",
        id: `evt_presence_${user.public_id}_${Date.now()}`,
        occurred_at: new Date().toISOString(),
        payload: { user_public_id: user.public_id, status: "offline" },
      } as const;
      const realtime = context.get("realtimePublisher");
      realtime.publishToUser(user.public_id, envelope);
      realtime.broadcast(envelope);
      return context.json({ user: serializeAdminUser(user) });
    } catch (error) {
      return handleKnownErrors(context, error);
    }
  });

  routes.delete("/users/:user_public_id", async (context) => {
    try {
      const user = await repository(context).update({
        userPublicId: context.req.param("user_public_id"),
        isActive: false,
        actorUserId: context.get("actorUserId"),
      });
      return context.json({ user: serializeAdminUser(user), deactivated: true });
    } catch (error) {
      return handleKnownErrors(context, error);
    }
  });

  routes.get("/logs", async (context) => {
    const logs = await repository(context).listLogs(parseAuditLimit(context.req.query("limit"), 100));
    return context.json({ data: logs.map(serializeAdminLog) });
  });

  return routes;
}

const profileSchema = z.object({
  first_name: trimmed(100).min(1, "Ad boş olamaz."),
  last_name: trimmed(100).default(""),
});

const passwordChangeSchema = z
  .object({ password: passwordSchema, password_confirmation: z.string() })
  .refine((value) => value.password === value.password_confirmation, { message: "Şifreler eşleşmiyor." });

/** Kendi profil/şifre güncellemesi — her aktif kullanıcı. */
export function createAccountRoutes() {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireDatabase, authenticate);

  routes.patch("/profile", async (context) => {
    const parsed = profileSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return validationError(context, parsed.error);
    const actorUserId = context.get("actorUserId");
    if (actorUserId === null) return context.json({ error: { code: "unauthorized", message: "Oturum geçersiz" } }, 401);
    await repository(context).updateOwnProfile(actorUserId, parsed.data.first_name, parsed.data.last_name);
    return context.json({ first_name: parsed.data.first_name, last_name: parsed.data.last_name });
  });

  routes.post("/password", async (context) => {
    const parsed = passwordChangeSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return validationError(context, parsed.error);
    const actorUserId = context.get("actorUserId");
    if (actorUserId === null) return context.json({ error: { code: "unauthorized", message: "Oturum geçersiz" } }, 401);
    await repository(context).updateOwnPassword(actorUserId, parsed.data.password);
    return context.json({ updated: true });
  });

  return routes;
}

/** Legacy `/api/whatsapp/ai-status` — AI otomatik yanıt durumu her aktif kullanıcıya okunur; yazma admin settings üzerinden. */
export function createAppSettingsRoutes() {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireDatabase, authenticate);

  routes.get("/ai-status", async (context) => {
    const db = context.get("db");
    if (!db) throw new Error("Database connection is not configured");
    const settings = await new SettingsRepository(db, context.get("encryptor"), context.get("settingsCache")).list("global");
    const setting = settings.find((item) => item.key === "ai.auto_reply_enabled" && !item.is_secret);
    return context.json({ ai_enabled: setting?.value === true });
  });

  return routes;
}
