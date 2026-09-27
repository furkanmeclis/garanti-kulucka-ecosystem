import type { AppDatabase } from "@garanti-kulucka/database";
import { hashPassword, newPublicId } from "../auth/crypto.js";

export interface BootstrapAdminInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface BootstrapAdminResult {
  status: "created" | "exists";
  email: string;
  publicId: string;
}

export function validateBootstrapPassword(password: string): void {
  if (password.length < 12) {
    throw new Error("FIRST_ADMIN_PASSWORD must be at least 12 characters");
  }
}

export async function bootstrapAdmin(
  db: AppDatabase,
  input: BootstrapAdminInput,
): Promise<BootstrapAdminResult> {
  validateBootstrapPassword(input.password);
  const email = input.email.trim().toLowerCase();

  const existing = await db
    .selectFrom("users")
    .select(["public_id", "email"])
    .where("email", "=", email)
    .executeTakeFirst();

  if (existing) {
    return {
      status: "exists",
      email: existing.email,
      publicId: existing.public_id,
    };
  }

  const ownerRole = await db
    .selectFrom("roles")
    .select(["id"])
    .where("name", "=", "owner")
    .executeTakeFirst();

  if (!ownerRole) {
    throw new Error("Owner role is missing; run database migrations before bootstrap");
  }

  const user = await db
    .insertInto("users")
    .values({
      public_id: newPublicId("usr"),
      role_id: ownerRole.id,
      email,
      password_hash: await hashPassword(input.password),
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      phone: null,
      is_active: true,
      is_online: false,
      last_seen_at: null,
      sip_username: null,
      sip_password_encrypted: null,
    })
    .returning(["public_id", "email"])
    .executeTakeFirstOrThrow();

  return {
    status: "created",
    email: user.email,
    publicId: user.public_id,
  };
}
