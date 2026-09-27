import type { AppDatabase } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import type { RolesTable, UserSessionsTable, UsersTable } from "@garanti-kulucka/database";
import { hashToken, newPublicId } from "./crypto.js";

export type AuthUserRecord = Selectable<UsersTable> & { role_name: string };
export type AuthSessionRecord = Selectable<UserSessionsTable>;

export interface CreateSessionInput {
  userId: number;
  userAgent: string | null;
  ipAddress: string | null;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  sessionExpiresAt: Date;
}

export class AuthRepository {
  constructor(private readonly db: AppDatabase) {}

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const user = await this.db
      .selectFrom("users")
      .innerJoin("roles", "roles.id", "users.role_id")
      .selectAll("users")
      .select("roles.name as role_name")
      .where((expression) => expression("email", "=", email.toLowerCase()))
      .where("is_active", "=", true)
      .executeTakeFirst();

    return user ?? null;
  }

  async findUserByPublicId(publicId: string): Promise<AuthUserRecord | null> {
    const user = await this.db
      .selectFrom("users")
      .innerJoin("roles", "roles.id", "users.role_id")
      .selectAll("users")
      .select("roles.name as role_name")
      .where("users.public_id", "=", publicId)
      .where("is_active", "=", true)
      .executeTakeFirst();

    return user ?? null;
  }

  async findSessionByPublicId(publicId: string): Promise<AuthSessionRecord | null> {
    const session = await this.db
      .selectFrom("user_sessions")
      .selectAll()
      .where("public_id", "=", publicId)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", new Date())
      .executeTakeFirst();

    return session ?? null;
  }

  async createSession(input: CreateSessionInput): Promise<AuthSessionRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const session = await transaction
        .insertInto("user_sessions")
        .values({
          public_id: newPublicId("ses"),
          user_id: input.userId,
          user_agent: input.userAgent,
          ip_address: input.ipAddress,
          expires_at: input.sessionExpiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await transaction
        .insertInto("refresh_tokens")
        .values({
          public_id: newPublicId("rtk"),
          session_id: session.id,
          token_hash: hashToken(input.refreshToken),
          expires_at: input.refreshTokenExpiresAt,
        })
        .execute();

      await transaction
        .updateTable("users")
        .set({ last_seen_at: new Date(), is_online: true })
        .where("id", "=", input.userId)
        .execute();

      return session;
    });
  }

  async rotateRefreshToken(refreshToken: string, nextRefreshToken: string, expiresAt: Date) {
    return this.db.transaction().execute(async (transaction) => {
      const currentToken = await transaction
        .selectFrom("refresh_tokens")
        .innerJoin("user_sessions", "user_sessions.id", "refresh_tokens.session_id")
        .innerJoin("users", "users.id", "user_sessions.user_id")
        .innerJoin("roles", "roles.id", "users.role_id")
        .selectAll("refresh_tokens")
        .select([
          "user_sessions.public_id as session_public_id",
          "users.id as user_id",
          "users.public_id as user_public_id",
          "roles.name as role_name",
        ])
        .where("refresh_tokens.token_hash", "=", hashToken(refreshToken))
        .where("refresh_tokens.revoked_at", "is", null)
        .where("refresh_tokens.used_at", "is", null)
        .where("refresh_tokens.expires_at", ">", new Date())
        .where("user_sessions.revoked_at", "is", null)
        .where("users.is_active", "=", true)
        .executeTakeFirst();

      if (!currentToken) {
        return null;
      }

      await transaction
        .updateTable("refresh_tokens")
        .set({ used_at: new Date() })
        .where("id", "=", currentToken.id)
        .execute();

      await transaction
        .insertInto("refresh_tokens")
        .values({
          public_id: newPublicId("rtk"),
          session_id: currentToken.session_id,
          token_hash: hashToken(nextRefreshToken),
          expires_at: expiresAt,
        })
        .execute();

      return {
        userPublicId: currentToken.user_public_id,
        sessionPublicId: currentToken.session_public_id,
        roleName: currentToken.role_name,
      };
    });
  }

  async revokeSession(sessionPublicId: string): Promise<void> {
    await this.db
      .updateTable("user_sessions")
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where("public_id", "=", sessionPublicId)
      .execute();
  }
}

export function isAdminRole(role: Selectable<RolesTable>["name"] | string): boolean {
  return role === "admin" || role === "owner";
}
