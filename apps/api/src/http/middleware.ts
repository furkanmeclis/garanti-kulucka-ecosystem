import type { Context, Next } from "hono";
import type { AppBindings } from "./types.js";
import { AuthRepository, isAdminRole } from "../auth/repository.js";
import { verifyAccessToken } from "../auth/tokens.js";

export async function requireDatabase(context: Context<AppBindings>, next: Next) {
  if (!context.get("db")) {
    return context.json(
      {
        error: {
          code: "database_unavailable",
          message: "Database connection is not configured",
        },
      },
      503,
    );
  }

  return next();
}

export async function authenticate(context: Context<AppBindings>, next: Next) {
  const authorization = context.req.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

  if (!token) {
    return context.json(
      {
        error: {
          code: "unauthorized",
          message: "Authorization bearer token is required",
        },
      },
      401,
    );
  }

  try {
    const claims = await verifyAccessToken(token, context.get("config"));
    const db = context.get("db");
    if (!db) {
      return context.json(
        {
          error: {
            code: "database_unavailable",
            message: "Database connection is not configured",
          },
        },
        503,
      );
    }

    const repository = new AuthRepository(db);
    const [user, session] = await Promise.all([
      repository.findUserByPublicId(claims.user_public_id),
      repository.findSessionByPublicId(claims.session_public_id),
    ]);

    if (!user || !session || session.user_id !== user.id) {
      return context.json(
        {
          error: {
            code: "unauthorized",
            message: "Session is no longer valid",
          },
        },
        401,
      );
    }

    context.set("auth", claims);
    context.set("actorUserId", user.id);
    return next();
  } catch {
    return context.json(
      {
        error: {
          code: "unauthorized",
          message: "Access token is invalid or expired",
        },
      },
      401,
    );
  }
}

export async function requireAdmin(context: Context<AppBindings>, next: Next) {
  const auth = context.get("auth");
  if (!auth || !isAdminRole(auth.role)) {
    return context.json(
      {
        error: {
          code: "forbidden",
          message: "Admin role is required",
        },
      },
      403,
    );
  }

  return next();
}
