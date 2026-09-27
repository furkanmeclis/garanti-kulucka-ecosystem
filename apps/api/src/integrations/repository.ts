import type { AppDatabase } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import type {
  IntegrationAccountsTable,
  IntegrationProvidersTable,
  IntegrationSettingsTable,
  IntegrationTokensTable,
} from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";
import type { SecretEncryptor } from "../security/encryption.js";

export type IntegrationProviderRecord = Selectable<IntegrationProvidersTable>;
export type IntegrationAccountRecord = Selectable<IntegrationAccountsTable> & {
  provider_key: string;
  provider_name: string;
};
export type IntegrationSettingRecord = Selectable<IntegrationSettingsTable>;
export type IntegrationTokenRecord = Selectable<IntegrationTokensTable>;

export interface IntegrationAccountSnapshot {
  account: IntegrationAccountRecord;
  settings: IntegrationSettingRecord[];
  tokens: IntegrationTokenRecord[];
}

export interface UpsertAccountInput {
  providerKey: string;
  displayName: string;
  externalAccountId: string | null;
  metadata: unknown;
  actorUserId: number | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface UpsertIntegrationSettingInput {
  accountPublicId: string;
  key: string;
  value: unknown;
  isSecret: boolean;
  actorUserId: number | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface UpsertTokenInput {
  accountPublicId: string;
  tokenType: string;
  value: unknown;
  expiresAt: Date | null;
  actorUserId: number | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export class IntegrationsRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly encryptor: SecretEncryptor,
  ) {}

  async listProviders(): Promise<IntegrationProviderRecord[]> {
    return this.db
      .selectFrom("integration_providers")
      .selectAll()
      .orderBy("key", "asc")
      .execute();
  }

  async listAccounts(): Promise<IntegrationAccountRecord[]> {
    return this.db
      .selectFrom("integration_accounts")
      .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
      .selectAll("integration_accounts")
      .select([
        "integration_providers.key as provider_key",
        "integration_providers.name as provider_name",
      ])
      .orderBy("integration_accounts.display_name", "asc")
      .execute();
  }

  async getAccountSnapshot(accountPublicId: string): Promise<IntegrationAccountSnapshot | null> {
    const account = await this.db
      .selectFrom("integration_accounts")
      .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
      .selectAll("integration_accounts")
      .select([
        "integration_providers.key as provider_key",
        "integration_providers.name as provider_name",
      ])
      .where("integration_accounts.public_id", "=", accountPublicId)
      .executeTakeFirst();

    if (!account) {
      return null;
    }

    const [settings, tokens] = await Promise.all([
      this.db
        .selectFrom("integration_settings")
        .selectAll()
        .where("account_id", "=", account.id)
        .orderBy("key", "asc")
        .execute(),
      this.db
        .selectFrom("integration_tokens")
        .selectAll()
        .where("account_id", "=", account.id)
        .orderBy("token_type", "asc")
        .execute(),
    ]);

    return { account, settings, tokens };
  }

  async upsertAccount(input: UpsertAccountInput): Promise<IntegrationAccountRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const provider = await transaction
        .selectFrom("integration_providers")
        .selectAll()
        .where("key", "=", input.providerKey)
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!provider) {
        throw new Error(`Unknown integration provider: ${input.providerKey}`);
      }

      const existing = input.externalAccountId
        ? await transaction
            .selectFrom("integration_accounts")
            .select("id")
            .where("provider_id", "=", provider.id)
            .where("external_account_id", "=", input.externalAccountId)
            .executeTakeFirst()
        : null;

      const account = existing
        ? await transaction
            .updateTable("integration_accounts")
            .set({
              display_name: input.displayName,
              metadata: input.metadata,
              status: "active",
              updated_at: new Date(),
            })
            .where("id", "=", existing.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await transaction
            .insertInto("integration_accounts")
            .values({
              public_id: newPublicId("iac"),
              provider_id: provider.id,
              display_name: input.displayName,
              external_account_id: input.externalAccountId,
              status: "active",
              metadata: input.metadata,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

      await transaction
        .insertInto("audit_logs")
        .values({
          actor_user_id: input.actorUserId,
          action: "settings_change",
          entity_type: "integration_accounts",
          entity_id: account.public_id,
          old_value: null,
          new_value: {
            provider_key: provider.key,
            display_name: account.display_name,
            external_account_id: account.external_account_id,
          },
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
        })
        .execute();

      return {
        ...account,
        provider_key: provider.key,
        provider_name: provider.name,
      };
    });
  }

  async upsertSetting(input: UpsertIntegrationSettingInput): Promise<IntegrationSettingRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const account = await transaction
        .selectFrom("integration_accounts")
        .select(["id", "provider_id", "public_id"])
        .where("public_id", "=", input.accountPublicId)
        .executeTakeFirst();

      if (!account) {
        throw new Error(`Unknown integration account: ${input.accountPublicId}`);
      }

      const storedValue = input.isSecret ? this.encryptor.encryptJson(input.value) : input.value;

      const setting = await transaction
        .insertInto("integration_settings")
        .values({
          public_id: newPublicId("ist"),
          account_id: account.id,
          provider_id: account.provider_id,
          key: input.key,
          value: storedValue,
          is_secret: input.isSecret,
        })
        .onConflict((conflict) =>
          conflict.columns(["provider_id", "account_id", "key"]).doUpdateSet({
            value: storedValue,
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
          entity_type: "integration_settings",
          entity_id: setting.public_id,
          old_value: null,
          new_value: {
            key: input.key,
            value: input.isSecret ? "[redacted]" : storedValue,
            is_secret: input.isSecret,
          },
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
        })
        .execute();

      return setting;
    });
  }

  async upsertToken(input: UpsertTokenInput): Promise<IntegrationTokenRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const account = await transaction
        .selectFrom("integration_accounts")
        .select(["id", "public_id"])
        .where("public_id", "=", input.accountPublicId)
        .executeTakeFirst();

      if (!account) {
        throw new Error(`Unknown integration account: ${input.accountPublicId}`);
      }

      const encryptedValue = JSON.stringify(this.encryptor.encryptJson(input.value));

      const existing = await transaction
        .selectFrom("integration_tokens")
        .select("id")
        .where("account_id", "=", account.id)
        .where("token_type", "=", input.tokenType)
        .executeTakeFirst();

      const token = existing
        ? await transaction
            .updateTable("integration_tokens")
            .set({
              encrypted_value: encryptedValue,
              expires_at: input.expiresAt,
              last_refreshed_at: new Date(),
              updated_at: new Date(),
            })
            .where("id", "=", existing.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await transaction
            .insertInto("integration_tokens")
            .values({
              public_id: newPublicId("itk"),
              account_id: account.id,
              token_type: input.tokenType,
              encrypted_value: encryptedValue,
              expires_at: input.expiresAt,
              last_refreshed_at: new Date(),
            })
            .returningAll()
            .executeTakeFirstOrThrow();

      await transaction
        .insertInto("audit_logs")
        .values({
          actor_user_id: input.actorUserId,
          action: "settings_change",
          entity_type: "integration_tokens",
          entity_id: token.public_id,
          old_value: null,
          new_value: {
            token_type: token.token_type,
            value: "[redacted]",
            expires_at: token.expires_at,
          },
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
        })
        .execute();

      return token;
    });
  }
}

export function serializeProvider(provider: IntegrationProviderRecord) {
  return {
    key: provider.key,
    name: provider.name,
    is_active: provider.is_active,
  };
}

export function serializeAccount(account: IntegrationAccountRecord) {
  return {
    public_id: account.public_id,
    provider_key: account.provider_key,
    provider_name: account.provider_name,
    display_name: account.display_name,
    external_account_id: account.external_account_id,
    status: account.status,
    metadata: account.metadata,
    updated_at: account.updated_at,
  };
}

export function serializeIntegrationSetting(setting: IntegrationSettingRecord) {
  return {
    public_id: setting.public_id,
    key: setting.key,
    value: setting.is_secret ? null : setting.value,
    is_secret: setting.is_secret,
    updated_at: setting.updated_at,
  };
}

export function serializeIntegrationToken(token: IntegrationTokenRecord) {
  return {
    public_id: token.public_id,
    token_type: token.token_type,
    value: null,
    expires_at: token.expires_at,
    last_refreshed_at: token.last_refreshed_at,
    updated_at: token.updated_at,
  };
}

export function serializeAccountSnapshot(snapshot: IntegrationAccountSnapshot) {
  return {
    account: serializeAccount(snapshot.account),
    settings: snapshot.settings.map(serializeIntegrationSetting),
    tokens: snapshot.tokens.map(serializeIntegrationToken),
  };
}
