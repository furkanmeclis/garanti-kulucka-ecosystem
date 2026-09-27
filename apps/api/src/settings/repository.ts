import type { AppDatabase } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import type { SettingsTable } from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";

export type SettingRecord = Selectable<SettingsTable>;

export interface UpsertSettingInput {
  key: string;
  scope: string;
  value: unknown;
  isSecret: boolean;
  actorUserId: number | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export class SettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(scope: string): Promise<SettingRecord[]> {
    return this.db
      .selectFrom("settings")
      .selectAll()
      .where("scope", "=", scope)
      .orderBy("key", "asc")
      .execute();
  }

  async upsert(input: UpsertSettingInput): Promise<SettingRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const previous = await transaction
        .selectFrom("settings")
        .selectAll()
        .where("scope", "=", input.scope)
        .where("key", "=", input.key)
        .executeTakeFirst();

      const setting = await transaction
        .insertInto("settings")
        .values({
          public_id: newPublicId("set"),
          key: input.key,
          scope: input.scope,
          value: input.value,
          is_secret: input.isSecret,
        })
        .onConflict((conflict) =>
          conflict.columns(["scope", "key"]).doUpdateSet({
            value: input.value,
            is_secret: input.isSecret,
            updated_at: new Date(),
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      await transaction
        .insertInto("audit_logs")
        .values({
          actor_user_id: input.actorUserId,
          action: "settings_change",
          entity_type: "settings",
          entity_id: setting.public_id,
          old_value: previous ? { value: previous.value, is_secret: previous.is_secret } : null,
          new_value: { value: setting.value, is_secret: setting.is_secret },
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
        })
        .execute();

      return setting;
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
