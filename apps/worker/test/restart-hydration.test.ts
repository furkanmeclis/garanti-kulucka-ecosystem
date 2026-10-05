import type { AppDatabase } from "@garanti-kulucka/database";
import type { ProviderName } from "@garanti-kulucka/shared";
import { describe, expect, it } from "vitest";
import { DatabaseProviderAccountConfigRepository } from "../src/providers/account-config.js";

describe("worker restart hydration", () => {
  it("hydrates Instagram, Messenger, and WhatsApp integration accounts from PostgreSQL-backed repositories", async () => {
    const db = providerConfigDb();
    const decryptor = {
      decryptJson: (value: unknown) => value,
    };

    const firstWorker = new DatabaseProviderAccountConfigRepository(db, decryptor);
    await firstWorker.hydrate();
    const afterRestart = new DatabaseProviderAccountConfigRepository(db, decryptor);
    await afterRestart.hydrate();

    await expect(afterRestart.getAccountConfig("instagram", "iac_instagram")).resolves.toMatchObject({
      provider: "instagram",
      account_public_id: "iac_instagram",
      live_mode: true,
      settings: {
        "providers.instagram.live_mode": true,
        ig_user_id: "17841400000000000",
      },
      tokens: {
        access: { token: "instagram-token" },
      },
    });
    await expect(afterRestart.getAccountConfig("messenger", "iac_messenger")).resolves.toMatchObject({
      provider: "messenger",
      account_public_id: "iac_messenger",
      live_mode: true,
      settings: {
        "providers.messenger.live_mode": true,
        page_id: "1122334455",
      },
      tokens: {
        page_access: { token: "messenger-token" },
      },
    });
    await expect(afterRestart.getAccountConfig("whatsapp", "iac_whatsapp")).resolves.toMatchObject({
      provider: "whatsapp",
      account_public_id: "iac_whatsapp",
      live_mode: true,
      settings: {
        "providers.whatsapp.live_mode": true,
        phone_number_id: "15551234567",
      },
      tokens: {
        access: { token: "whatsapp-token" },
      },
    });
  });
});

function providerConfigDb(): AppDatabase {
  const providers = [
    { id: 1, key: "instagram", is_active: true },
    { id: 2, key: "messenger", is_active: true },
    { id: 3, key: "whatsapp", is_active: true },
  ];
  const accounts = [
    { id: 10, public_id: "iac_instagram", provider_id: 1, status: "active" },
    { id: 11, public_id: "iac_messenger", provider_id: 2, status: "active" },
    { id: 12, public_id: "iac_whatsapp", provider_id: 3, status: "active" },
  ];
  const accountSettings = [
    { provider_id: 1, account_id: 10, key: "ig_user_id", value: "17841400000000000", is_secret: false },
    { provider_id: 2, account_id: 11, key: "page_id", value: "1122334455", is_secret: false },
    { provider_id: 3, account_id: 12, key: "phone_number_id", value: "15551234567", is_secret: false },
  ];
  const globalSettings = [
    { key: "providers.instagram.live_mode", value: true, is_secret: false },
    { key: "providers.messenger.live_mode", value: true, is_secret: false },
    { key: "providers.whatsapp.live_mode", value: true, is_secret: false },
  ];
  const tokens = [
    { account_id: 10, token_type: "access", encrypted_value: JSON.stringify({ token: "instagram-token" }) },
    { account_id: 11, token_type: "page_access", encrypted_value: JSON.stringify({ token: "messenger-token" }) },
    { account_id: 12, token_type: "access", encrypted_value: JSON.stringify({ token: "whatsapp-token" }) },
  ];

  return {
    selectFrom: (table: string) => new Query(table, { providers, accounts, accountSettings, globalSettings, tokens }),
  } as unknown as AppDatabase;
}

class Query {
  private provider: ProviderName | null = null;
  private accountPublicId: string | null = null;
  private providerId: number | null = null;
  private accountId: number | null = null;
  private scope: string | null = null;
  private settingKey: string | null = null;

  constructor(
    private readonly table: string,
    private readonly rows: {
      providers: Array<{ id: number; key: string; is_active: boolean }>;
      accounts: Array<{ id: number; public_id: string; provider_id: number; status: string }>;
      accountSettings: Array<{ provider_id: number; account_id: number; key: string; value: unknown; is_secret: boolean }>;
      globalSettings: Array<{ key: string; value: unknown; is_secret: boolean }>;
      tokens: Array<{ account_id: number; token_type: string; encrypted_value: string }>;
    },
  ) {}

  innerJoin() {
    return this;
  }

  select() {
    return this;
  }

  where(column: string, operator: string, value: unknown) {
    if (column === "integration_providers.key" && operator === "=") this.provider = value as ProviderName;
    if (column === "integration_accounts.public_id" && operator === "=") this.accountPublicId = String(value);
    if (column === "provider_id" && operator === "=") this.providerId = Number(value);
    if (column === "account_id" && operator === "=") this.accountId = Number(value);
    if (column === "scope" && operator === "=") this.scope = String(value);
    if (column === "key" && operator === "=") this.settingKey = String(value);
    return this;
  }

  async execute() {
    if (this.table === "integration_accounts") {
      return this.rows.accounts.map((account) => ({
        public_id: account.public_id,
        provider_key: this.rows.providers.find((provider) => provider.id === account.provider_id)?.key,
      }));
    }
    if (this.table === "settings") {
      return this.rows.globalSettings.filter((setting) => this.scope === "global" && setting.key === this.settingKey);
    }
    if (this.table === "integration_settings") {
      return this.rows.accountSettings.filter(
        (setting) => setting.provider_id === this.providerId && setting.account_id === this.accountId,
      );
    }
    if (this.table === "integration_tokens") {
      return this.rows.tokens.filter((token) => token.account_id === this.accountId);
    }
    return [];
  }

  async executeTakeFirst() {
    const provider = this.rows.providers.find((row) => row.key === this.provider && row.is_active);
    const account = this.rows.accounts.find(
      (row) =>
        provider &&
        row.provider_id === provider.id &&
        row.public_id === this.accountPublicId &&
        row.status === "active",
    );
    if (!provider || !account) return undefined;
    return {
      id: account.id,
      public_id: account.public_id,
      provider_id: provider.id,
      provider_key: provider.key,
    };
  }
}
