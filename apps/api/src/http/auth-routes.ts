import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { createRefreshToken, verifyPassword } from "../auth/crypto.js";
import { AuthRepository, serializeAuthUser } from "../auth/repository.js";
import { signAccessToken } from "../auth/tokens.js";

const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshRequestSchema = z.object({
  refresh_token: z.string().min(16),
});

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

export function createAuthRoutes() {
  const routes = new Hono<AppBindings>();

  routes.post("/login", requireDatabase, async (context) => {
    const payload = loginRequestSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid login payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const repository = new AuthRepository(db);
    const user = await repository.findUserByEmail(payload.data.email);
    const isPasswordValid = user ? await verifyPassword(user.password_hash, payload.data.password) : false;

    await db
      .insertInto("login_attempts")
      .values({
        email: payload.data.email.toLowerCase(),
        ip_address: context.req.header("x-forwarded-for") ?? null,
        user_agent: context.req.header("user-agent") ?? null,
        success: isPasswordValid,
        failure_reason: isPasswordValid ? null : "invalid_credentials",
      })
      .execute();

    if (!user || !isPasswordValid) {
      return context.json({ error: { code: "invalid_credentials", message: "Email or password is incorrect" } }, 401);
    }

    const refreshToken = createRefreshToken();
    const refreshExpiresAt = daysFromNow(context.get("config").refreshTokenTtlDays);
    const session = await repository.createSession({
      userId: user.id,
      userAgent: context.req.header("user-agent") ?? null,
      ipAddress: context.req.header("x-forwarded-for") ?? null,
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt,
      sessionExpiresAt: refreshExpiresAt,
    });

    const accessToken = await signAccessToken(
      {
        user_public_id: user.public_id,
        session_public_id: session.public_id,
        role: user.role_name,
      },
      context.get("config"),
    );

    return context.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: context.get("config").accessTokenTtlSeconds,
      user: serializeAuthUser(user, await repository.listUserPermissions(user.id)),
    });
  });

  routes.post("/refresh", requireDatabase, async (context) => {
    const payload = refreshRequestSchema.safeParse(await context.req.json());
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid refresh payload" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const repository = new AuthRepository(db);
    const nextRefreshToken = createRefreshToken();
    const rotated = await repository.rotateRefreshToken(
      payload.data.refresh_token,
      nextRefreshToken,
      daysFromNow(context.get("config").refreshTokenTtlDays),
    );

    if (!rotated) {
      return context.json({ error: { code: "invalid_refresh_token", message: "Refresh token is invalid" } }, 401);
    }

    const accessToken = await signAccessToken(
      {
        user_public_id: rotated.userPublicId,
        session_public_id: rotated.sessionPublicId,
        role: rotated.roleName,
      },
      context.get("config"),
    );

    return context.json({
      access_token: accessToken,
      refresh_token: nextRefreshToken,
      token_type: "Bearer",
      expires_in: context.get("config").accessTokenTtlSeconds,
    });
  });

  routes.post("/logout", authenticate, async (context) => {
    const auth = context.get("auth");
    const db = context.get("db");
    if (auth && db) {
      await new AuthRepository(db).revokeSession(auth.session_public_id);
    }

    return context.json({ status: "ok" });
  });

  routes.get("/me", authenticate, async (context) => {
    const db = context.get("db");
    const auth = context.get("auth");
    if (!db || !auth) {
      return context.json({ error: { code: "unauthorized", message: "Session is not available" } }, 401);
    }

    const repository = new AuthRepository(db);
    const user = await repository.findUserByPublicId(auth.user_public_id);
    if (!user) {
      return context.json({ error: { code: "unauthorized", message: "Session is not available" } }, 401);
    }

    return context.json(serializeAuthUser(user, await repository.listUserPermissions(user.id)));
  });

  return routes;
}
