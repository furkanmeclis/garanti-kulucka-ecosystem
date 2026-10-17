import { randomBytes } from "node:crypto";
import { sql, type AppDatabase } from "@garanti-kulucka/database";
import { z } from "zod";
import { hashPassword, newPublicId } from "../auth/crypto.js";
import type { SecretEncryptor } from "../security/encryption.js";

const userSchema = z.object({
  public_id: z.string().regex(/^usr_[a-f0-9]+$/),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  first_name: z.string(),
  last_name: z.string(),
  phone: z.string().nullable(),
  role: z.enum(["owner", "admin", "calisan", "kargo_operatoru"]),
  is_active: z.boolean(),
  sip_username: z.string().nullable(),
  sip_password: z.string().nullable(),
  sip_extension: z.string().nullable(),
}).strict();

export type LegacyBootstrapUser = z.infer<typeof userSchema>;

export function parseLegacyUsers(value: unknown): LegacyBootstrapUser[] {
  const parsed = z.array(userSchema).min(1).safeParse(value);
  // Never include validation input (PII or SIP passwords) in an error.
  if (!parsed.success) throw new Error("Invalid legacy users file");
  const users = parsed.data;
  if (new Set(users.map((user) => user.public_id)).size !== users.length ||
      new Set(users.map((user) => user.email)).size !== users.length) {
    throw new Error("Duplicate identities in legacy users file");
  }
  return users;
}

/** One transaction: conflicts or output failures roll back the entire batch. */
export async function bootstrapLegacyUsers(
  db: AppDatabase,
  users: LegacyBootstrapUser[],
  encryptor: SecretEncryptor,
  writeCredentials: (credentials: Record<string, string>) => Promise<void>,
): Promise<{ created: number; skipped: number }> {
  users = parseLegacyUsers(users);
  return db.transaction().execute(async (transaction) => {
    // Serialise concurrent bootstrap runs, including the existence checks.
    await sql`SELECT pg_advisory_xact_lock(294029)`.execute(transaction);
    const credentials: Record<string, string> = Object.create(null) as Record<string, string>;
    let created = 0;
    let skipped = 0;
    for (const user of users) {
      const emailOwner = await transaction.selectFrom("users").select("public_id")
        .where(sql<string>`lower(email)`, "=", user.email).executeTakeFirst();
      if (emailOwner && emailOwner.public_id !== user.public_id) {
        throw new Error("Email belongs to a different public id; bootstrap aborted");
      }
      const existing = await transaction.selectFrom("users").select("public_id")
        .where("public_id", "=", user.public_id).executeTakeFirst();
      if (existing) { skipped++; continue; }
      let role = await transaction.selectFrom("roles").select("id").where("name", "=", user.role).executeTakeFirst();
      // Initial migrations seed owner/admin; the existing admin API also creates managed roles on demand.
      if (!role && (user.role === "calisan" || user.role === "kargo_operatoru")) {
        await transaction.insertInto("roles").values({ public_id: newPublicId("rol"), name: user.role, description: null, is_system: false })
          .onConflict((conflict) => conflict.column("name").doNothing()).execute();
        role = await transaction.selectFrom("roles").select("id").where("name", "=", user.role).executeTakeFirst();
      }
      if (!role) throw new Error("Required role is missing; run migrations first");
      const password = randomBytes(32).toString("base64url");
      await transaction.insertInto("users").values({
        public_id: user.public_id, email: user.email, first_name: user.first_name,
        last_name: user.last_name, phone: user.phone, role_id: role.id,
        is_active: user.is_active, is_online: false, must_change_password: user.is_active,
        password_hash: await hashPassword(password),
        sip_username: user.sip_username, sip_extension: user.sip_extension,
        sip_password_encrypted: user.sip_password ? JSON.stringify(encryptor.encryptJson(user.sip_password)) : null,
      }).execute();
      if (user.is_active) credentials[user.email] = password;
      created++;
    }
    await writeCredentials(credentials);
    return { created, skipped };
  });
}
