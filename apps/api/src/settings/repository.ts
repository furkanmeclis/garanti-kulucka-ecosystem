import type { AppDatabase, SettingsTable } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import { newPublicId } from "../auth/crypto.js";
import type { SecretEncryptor } from "../security/encryption.js";
import type { SettingsCache } from "./cache.js";

export type SettingRecord = Selectable<SettingsTable>;

export interface SettingVersionRecord {
  public_id: string;
  key: string;
  scope: string;
  version: number;
  value: unknown;
  is_secret: boolean;
  created_by_user_id: number | null;
  created_at: Date;
}

export interface UpsertSettingInput {
  key: string;
  scope: string;
  value: unknown;
  isSecret: boolean;
  actorUserId: number | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RollbackSettingInput {
  key: string;
  scope: string;
  version: number;
  actorUserId: number | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export class SettingsRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly encryptor: SecretEncryptor,
    private readonly cache: SettingsCache | null = null,
  ) {}

  async list(scope: string): Promise<SettingRecord[]> {
    const cached = this.cache?.get(scope);
    if (cached) {
      return cached;
    }

    const settings = await this.db
      .selectFrom("settings")
      .selectAll()
      .where("scope", "=", scope)
      .orderBy("key", "asc")
      .execute();
    this.cache?.set(scope, settings);
    return settings;
  }

  async listVersions(scope: string, key: string): Promise<SettingVersionRecord[]> {
    return this.db
      .selectFrom("settings_versions")
      .innerJoin("settings", "settings.id", "settings_versions.settings_id")
      .select([
        "settings_versions.public_id",
        "settings.key",
        "settings.scope",
        "settings_versions.version_number as version",
        "settings_versions.value",
        "settings_versions.is_secret",
        "settings_versions.created_by_user_id",
        "settings_versions.created_at",
      ])
      .where("settings.scope", "=", scope)
      .where("settings.key", "=", key)
      .orderBy("settings_versions.version_number", "desc")
      .execute();
  }

  async upsert(input: UpsertSettingInput): Promise<{ setting: SettingRecord; version: number }> {
    return this.db.transaction().execute(async (transaction) => {
      const previous = await transaction
        .selectFrom("settings")
        .selectAll()
        .where("scope", "=", input.scope)
        .where("key", "=", input.key)
        .executeTakeFirst();
      const storedValue = input.isSecret ? this.encryptor.encryptJson(input.value) : input.value;

      const setting = await transaction
        .insertInto("settings")
        .values({
          public_id: newPublicId("set"),
          key: input.key,
          scope: input.scope,
          value: storedValue,
          is_secret: input.isSecret,
        })
        .onConflict((conflict) =>
          conflict.columns(["scope", "key"]).doUpdateSet({
            value: storedValue,
            is_secret: input.isSecret,
            updated_at: new Date(),
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      const version = await nextVersionNumber(transaction as AppDatabase, setting.id);

      await transaction
        .insertInto("settings_versions")
        .values({
          public_id: newPublicId("sev"),
          settings_id: setting.id,
          version_number: version,
          value: versionValue(setting.value, setting.is_secret),
          is_secret: setting.is_secret,
          created_by_user_id: input.actorUserId,
        })
        .execute();

      await transaction
        .insertInto("audit_logs")
        .values({
          actor_user_id: input.actorUserId,
          action: "settings_change",
          entity_type: "settings",
          entity_id: setting.public_id,
          old_value: previous ? auditValue(previous.value, previous.is_secret) : null,
          new_value: { ...auditValue(setting.value, setting.is_secret), version },
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
        })
        .execute();

      this.cache?.invalidate(setting.scope);
      return { setting, version };
    });
  }

  async rollback(input: RollbackSettingInput): Promise<{ setting: SettingRecord; version: number }> {
    return this.db.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom("settings")
        .selectAll()
        .where("scope", "=", input.scope)
        .where("key", "=", input.key)
        .executeTakeFirst();

      if (!current) {
        throw new Error(`Unknown admin setting key: ${input.key}`);
      }

      const target = await transaction
        .selectFrom("settings_versions")
        .selectAll()
        .where("settings_id", "=", current.id)
        .where("version_number", "=", input.version)
        .executeTakeFirst();

      if (!target) {
        throw new Error(`Unknown admin setting version: ${input.version}`);
      }

      if (target.is_secret) {
        throw new Error("Secret settings cannot be rolled back without re-entering the secret value");
      }

      const setting = await transaction
        .updateTable("settings")
        .set({
          value: target.value,
          is_secret: false,
          updated_at: new Date(),
        })
        .where("id", "=", current.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const version = await nextVersionNumber(transaction as AppDatabase, setting.id);

      await transaction
        .insertInto("settings_versions")
        .values({
          public_id: newPublicId("sev"),
          settings_id: setting.id,
          version_number: version,
          value: versionValue(setting.value, setting.is_secret),
          is_secret: setting.is_secret,
          created_by_user_id: input.actorUserId,
        })
        .execute();

      await transaction
        .insertInto("audit_logs")
        .values({
          actor_user_id: input.actorUserId,
          action: "settings_change",
          entity_type: "settings",
          entity_id: setting.public_id,
          old_value: { ...auditValue(current.value, current.is_secret), rollback_from_version: input.version },
          new_value: { ...auditValue(setting.value, setting.is_secret), version },
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
        })
        .execute();

      this.cache?.invalidate(setting.scope);
      return { setting, version };
    });
  }
}

export function serializeSetting(setting: SettingRecord) {
  return {
    key: setting.key,
    scope: setting.scope,
    value: setting.is_secret ? null : setting.value,
    is_secret: setting.is_secret,
    updated_at: setting.updated_at,
  };
}

export function serializeSettingVersion(version: SettingVersionRecord) {
  return {
    public_id: version.public_id,
    key: version.key,
    scope: version.scope,
    version: version.version,
    value: version.is_secret ? null : version.value,
    is_secret: version.is_secret,
    created_by_user_id: version.created_by_user_id,
    created_at: version.created_at,
  };
}

function auditValue(value: unknown, isSecret: boolean) {
  return {
    value: isSecret ? "[redacted]" : value,
    is_secret: isSecret,
  };
}

function versionValue(value: unknown, isSecret: boolean) {
  return isSecret ? { value: "[redacted]", is_secret: true } : value;
}

async function nextVersionNumber(db: AppDatabase, settingsId: number): Promise<number> {
  const latest = await db
    .selectFrom("settings_versions")
    .select("version_number")
    .where("settings_id", "=", settingsId)
    .orderBy("version_number", "desc")
    .limit(1)
    .executeTakeFirst();

  return (latest?.version_number ?? 0) + 1;
}
