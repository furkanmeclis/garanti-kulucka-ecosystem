import type { AppDatabase } from "@garanti-kulucka/database";
import type { ProviderName } from "@garanti-kulucka/shared";
import { hashToken, newPublicId } from "../auth/crypto.js";

export interface WebhookResolution {
  providerId: number;
  providerKey: ProviderName;
  accountId: number | null;
  accountPublicId: string | null;
  verifyTokenRequired: boolean;
  verifyTokenMatched: boolean;
}

export interface StoredWebhookEvent {
  id: number;
  public_id: string;
  provider_key: ProviderName;
  account_public_id: string | null;
  event_type: string;
  external_event_id: string | null;
  payload_hash: string;
  status: string;
}

export interface StoreWebhookEventInput {
  provider: ProviderName;
  accountPublicId: string | null;
  eventType: string;
  externalEventId: string | null;
  payloadHash: string;
  rawPayload: unknown;
}

export interface WebhookEventRepository {
  resolve: (input: {
    provider: ProviderName;
    accountPublicId: string | null;
    verifyToken: string | null;
    callbackPath: string;
  }) => Promise<WebhookResolution>;
  storeReceivedEvent: (input: StoreWebhookEventInput) => Promise<StoredWebhookEvent>;
}

export class DatabaseWebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly db: AppDatabase) {}

  async resolve(input: {
    provider: ProviderName;
    accountPublicId: string | null;
    verifyToken: string | null;
    callbackPath: string;
  }): Promise<WebhookResolution> {
    const provider = await this.db
      .selectFrom("integration_providers")
      .select(["id", "key"])
      .where("key", "=", input.provider)
      .where("is_active", "=", true)
      .executeTakeFirst();

    if (!provider) {
      throw new Error(`Unknown webhook provider: ${input.provider}`);
    }

    const account = input.accountPublicId
      ? await this.db
          .selectFrom("integration_accounts")
          .select(["id", "public_id"])
          .where("provider_id", "=", provider.id)
          .where("public_id", "=", input.accountPublicId)
          .where("status", "=", "active")
          .executeTakeFirst()
      : null;

    const subscription = await this.db
      .selectFrom("webhook_subscriptions")
      .select(["verify_token_hash"])
      .where("provider_id", "=", provider.id)
      .where((builder) =>
        account
          ? builder.or([
              builder("account_id", "=", account.id),
              builder("account_id", "is", null),
            ])
          : builder("account_id", "is", null),
      )
      .where("callback_path", "=", input.callbackPath)
      .where("is_active", "=", true)
      .orderBy("account_id", "desc")
      .executeTakeFirst();

    const verifyTokenRequired = Boolean(subscription?.verify_token_hash);
    const verifyTokenMatched = verifyTokenRequired
      ? Boolean(input.verifyToken && hashToken(input.verifyToken) === subscription?.verify_token_hash)
      : true;

    return {
      providerId: provider.id,
      providerKey: provider.key as ProviderName,
      accountId: account?.id ?? null,
      accountPublicId: account?.public_id ?? null,
      verifyTokenRequired,
      verifyTokenMatched,
    };
  }

  async storeReceivedEvent(input: StoreWebhookEventInput): Promise<StoredWebhookEvent> {
    return this.db.transaction().execute(async (transaction) => {
      const provider = await transaction
        .selectFrom("integration_providers")
        .select(["id", "key"])
        .where("key", "=", input.provider)
        .where("is_active", "=", true)
        .executeTakeFirstOrThrow();

      const account = input.accountPublicId
        ? await transaction
            .selectFrom("integration_accounts")
            .select(["id", "public_id"])
            .where("provider_id", "=", provider.id)
            .where("public_id", "=", input.accountPublicId)
            .where("status", "=", "active")
            .executeTakeFirst()
        : null;

      const event = await transaction
        .insertInto("webhook_events")
        .values({
          public_id: newPublicId("wev"),
          provider_id: provider.id,
          account_id: account?.id ?? null,
          event_type: input.eventType,
          external_event_id: input.externalEventId,
          payload_hash: input.payloadHash,
          raw_payload: input.rawPayload,
          status: "received",
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        id: event.id,
        public_id: event.public_id,
        provider_key: provider.key as ProviderName,
        account_public_id: account?.public_id ?? null,
        event_type: event.event_type,
        external_event_id: event.external_event_id,
        payload_hash: event.payload_hash,
        status: event.status,
      };
    });
  }
}
