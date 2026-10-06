import { sql, type AppDatabase } from "@garanti-kulucka/database";

/**
 * Read models behind the legacy debug pages (WhatsAppDebugPage, InstagramDebugPage, AIDebugPage,
 * AIEgitimPage). Everything here is a read of the canonical database: provider accounts (secrets only
 * as "configured" flags), webhook events, provider attempts and messages.
 */

export interface ProviderAccountStatus {
  provider_key: string;
  account_public_id: string;
  display_name: string;
  status: string;
  external_account_id: string | null;
  settings: Record<string, unknown>;
  secret_settings: string[];
  token_types: string[];
}

export interface WebhookEventRow {
  public_id: string;
  provider_key: string;
  event_type: string;
  status: string;
  received_at: Date;
  processed_at: Date | null;
  raw_payload: unknown;
}

export interface ProviderAttemptRow {
  request_id: string;
  provider_key: string;
  operation: string;
  status: string;
  status_code: number | null;
  duration_ms: number;
  error_message: string | null;
  started_at: Date;
}

export interface TrainingFilter {
  channel?: string | undefined;
  answeredOnly: boolean;
  minMessages: number;
  offset: number;
  limit: number;
}

export interface TrainingConversation {
  public_id: string;
  channel: string;
  created_at: Date;
  customer_name: string | null;
  messages: Array<{ sender_type: string; body: string; sent_at: Date }>;
}

export const trainingChannels = ["whatsapp", "instagram", "messenger"] as const;

function startOfTodayIstanbul(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${day}T00:00:00+03:00`);
}

export class DebugRepository {
  constructor(private readonly db: AppDatabase) {}

  async providerAccounts(providerKeys: string[]): Promise<ProviderAccountStatus[]> {
    const accounts = await this.db
      .selectFrom("integration_accounts")
      .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
      .select([
        "integration_accounts.id",
        "integration_accounts.public_id",
        "integration_accounts.display_name",
        "integration_accounts.status",
        "integration_accounts.external_account_id",
        "integration_providers.key as provider_key",
      ])
      .where("integration_providers.key", "in", providerKeys)
      .orderBy("integration_accounts.id", "asc")
      .execute();
    if (accounts.length === 0) return [];
    const ids = accounts.map((account) => account.id);
    const [settings, tokens] = await Promise.all([
      this.db.selectFrom("integration_settings").select(["account_id", "key", "value", "is_secret"]).where("account_id", "in", ids).execute(),
      this.db.selectFrom("integration_tokens").select(["account_id", "token_type"]).where("account_id", "in", ids).execute(),
    ]);
    return accounts.map((account) => {
      const own = settings.filter((row) => row.account_id === account.id);
      return {
        provider_key: account.provider_key,
        account_public_id: account.public_id,
        display_name: account.display_name,
        status: account.status,
        external_account_id: account.external_account_id,
        settings: Object.fromEntries(own.filter((row) => !row.is_secret).map((row) => [row.key, row.value])),
        secret_settings: own.filter((row) => row.is_secret).map((row) => row.key),
        token_types: tokens.filter((row) => row.account_id === account.id).map((row) => row.token_type),
      };
    });
  }

  async globalSetting(key: string): Promise<unknown> {
    const row = await this.db.selectFrom("settings").select(["value", "is_secret"]).where("scope", "=", "global").where("key", "=", key).executeTakeFirst();
    return row && !row.is_secret ? row.value : undefined;
  }

  async recentWebhookEvents(providerKeys: string[], limit: number): Promise<WebhookEventRow[]> {
    return this.db
      .selectFrom("webhook_events")
      .innerJoin("integration_providers", "integration_providers.id", "webhook_events.provider_id")
      .select([
        "webhook_events.public_id",
        "integration_providers.key as provider_key",
        "webhook_events.event_type",
        "webhook_events.status",
        "webhook_events.received_at",
        "webhook_events.processed_at",
        "webhook_events.raw_payload",
      ])
      .where("integration_providers.key", "in", providerKeys)
      .orderBy("webhook_events.received_at", "desc")
      .limit(limit)
      .execute();
  }

  async recentProviderAttempts(providerKeys: string[], limit: number): Promise<ProviderAttemptRow[]> {
    return this.db
      .selectFrom("provider_attempts")
      .innerJoin("integration_providers", "integration_providers.id", "provider_attempts.provider_id")
      .select([
        "provider_attempts.request_id",
        "integration_providers.key as provider_key",
        "provider_attempts.operation",
        "provider_attempts.status",
        "provider_attempts.status_code",
        "provider_attempts.duration_ms",
        "provider_attempts.error_message",
        "provider_attempts.started_at",
      ])
      .where("integration_providers.key", "in", providerKeys)
      .orderBy("provider_attempts.started_at", "desc")
      .limit(limit)
      .execute();
  }

  /** Legacy "bugün gelen / bugün giden / toplam konuşma" counters for a channel (Istanbul day). */
  async channelStats(channels: string[], now = new Date()) {
    const since = startOfTodayIstanbul(now);
    const row = await this.db
      .selectFrom("conversations")
      .leftJoin("messages", "messages.conversation_id", "conversations.id")
      .select([
        sql<number>`count(distinct conversations.id)`.as("conversation_count"),
        sql<number>`count(messages.id) filter (where messages.sender_type = 'customer' and messages.sent_at >= ${since})`.as("today_inbound"),
        sql<number>`count(messages.id) filter (where messages.sender_type in ('user', 'ai') and messages.sent_at >= ${since})`.as("today_outbound"),
      ])
      .where("conversations.channel", "in", channels)
      .executeTakeFirst();
    return {
      conversation_count: Number(row?.conversation_count ?? 0),
      today_inbound: Number(row?.today_inbound ?? 0),
      today_outbound: Number(row?.today_outbound ?? 0),
    };
  }

  async aiStats(now = new Date()) {
    const since = startOfTodayIstanbul(now);
    const row = await this.db
      .selectFrom("messages")
      .select([
        sql<number>`count(*)`.as("total"),
        sql<number>`count(*) filter (where sent_at >= ${since})`.as("today"),
      ])
      .where("sender_type", "=", "ai")
      .executeTakeFirst();
    return { today_ai_replies: Number(row?.today ?? 0), total_ai_replies: Number(row?.total ?? 0) };
  }

  async recentAiMessages(limit: number) {
    return this.db
      .selectFrom("messages")
      .innerJoin("conversations", "conversations.id", "messages.conversation_id")
      .leftJoin("customers", "customers.id", "conversations.customer_id")
      .select([
        "messages.public_id",
        "messages.body",
        "messages.sent_at",
        "conversations.public_id as conversation_public_id",
        "conversations.channel",
        "customers.full_name as customer_name",
        "customers.phone as customer_phone",
      ])
      .where("messages.sender_type", "=", "ai")
      .orderBy("messages.sent_at", "desc")
      .limit(limit)
      .execute();
  }

  /** Legacy konusma-export-stats: exportable conversations per channel ("answered" = last sender is staff). */
  async trainingStats(answeredOnly: boolean) {
    let query = this.db
      .selectFrom("conversations")
      .select(["channel", sql<number>`count(*)`.as("count")])
      .where("channel", "in", [...trainingChannels])
      .groupBy("channel");
    if (answeredOnly) query = query.where("last_message_sender_type", "=", "user");
    const rows = await query.execute();
    const byChannel = Object.fromEntries(trainingChannels.map((channel) => [channel, 0])) as Record<(typeof trainingChannels)[number], number>;
    for (const row of rows) byChannel[row.channel as (typeof trainingChannels)[number]] = Number(row.count);
    return { total: Object.values(byChannel).reduce((sum, value) => sum + value, 0), by_channel: byChannel, answered_only: answeredOnly };
  }

  /** Legacy konusma-export: newest conversations first, customer + staff text messages in order. */
  async trainingConversations(filter: TrainingFilter): Promise<TrainingConversation[]> {
    let query = this.db
      .selectFrom("conversations")
      .leftJoin("customers", "customers.id", "conversations.customer_id")
      .select(["conversations.id", "conversations.public_id", "conversations.channel", "conversations.created_at", "customers.full_name as customer_name"])
      .where("conversations.channel", "in", filter.channel ? [filter.channel] : [...trainingChannels]);
    if (filter.answeredOnly) query = query.where("conversations.last_message_sender_type", "=", "user");
    const conversations = await query.orderBy("conversations.created_at", "desc").orderBy("conversations.id", "desc").offset(filter.offset).limit(filter.limit).execute();
    if (conversations.length === 0) return [];
    const messages = await this.db
      .selectFrom("messages")
      .select(["conversation_id", "sender_type", "body", "sent_at"])
      .where("conversation_id", "in", conversations.map((conversation) => conversation.id))
      .where("sender_type", "in", ["customer", "user"])
      .where("body", "is not", null)
      .orderBy("sent_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return conversations
      .map((conversation) => ({
        public_id: conversation.public_id,
        channel: conversation.channel,
        created_at: conversation.created_at,
        customer_name: conversation.customer_name,
        messages: messages
          .filter((message) => message.conversation_id === conversation.id && (message.body ?? "").trim())
          .map((message) => ({ sender_type: message.sender_type, body: (message.body ?? "").trim(), sent_at: message.sent_at })),
      }))
      .filter((conversation) => conversation.messages.length >= filter.minMessages);
  }
}
