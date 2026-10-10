import type { AppDatabase } from "@garanti-kulucka/database";
import { sql } from "kysely";
import { hashPassword, newPublicId } from "../auth/crypto.js";
import type { SecretEncryptor } from "../security/encryption.js";

export const managedUserRoles = ["admin", "calisan", "kargo_operatoru"] as const;
export type ManagedUserRole = (typeof managedUserRoles)[number];

export interface AdminUserRecord {
  id: number;
  public_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  is_online: boolean;
  last_seen_at: Date | string | null;
  sip_username: string | null;
  sip_password_encrypted: string | null;
  created_at: Date | string;
}

export interface AdminLogRecord {
  id: number;
  actor_user_id: number | null;
  actor_first_name: string | null;
  actor_last_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: Date | string;
}

export interface CreateManagedUserInput {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  password: string;
  role: ManagedUserRole;
  actorUserId: number | null;
}

export interface UpdateManagedUserInput {
  userPublicId: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  role?: ManagedUserRole;
  isActive?: boolean;
  password?: string;
  sipUsername?: string | null;
  sipPassword?: string | null;
  actorUserId: number | null;
}

export class ManagedUserNotFoundError extends Error {
  constructor() {
    super("Kullanıcı bulunamadı");
  }
}

export class DuplicateUserEmailError extends Error {
  constructor() {
    super("Bu e-posta ile kayıtlı kullanıcı var");
  }
}

export class SelfDeactivationError extends Error {
  constructor() {
    super("Kendi hesabınızı pasife alamazsınız");
  }
}

export class AdminUsersRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly encryptor: SecretEncryptor,
  ) {}

  private baseQuery() {
    return this.db
      .selectFrom("users")
      .innerJoin("roles", "roles.id", "users.role_id")
      .select([
        "users.id",
        "users.public_id",
        "users.email",
        "users.first_name",
        "users.last_name",
        "users.phone",
        "roles.name as role",
        "users.is_active",
        "users.is_online",
        "users.last_seen_at",
        "users.sip_username",
        "users.sip_password_encrypted",
        "users.created_at",
      ]);
  }

  async list(): Promise<AdminUserRecord[]> {
    return (await this.baseQuery().orderBy("users.created_at", "desc").orderBy("users.id", "desc").execute()) as AdminUserRecord[];
  }

  async findByPublicId(publicId: string): Promise<AdminUserRecord | null> {
    const row = await this.baseQuery().where("users.public_id", "=", publicId).executeTakeFirst();
    return (row as AdminUserRecord | undefined) ?? null;
  }

  private async ensureRole(role: ManagedUserRole): Promise<number> {
    const existing = await this.db.selectFrom("roles").select("id").where("name", "=", role).executeTakeFirst();
    if (existing) return Number(existing.id);
    const created = await this.db
      .insertInto("roles")
      .values({ public_id: newPublicId("rol"), name: role, description: null, is_system: false })
      .onConflict((conflict) => conflict.column("name").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (created) return Number(created.id);
    const row = await this.db.selectFrom("roles").select("id").where("name", "=", role).executeTakeFirstOrThrow();
    return Number(row.id);
  }

  async create(input: CreateManagedUserInput): Promise<AdminUserRecord> {
    const email = input.email.trim().toLowerCase();
    const duplicate = await this.db
      .selectFrom("users")
      .select("id")
      .where(sql<string>`lower(email)`, "=", email)
      .executeTakeFirst();
    if (duplicate) throw new DuplicateUserEmailError();

    const roleId = await this.ensureRole(input.role);
    const passwordHash = await hashPassword(input.password);
    const publicId = newPublicId("usr");
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("users")
        .values({
          public_id: publicId,
          role_id: roleId,
          email,
          password_hash: passwordHash,
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone,
          is_active: true,
          is_online: false,
        })
        .execute();
      await transaction
        .insertInto("audit_logs")
        .values({
          actor_user_id: input.actorUserId,
          action: "create",
          entity_type: "users",
          entity_id: publicId,
          old_value: null,
          new_value: { email, role: input.role },
          ip_address: null,
          user_agent: null,
        })
        .execute();
    });
    const created = await this.findByPublicId(publicId);
    if (!created) throw new ManagedUserNotFoundError();
    return created;
  }

  async update(input: UpdateManagedUserInput): Promise<AdminUserRecord> {
    const current = await this.findByPublicId(input.userPublicId);
    if (!current) throw new ManagedUserNotFoundError();
    if (input.isActive === false && input.actorUserId !== null && current.id === input.actorUserId) {
      throw new SelfDeactivationError();
    }

    const patch: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};
    if (input.firstName !== undefined) patch.first_name = changed.first_name = input.firstName;
    if (input.lastName !== undefined) patch.last_name = changed.last_name = input.lastName;
    if (input.phone !== undefined) patch.phone = changed.phone = input.phone;
    if (input.role !== undefined) {
      patch.role_id = await this.ensureRole(input.role);
      changed.role = input.role;
    }
    if (input.isActive !== undefined) patch.is_active = changed.is_active = input.isActive;
    if (input.password !== undefined) {
      patch.password_hash = await hashPassword(input.password);
      changed.password = "[redacted]";
    }
    if (input.sipUsername !== undefined) patch.sip_username = changed.sip_username = input.sipUsername;
    if (input.sipPassword !== undefined) {
      patch.sip_password_encrypted = input.sipPassword ? JSON.stringify(this.encryptor.encryptJson(input.sipPassword)) : null;
      changed.sip_password = "[redacted]";
    }

    await this.db.transaction().execute(async (transaction) => {
      if (Object.keys(patch).length > 0) {
        await transaction
          .updateTable("users")
          .set({ ...patch, updated_at: new Date() })
          .where("id", "=", current.id)
          .execute();
      }
      if (input.isActive === false || input.password !== undefined) {
        await transaction
          .updateTable("user_sessions")
          .set({ revoked_at: new Date() })
          .where("user_id", "=", current.id)
          .where("revoked_at", "is", null)
          .execute();
      }
      await transaction
        .insertInto("audit_logs")
        .values({
          actor_user_id: input.actorUserId,
          action: "update",
          entity_type: "users",
          entity_id: current.public_id,
          old_value: null,
          new_value: changed,
          ip_address: null,
          user_agent: null,
        })
        .execute();
    });

    const updated = await this.findByPublicId(input.userPublicId);
    if (!updated) throw new ManagedUserNotFoundError();
    return updated;
  }

  /**
   * Legacy Mesajlar "aktif temsilci" chip: a manager sets another agent offline. Same column change as the agent's
   * own `PATCH /auth/presence` (no pool/assignment side effects), plus an audit row naming the actor.
   */
  async setOffline(input: { userPublicId: string; actorUserId: number | null }): Promise<AdminUserRecord> {
    const current = await this.findByPublicId(input.userPublicId);
    if (!current) throw new ManagedUserNotFoundError();
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .updateTable("users")
        .set({ is_online: false, updated_at: new Date() })
        .where("id", "=", current.id)
        .execute();
      await transaction
        .insertInto("audit_logs")
        .values({
          actor_user_id: input.actorUserId,
          action: "presence_offline",
          entity_type: "users",
          entity_id: current.public_id,
          old_value: { is_online: current.is_online },
          new_value: { is_online: false },
          ip_address: null,
          user_agent: null,
        })
        .execute();
    });
    return { ...current, is_online: false };
  }

  async updateOwnProfile(userId: number, firstName: string, lastName: string): Promise<void> {
    await this.db
      .updateTable("users")
      .set({ first_name: firstName, last_name: lastName, updated_at: new Date() })
      .where("id", "=", userId)
      .execute();
  }

  async updateOwnPassword(userId: number, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .updateTable("users")
        .set({ password_hash: passwordHash, updated_at: new Date() })
        .where("id", "=", userId)
        .execute();
      await transaction
        .insertInto("audit_logs")
        .values({
          actor_user_id: userId,
          action: "update",
          entity_type: "users",
          entity_id: null,
          old_value: null,
          new_value: { password: "[redacted]" },
          ip_address: null,
          user_agent: null,
        })
        .execute();
    });
  }

  async listLogs(limit: number): Promise<AdminLogRecord[]> {
    return (await this.db
      .selectFrom("audit_logs")
      .leftJoin("users", "users.id", "audit_logs.actor_user_id")
      .select([
        "audit_logs.id",
        "audit_logs.actor_user_id",
        "users.first_name as actor_first_name",
        "users.last_name as actor_last_name",
        "audit_logs.action",
        "audit_logs.entity_type",
        "audit_logs.entity_id",
        "audit_logs.created_at",
      ])
      .orderBy("audit_logs.created_at", "desc")
      .orderBy("audit_logs.id", "desc")
      .limit(Math.max(1, Math.min(limit, 100)))
      .execute()) as AdminLogRecord[];
  }
}

function isoDate(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function serializeAdminUser(record: AdminUserRecord) {
  return {
    public_id: record.public_id,
    email: record.email,
    first_name: record.first_name,
    last_name: record.last_name,
    phone: record.phone,
    role: record.role,
    is_active: record.is_active,
    is_online: record.is_online,
    last_seen_at: isoDate(record.last_seen_at),
    sip_username: record.sip_username,
    sip_password_configured: Boolean(record.sip_password_encrypted),
    created_at: isoDate(record.created_at),
  };
}

export function serializeAdminLog(record: AdminLogRecord) {
  const actorName = [record.actor_first_name, record.actor_last_name].filter(Boolean).join(" ").trim();
  return {
    id: Number(record.id),
    actor_name: actorName || null,
    action: record.action,
    module: record.entity_type,
    entity_id: record.entity_id,
    created_at: isoDate(record.created_at),
  };
}
