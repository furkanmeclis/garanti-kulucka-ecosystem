import { createHash, randomBytes } from "node:crypto";
import type { AppDatabase } from "@garanti-kulucka/database";
import { hashPassword, newPublicId } from "./crypto.js";

/** Legacy Supabase `resetPasswordForEmail` / `updateUser({ password })`: single-use hashed tokens, 1 hour. */

export const passwordResetTtlMs = 60 * 60 * 1000;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class PasswordResetRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Returns the raw token for an active user, or null (the caller answers the same way either way). */
  async createToken(email: string, requestedIp: string | null, now = new Date()): Promise<{ token: string; publicId: string; email: string; firstName: string | null } | null> {
    const user = await this.db
      .selectFrom("users")
      .select(["id", "email", "first_name"])
      .where((eb) => eb(eb.fn("lower", ["email"]), "=", email.trim().toLowerCase()))
      .where("is_active", "=", true)
      .executeTakeFirst();
    if (!user) return null;
    const token = randomBytes(32).toString("base64url");
    const publicId = newPublicId("prt");
    await this.db
      .insertInto("password_reset_tokens")
      .values({ public_id: publicId, user_id: user.id, token_hash: hashResetToken(token), expires_at: new Date(now.getTime() + passwordResetTtlMs), used_at: null, requested_ip: requestedIp })
      .execute();
    return { token, publicId, email: user.email, firstName: user.first_name ?? null };
  }

  /** Sets the new password, burns the token (and the user's other open tokens) and revokes every session. */
  async consume(token: string, password: string, now = new Date()): Promise<boolean> {
    const passwordHash = await hashPassword(password);
    return this.db.transaction().execute(async (transaction) => {
      const row = await transaction
        .selectFrom("password_reset_tokens")
        .innerJoin("users", "users.id", "password_reset_tokens.user_id")
        .select(["password_reset_tokens.id as id", "password_reset_tokens.user_id as user_id", "password_reset_tokens.expires_at as expires_at", "password_reset_tokens.used_at as used_at", "users.is_active as is_active"])
        .where("password_reset_tokens.token_hash", "=", hashResetToken(token))
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.used_at || !row.is_active || new Date(row.expires_at).getTime() <= now.getTime()) return false;
      await transaction.updateTable("users").set({ password_hash: passwordHash, updated_at: now }).where("id", "=", row.user_id).execute();
      await transaction
        .updateTable("password_reset_tokens")
        .set({ used_at: now, updated_at: now })
        .where("user_id", "=", row.user_id)
        .where("used_at", "is", null)
        .execute();
      await transaction.updateTable("user_sessions").set({ revoked_at: now, updated_at: now }).where("user_id", "=", row.user_id).where("revoked_at", "is", null).execute();
      await transaction
        .insertInto("audit_logs")
        .values({ actor_user_id: row.user_id, action: "update", entity_type: "users", entity_id: null, old_value: null, new_value: { password_reset: true }, ip_address: null, user_agent: null })
        .execute();
      return true;
    });
  }
}
