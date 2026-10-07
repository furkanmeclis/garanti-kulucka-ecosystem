import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import { clientIp, rateLimit } from "./rate-limit.js";
import { DataDeletionRepository, dataDeletionStatuses, serializeDataDeletionRequest } from "../privacy/data-deletion-repository.js";

/**
 * Legacy DataDeletionPage endpoints, kept on their legacy paths: the public KVKK form posts to
 * `/api/veri-silme-talebi` and the Meta app's "Data Deletion Request URL" points at
 * `/api/facebook/data-deletion`. Both are anonymous, so they are rate limited per client IP.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

const formSchema = z.object({
  ad: z.string({ error: "Ad Soyad alanı zorunludur" }).trim().min(1, "Ad Soyad alanı zorunludur").max(200),
  email: optionalText(254).refine((value) => value === null || z.string().email().safeParse(value).success, "Geçerli bir e-posta girin."),
  telefon: optionalText(40),
  instagram_kullanici_adi: optionalText(100),
  messenger_psid: optionalText(100),
  aciklama: optionalText(2000),
  tarih: z.string().datetime({ offset: true }).optional(),
}).refine((value) => value.email || value.telefon || value.instagram_kullanici_adi || value.messenger_psid, {
  message: "En az bir iletişim bilgisi (e-posta, telefon, Instagram kullanıcı adı veya Messenger ID) girilmelidir.",
});

function repository(context: Context<AppBindings>) {
  const db = context.get("db");
  if (!db) throw new Error("Database connection is not configured");
  return new DataDeletionRepository(db);
}

const publicLimit = (namespace: string) => rateLimit({ namespace, limit: 5, windowMs: 10 * 60_000, key: (context) => clientIp(context) });

/** Meta `signed_request`: `<signature>.<base64url JSON>`; only the payload's `user_id` is kept (unverified, see docs). */
export function signedRequestUserId(signedRequest: unknown): string | null {
  if (typeof signedRequest !== "string") return null;
  const [, payload] = signedRequest.split(".");
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { user_id?: unknown };
    return typeof parsed.user_id === "string" && /^\d{1,40}$/.test(parsed.user_id) ? parsed.user_id : null;
  } catch {
    return null;
  }
}

export function createPrivacyPublicRoutes() {
  const routes = new Hono<AppBindings>();

  routes.post("/veri-silme-talebi", publicLimit("privacy:deletion-form"), requireDatabase, async (context) => {
    const parsed = formSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: { code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Geçersiz istek" } }, 400);
    const input = parsed.data;
    const created = await repository(context).create({
      source: "form",
      fullName: input.ad,
      email: input.email,
      phone: input.telefon,
      instagramUsername: input.instagram_kullanici_adi,
      messengerPsid: input.messenger_psid,
      description: input.aciklama,
      requestedAt: input.tarih ? new Date(input.tarih) : new Date(),
    });
    return context.json(
      { success: true, message: "Veri silme talebi alındı. En geç 30 gün içinde işleme alınacaktır.", referans: created.reference, reference: created.reference },
      201,
    );
  });

  routes.post("/facebook/data-deletion", publicLimit("privacy:facebook-deletion"), requireDatabase, async (context) => {
    const type = context.req.header("content-type") ?? "";
    let signedRequest: unknown;
    try {
      signedRequest = type.includes("application/json") ? ((await context.req.json()) as { signed_request?: unknown }).signed_request : (await context.req.parseBody()).signed_request;
    } catch {
      signedRequest = undefined;
    }
    const created = await repository(context).create({
      source: "facebook",
      fullName: null,
      email: null,
      phone: null,
      instagramUsername: null,
      messengerPsid: signedRequestUserId(signedRequest),
      description: null,
      requestedAt: new Date(),
    });
    // The status page lives on the panel, so prefer the first configured CORS origin over the API host.
    const panelOrigin = context.get("config").corsOrigin?.split(",")[0]?.trim();
    const origin = panelOrigin && /^https?:\/\//.test(panelOrigin) ? panelOrigin.replace(/\/$/, "") : new URL(context.req.url).origin;
    return context.json({ url: `${origin}/veri-silme?ref=${encodeURIComponent(created.reference)}`, confirmation_code: created.reference });
  });

  routes.get("/veri-silme-talebi/:reference", publicLimit("privacy:deletion-status"), requireDatabase, async (context) => {
    const row = await repository(context).findByReference(context.req.param("reference") ?? "");
    if (!row) return context.json({ error: { code: "not_found", message: "Talep bulunamadı" } }, 404);
    // Status only: the public lookup never echoes personal data.
    return context.json({ reference: row.reference, status: row.status, requested_at: new Date(row.requested_at).toISOString(), resolved_at: row.resolved_at ? new Date(row.resolved_at).toISOString() : null });
  });

  return routes;
}

const statusUpdateSchema = z.object({ status: z.enum(dataDeletionStatuses), note: z.string().trim().max(2000).nullable().optional() }).strict();

export function createDataDeletionAdminRoutes() {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireDatabase, authenticate, requireAdmin);

  routes.get("/", async (context) => {
    const status = context.req.query("status");
    if (status !== undefined && !(dataDeletionStatuses as readonly string[]).includes(status)) return context.json({ error: { code: "invalid_request", message: "Geçersiz durum" } }, 400);
    const limit = Math.min(Math.max(Number(context.req.query("limit") ?? 25) || 25, 1), 100);
    const offset = Math.max(Number(context.req.query("offset") ?? 0) || 0, 0);
    const { rows, total } = await repository(context).list({ ...(status ? { status: status as (typeof dataDeletionStatuses)[number] } : {}), limit, offset });
    return context.json({ data: rows.map(serializeDataDeletionRequest), total_count: total, limit, offset });
  });

  routes.patch("/:public_id", async (context) => {
    const parsed = statusUpdateSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: { code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Geçersiz istek" } }, 400);
    const updated = await repository(context).updateStatus(context.req.param("public_id") ?? "", { status: parsed.data.status, note: parsed.data.note ?? null, actorUserId: context.get("actorUserId") });
    if (!updated) return context.json({ error: { code: "not_found", message: "Talep bulunamadı" } }, 404);
    return context.json({ request: serializeDataDeletionRequest(updated) });
  });

  return routes;
}
