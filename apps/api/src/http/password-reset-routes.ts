import { Hono, type Context } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { requireDatabase } from "./middleware.js";
import { clientIp, rateLimit } from "./rate-limit.js";
import { PasswordResetRepository } from "../auth/password-reset-repository.js";

/**
 * Legacy ResetPasswordPage (Supabase auth.resetPasswordForEmail + updateUser). `POST /request` always answers 202
 * (no account enumeration) and, for an active user, queues `smtp.email.send` with a one-hour single-use link to
 * `/sifre-sifirla?token=` on the panel the request came from. `POST /confirm` sets the password and signs the
 * user out everywhere. The SMTP call itself is behind `providers.smtp.live_mode`.
 */

const requestSchema = z.object({ email: z.string().trim().email().max(320) });
const confirmSchema = z.object({ token: z.string().trim().min(20).max(200), password: z.string().min(6).max(200) });

const limit = (namespace: string, max: number) => rateLimit({ namespace, limit: max, windowMs: 10 * 60_000, key: (context) => clientIp(context) });

/** The reset link opens on the panel that asked for it when that panel is an allowed CORS origin. */
function panelOrigin(context: Context<AppBindings>) {
  const allowed = (context.get("config").corsOrigin ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter((value) => /^https?:\/\//.test(value));
  const requested = context.req.header("origin")?.replace(/\/$/, "");
  if (requested && allowed.includes(requested)) return requested;
  return allowed[0] ?? new URL(context.req.url).origin;
}

function resetMail(link: string, firstName: string | null) {
  const greeting = firstName ? `Merhaba ${firstName},` : "Merhaba,";
  const text = [
    greeting,
    "",
    "Garanti Kuluçka paneli için şifre sıfırlama isteği aldık. Yeni şifrenizi belirlemek için bağlantıyı açın:",
    link,
    "",
    "Bağlantı 1 saat geçerlidir ve yalnızca bir kez kullanılabilir. Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.",
  ].join("\n");
  const html = `<p>${greeting}</p><p>Garanti Kuluçka paneli için şifre sıfırlama isteği aldık. Yeni şifrenizi belirlemek için aşağıdaki bağlantıyı açın:</p><p><a href="${link}">Şifremi sıfırla</a></p><p>Bağlantı 1 saat geçerlidir ve yalnızca bir kez kullanılabilir. Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>`;
  return { subject: "Garanti Kuluçka şifre sıfırlama", text, html };
}

export function createPasswordResetRoutes() {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireDatabase);

  routes.post("/request", limit("password-reset-request", 5), async (context) => {
    const payload = requestSchema.safeParse(await context.req.json().catch(() => null));
    if (!payload.success) return context.json({ error: { code: "invalid_request", message: "Geçerli bir e-posta adresi girin" } }, 400);
    const created = await new PasswordResetRepository(context.get("db")!).createToken(payload.data.email, clientIp(context));
    if (created) {
      const link = `${panelOrigin(context)}/sifre-sifirla?token=${encodeURIComponent(created.token)}`;
      const mail = resetMail(link, created.firstName);
      const occurredAt = new Date().toISOString();
      const job = jobEnvelopeSchema.parse({
        job_id: `job_password_reset_${created.publicId}`,
        queue: "provider-delivery",
        name: "smtp.email.send",
        payload: providerDeliveryJobPayloadSchema.parse({
          envelope: {
            request_id: `req_password_reset_${created.publicId}`,
            provider: "smtp",
            operation: "email.send",
            direction: "outbound",
            channel: "email",
            occurred_at: occurredAt,
            payload: { to: created.email, template: "password_reset", ...mail, idempotency_key: `password_reset:${created.publicId}` },
            legacy_contract: { source: "frontend/src/services/supabase.js auth.resetPasswordForEmail", legacy_event: "password_reset_requested" },
          },
        }),
        requested_at: occurredAt,
        request_id: context.get("requestId"),
      });
      await context.get("providerDeliveryQueuePublisher").publish(job);
    }
    return context.json({ accepted: true }, 202);
  });

  routes.post("/confirm", limit("password-reset-confirm", 10), async (context) => {
    const payload = confirmSchema.safeParse(await context.req.json().catch(() => null));
    if (!payload.success) return context.json({ error: { code: "invalid_request", message: "Şifre en az 6 karakter olmalı" } }, 400);
    const reset = await new PasswordResetRepository(context.get("db")!).consume(payload.data.token, payload.data.password);
    if (!reset) return context.json({ error: { code: "invalid_token", message: "Bağlantı geçersiz ya da süresi dolmuş. Yeni bir sıfırlama isteği gönderin." } }, 400);
    return context.json({ reset: true });
  });

  return routes;
}
