import type { AppDatabase } from "@garanti-kulucka/database";
import type { ApiConfig } from "../config.js";
import type { AccessTokenClaims } from "../auth/tokens.js";
import type { SecretEncryptor } from "../security/encryption.js";
import type { RealtimePublisher } from "../realtime.js";
import type { ProviderDeliveryQueuePublisher } from "../webhooks/queue-publisher.js";
import type { SettingsCache } from "../settings/cache.js";
import type { SettingsChangePublisher } from "../settings/change-bus.js";

export interface ApiLogger {
  info(payload: Record<string, unknown>, message?: string): void;
  warn(payload: Record<string, unknown>, message?: string): void;
  error(payload: Record<string, unknown>, message?: string): void;
}

export interface AppBindings {
  Variables: {
    config: ApiConfig;
    db: AppDatabase | null;
    encryptor: SecretEncryptor;
    auth: AccessTokenClaims | null;
    actorUserId: number | null;
    requestId: string;
    logger: ApiLogger;
    realtimePublisher: RealtimePublisher;
    providerDeliveryQueuePublisher: ProviderDeliveryQueuePublisher;
    settingsCache: SettingsCache | null;
    settingsChangePublisher: SettingsChangePublisher;
  };
}
