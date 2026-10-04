import type { AppDatabase } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import type {
  IntegrationAccountsTable,
  IntegrationProvidersTable,
  IntegrationSettingsTable,
  IntegrationTokensTable,
  ProviderAttemptsTable,
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
export type ProviderAttemptRecord = Selectable<ProviderAttemptsTable> & {
  provider_key: string;
  account_public_id: string | null;
};

export interface IntegrationAccountSnapshot {
  account: IntegrationAccountRecord;
  settings: IntegrationSettingRecord[];
  tokens: IntegrationTokenRecord[];
}

export interface InstagramAnalyticsSummary {
  followers: number;
  reach: number;
  impressions: number;
  profile_views: number;
  engagement_rate: number;
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

export interface ListProviderAttemptsInput {
  providerKey: string | null;
  accountPublicId: string | null;
  limit: number;
}

export interface CreateProviderCronTriggerInput {
  providerKey: "ptt" | "surat";
  idempotencyKey: string;
  requestId: string;
}

export interface CreateInstagramPublishPreviewInput {
  accountPublicId: string | null;
  imageUrl: string;
  caption: string;
  idempotencyKey: string;
  requestId: string;
}

function assertProviderCronTriggerAttemptMatches(
  attempt: Selectable<ProviderAttemptsTable>,
  input: CreateProviderCronTriggerInput,
) {
  const metadata = attempt.request_metadata as {
    source?: unknown;
    dry_run_request?: {
      body?: {
        provider_key?: unknown;
      };
    };
  };
  if (
    attempt.operation !== "shipment.track" ||
    attempt.direction !== "outbound" ||
    attempt.request_id !== input.requestId ||
    metadata.source !== "admin.cron_debug" ||
    metadata.dry_run_request?.body?.provider_key !== input.providerKey
  ) {
    throw new Error(`Provider cron trigger idempotency key reuse mismatch: ${input.idempotencyKey}`);
  }
}

function assertInstagramPublishAttemptMatches(
  attempt: Selectable<ProviderAttemptsTable>,
  input: CreateInstagramPublishPreviewInput,
) {
  const metadata = attempt.request_metadata as {
    source?: unknown;
    account_public_id?: unknown;
    dry_run_request?: {
      body?: {
        image_url?: unknown;
        caption?: unknown;
      };
    };
  };
  if (
    attempt.operation !== "message.send" ||
    attempt.direction !== "outbound" ||
    attempt.request_id !== input.requestId ||
    metadata.source !== "admin.instagram_publish_preview" ||
    metadata.account_public_id !== input.accountPublicId ||
    metadata.dry_run_request?.body?.image_url !== input.imageUrl ||
    metadata.dry_run_request?.body?.caption !== input.caption
  ) {
    throw new Error(`Instagram publish idempotency key reuse mismatch: ${input.idempotencyKey}`);
  }
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

  async listProviderAttempts(input: ListProviderAttemptsInput): Promise<ProviderAttemptRecord[]> {
    let query = this.db
      .selectFrom("provider_attempts")
      .innerJoin("integration_providers", "integration_providers.id", "provider_attempts.provider_id")
      .leftJoin("integration_accounts", "integration_accounts.id", "provider_attempts.account_id")
      .selectAll("provider_attempts")
      .select([
        "integration_providers.key as provider_key",
        "integration_accounts.public_id as account_public_id",
      ])
      .orderBy("provider_attempts.started_at", "desc")
      .orderBy("provider_attempts.id", "desc")
      .limit(Math.max(1, Math.min(input.limit, 100)));

    if (input.providerKey) {
      query = query.where("integration_providers.key", "=", input.providerKey);
    }

    if (input.accountPublicId) {
      query = query.where("integration_accounts.public_id", "=", input.accountPublicId);
    }

    return query.execute();
  }

  async createProviderCronTriggerAttempt(input: CreateProviderCronTriggerInput): Promise<ProviderAttemptRecord> {
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

      const existingAttempt = await transaction
        .selectFrom("provider_attempts")
        .selectAll()
        .where("provider_id", "=", provider.id)
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();

      if (existingAttempt) {
        assertProviderCronTriggerAttemptMatches(existingAttempt, input);
        return { ...existingAttempt, provider_key: provider.key, account_public_id: null };
      }

      const startedAt = new Date();
      const attempt = await transaction
        .insertInto("provider_attempts")
        .values({
          public_id: newPublicId("pat"),
          provider_id: provider.id,
          account_id: null,
          request_id: input.requestId,
          operation: "shipment.track",
          direction: "outbound",
          status: "success",
          status_code: 202,
          duration_ms: 0,
          retry_decision: "none",
          next_retry_at: null,
          idempotency_key: input.idempotencyKey,
          request_metadata: {
            source: "admin.cron_debug",
            live_call_permitted: false,
            dry_run_request: {
              method: "POST",
              path: input.providerKey === "ptt" ? "/api/ptt/cron-debug" : "/api/surat/cron-debug",
              headers: {
                authorization: "[redacted]",
                "content-type": "application/json",
              },
              body: {
                action: "cron-takip-guncelle",
                provider_key: input.providerKey,
              },
              live_call_performed: false,
            },
          },
          response_metadata: {
            mode: "dry_run",
            queued: false,
            live_call_permitted: false,
          },
          error_code: null,
          error_message: null,
          started_at: startedAt,
        })
        .onConflict((oc) =>
          oc.columns(["provider_id", "idempotency_key"]).where("idempotency_key", "is not", null).doNothing(),
        )
        .returningAll()
        .executeTakeFirst();

      if (attempt) {
        return { ...attempt, provider_key: provider.key, account_public_id: null };
      }

      const replayedAttempt = await transaction
        .selectFrom("provider_attempts")
        .selectAll()
        .where("provider_id", "=", provider.id)
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();

      if (!replayedAttempt) {
        throw new Error(`Provider cron trigger idempotency conflict could not be replayed: ${input.idempotencyKey}`);
      }

      assertProviderCronTriggerAttemptMatches(replayedAttempt, input);
      return { ...replayedAttempt, provider_key: provider.key, account_public_id: null };
    });
  }

  async createInstagramPublishPreviewAttempt(input: CreateInstagramPublishPreviewInput): Promise<ProviderAttemptRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const provider = await transaction
        .selectFrom("integration_providers")
        .selectAll()
        .where("key", "=", "instagram")
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!provider) {
        throw new Error("Unknown integration provider: instagram");
      }

      const account = input.accountPublicId
        ? await transaction
            .selectFrom("integration_accounts")
            .selectAll()
            .where("provider_id", "=", provider.id)
            .where("public_id", "=", input.accountPublicId)
            .executeTakeFirst()
        : null;

      if (input.accountPublicId && !account) {
        throw new Error(`Unknown Instagram account for publish preview: ${input.accountPublicId}`);
      }

      const existingAttempt = await transaction
        .selectFrom("provider_attempts")
        .selectAll()
        .where("provider_id", "=", provider.id)
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();

      if (existingAttempt) {
        assertInstagramPublishAttemptMatches(existingAttempt, input);
        return { ...existingAttempt, provider_key: provider.key, account_public_id: input.accountPublicId };
      }

      const graphAccountId = account?.external_account_id ?? "ig_preview";
      const attempt = await transaction
        .insertInto("provider_attempts")
        .values({
          public_id: newPublicId("pat"),
          provider_id: provider.id,
          account_id: account?.id ?? null,
          request_id: input.requestId,
          operation: "message.send",
          direction: "outbound",
          status: "success",
          status_code: 202,
          duration_ms: 0,
          retry_decision: "none",
          next_retry_at: null,
          idempotency_key: input.idempotencyKey,
          request_metadata: {
            source: "admin.instagram_publish_preview",
            account_public_id: input.accountPublicId,
            live_call_permitted: false,
            dry_run_request: {
              method: "POST",
              path: `/v18.0/${graphAccountId}/media`,
              headers: {
                authorization: "[redacted]",
                "content-type": "application/json",
              },
              body: {
                image_url: input.imageUrl,
                caption: input.caption,
              },
              live_call_performed: false,
            },
          },
          response_metadata: {
            mode: "dry_run",
            queued: false,
            live_call_permitted: false,
          },
          error_code: null,
          error_message: null,
          started_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(["provider_id", "idempotency_key"]).where("idempotency_key", "is not", null).doNothing(),
        )
        .returningAll()
        .executeTakeFirst();

      if (attempt) {
        return { ...attempt, provider_key: provider.key, account_public_id: input.accountPublicId };
      }

      const replayedAttempt = await transaction
        .selectFrom("provider_attempts")
        .selectAll()
        .where("provider_id", "=", provider.id)
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();

      if (!replayedAttempt) {
        throw new Error(`Instagram publish idempotency conflict could not be replayed: ${input.idempotencyKey}`);
      }

      assertInstagramPublishAttemptMatches(replayedAttempt, input);
      return { ...replayedAttempt, provider_key: provider.key, account_public_id: input.accountPublicId };
    });
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
            .selectAll()
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
          old_value: existing ? auditIntegrationAccountValue(existing, provider.key) : null,
          new_value: auditIntegrationAccountValue(account, provider.key),
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

      const previous = await transaction
        .selectFrom("integration_settings")
        .selectAll()
        .where("provider_id", "=", account.provider_id)
        .where("account_id", "=", account.id)
        .where("key", "=", input.key)
        .executeTakeFirst();
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
          old_value: previous ? auditIntegrationSettingValue(previous) : null,
          new_value: auditIntegrationSettingValue(setting),
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
        .selectAll()
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
          old_value: existing ? auditIntegrationTokenValue(existing) : null,
          new_value: auditIntegrationTokenValue(token),
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

export function serializeProviderAttempt(attempt: ProviderAttemptRecord) {
  const requestMetadata = redactProviderAttemptMetadata(attempt.request_metadata);

  return {
    public_id: attempt.public_id,
    provider_key: attempt.provider_key,
    account_public_id: attempt.account_public_id,
    request_id: attempt.request_id,
    operation: attempt.operation,
    direction: attempt.direction,
    status: attempt.status,
    status_code: attempt.status_code,
    duration_ms: attempt.duration_ms,
    retry_decision: attempt.retry_decision,
    next_retry_at: attempt.next_retry_at,
    idempotency_key: attempt.idempotency_key,
    request_metadata: requestMetadata,
    provider_request_preview: providerRequestPreviewFromMetadata(requestMetadata),
    response_metadata: redactProviderAttemptMetadata(attempt.response_metadata),
    error_code: attempt.error_code,
    error_message: attempt.error_message,
    started_at: attempt.started_at,
    updated_at: attempt.updated_at,
  };
}

export function providerRequestPreviewFromMetadata(metadata: unknown): unknown | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const preview = (metadata as Record<string, unknown>).dry_run_request;
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) {
    return null;
  }

  return preview;
}

export function serializeAccountSnapshot(snapshot: IntegrationAccountSnapshot) {
  return {
    account: serializeAccount(snapshot.account),
    settings: snapshot.settings.map(serializeIntegrationSetting),
    tokens: snapshot.tokens.map(serializeIntegrationToken),
  };
}

function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function instagramAnalyticsSummaryFromMetadata(metadata: unknown): InstagramAnalyticsSummary {
  const record = typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  const analytics = typeof record.analytics === "object" && record.analytics !== null && !Array.isArray(record.analytics)
    ? record.analytics as Record<string, unknown>
    : {};
  return {
    followers: numberFrom(analytics.followers),
    reach: numberFrom(analytics.reach),
    impressions: numberFrom(analytics.impressions),
    profile_views: numberFrom(analytics.profile_views),
    engagement_rate: numberFrom(analytics.engagement_rate),
  };
}

const providerAttemptSecretKeyPattern =
  /(^|_|\.)((access|refresh|verify)?_?token|authorization|api_?key|password|secret)$/i;

export function parseProviderAttemptLimit(value: string | undefined, fallback = 50) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(parsed, 100));
}

export function redactProviderAttemptMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactProviderAttemptMetadata);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      providerAttemptSecretKeyPattern.test(key)
        ? "[redacted]"
        : redactProviderAttemptMetadata(nestedValue),
    ]),
  );
}

export function auditIntegrationAccountValue(
  account: Pick<
    IntegrationAccountRecord | Selectable<IntegrationAccountsTable>,
    "display_name" | "external_account_id" | "metadata" | "status"
  >,
  providerKey: string,
) {
  return {
    provider_key: providerKey,
    display_name: account.display_name,
    external_account_id: account.external_account_id,
    status: account.status,
    metadata: account.metadata,
  };
}

export function auditIntegrationSettingValue(
  setting: Pick<IntegrationSettingRecord, "key" | "value" | "is_secret">,
) {
  return {
    key: setting.key,
    value: setting.is_secret ? "[redacted]" : setting.value,
    is_secret: setting.is_secret,
  };
}

export function auditIntegrationTokenValue(
  token: Pick<IntegrationTokenRecord, "token_type" | "expires_at" | "last_refreshed_at">,
) {
  return {
    token_type: token.token_type,
    value: "[redacted]",
    expires_at: token.expires_at,
    last_refreshed_at: token.last_refreshed_at,
  };
}
