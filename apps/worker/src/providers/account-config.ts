import type { AppDatabase } from "@garanti-kulucka/database";
import type { ProviderName } from "@garanti-kulucka/shared";
import type { EncryptedJsonEnvelope, SecretDecryptor } from "./encryption.js";

export interface ProviderAccountConfig {
  provider: ProviderName;
  account_public_id: string;
  live_mode: boolean;
  settings: Record<string, unknown>;
  tokens: Record<string, unknown>;
}

export interface ProviderAccountConfigRepository {
  getAccountConfig: (
    provider: ProviderName,
    accountPublicId: string | undefined,
  ) => Promise<ProviderAccountConfig | null>;
  invalidate?: () => void;
  hydrate?: () => Promise<void>;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

function settingValue(value: unknown, isSecret: boolean, decryptor: SecretDecryptor): unknown {
  if (!isSecret) {
    return value;
  }

  return decryptor.decryptJson(value as EncryptedJsonEnvelope);
}

function tokenValue(encryptedValue: string, decryptor: SecretDecryptor): unknown {
  return decryptor.decryptJson(JSON.parse(encryptedValue) as EncryptedJsonEnvelope);
}

function booleanSetting(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return false;
}

export class DatabaseProviderAccountConfigRepository implements ProviderAccountConfigRepository {
  private readonly cache = new Map<string, ProviderAccountConfig | null>();

  constructor(
    private readonly db: AppDatabase,
    private readonly decryptor: SecretDecryptor,
  ) {}

  async hydrate(): Promise<void> {
    const accounts = await this.db
      .selectFrom("integration_accounts")
      .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
      .select([
        "integration_accounts.public_id",
        "integration_providers.key as provider_key",
      ])
      .where("integration_providers.is_active", "=", true)
      .where("integration_accounts.status", "=", "active")
      .execute();

    await Promise.all(
      accounts.map((account) =>
        this.getAccountConfig(account.provider_key as ProviderName, account.public_id),
      ),
    );
  }

  invalidate(): void {
    this.cache.clear();
  }

  async getAccountConfig(
    provider: ProviderName,
    accountPublicId: string | undefined,
  ): Promise<ProviderAccountConfig | null> {
    if (!accountPublicId) {
      return null;
    }
    const cacheKey = `${provider}:${accountPublicId}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) ?? null;
    }

    const account = await this.db
      .selectFrom("integration_accounts")
      .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
      .select([
        "integration_accounts.id",
        "integration_accounts.public_id",
        "integration_providers.id as provider_id",
        "integration_providers.key as provider_key",
      ])
      .where("integration_providers.key", "=", provider)
      .where("integration_providers.is_active", "=", true)
      .where("integration_accounts.public_id", "=", accountPublicId)
      .where("integration_accounts.status", "=", "active")
      .executeTakeFirst();

    if (!account) {
      this.cache.set(cacheKey, null);
      return null;
    }

    const [globalSettings, accountSettings, tokens] = await Promise.all([
      this.db
        .selectFrom("settings")
        .select(["key", "value", "is_secret"])
        .where("scope", "=", "global")
        .where("key", "=", `providers.${provider}.live_mode`)
        .execute(),
      this.db
        .selectFrom("integration_settings")
        .select(["key", "value", "is_secret"])
        .where("provider_id", "=", account.provider_id)
        .where("account_id", "=", account.id)
        .execute(),
      this.db
        .selectFrom("integration_tokens")
        .select(["token_type", "encrypted_value"])
        .where("account_id", "=", account.id)
        .execute(),
    ]);

    const settings: Record<string, unknown> = {};
    for (const row of [...globalSettings, ...accountSettings]) {
      settings[row.key] = settingValue(row.value, row.is_secret, this.decryptor);
    }

    const tokenValues: Record<string, unknown> = {};
    for (const row of tokens) {
      tokenValues[row.token_type] = tokenValue(row.encrypted_value, this.decryptor);
    }

    const accountLiveMode = booleanSetting(settings.live_mode);
    const providerLiveMode = booleanSetting(settings[`providers.${provider}.live_mode`]);

    const config = {
      provider,
      account_public_id: account.public_id,
      live_mode: providerLiveMode && (accountLiveMode || !Object.hasOwn(settings, "live_mode")),
      settings: isRecord(settings) ? settings : {},
      tokens: tokenValues,
    };
    this.cache.set(cacheKey, config);
    return config;
  }
}
