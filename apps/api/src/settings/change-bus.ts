import { settingsChangedMessageSchema, type SettingsChangedMessage } from "@garanti-kulucka/shared";
import { Redis } from "ioredis";
import type { SettingsCache } from "./cache.js";

export const settingsChangedChannel = "settings.changed";

export interface SettingsChangePublisher {
  publishSettingsChanged: (message: SettingsChangedMessage) => Promise<void>;
}

export interface SettingsChangeSubscriber {
  subscribeSettingsChanged: (handler: (message: SettingsChangedMessage) => void | Promise<void>) => Promise<void>;
  close: () => Promise<void>;
}

export const noopSettingsChangePublisher: SettingsChangePublisher = {
  publishSettingsChanged: async () => undefined,
};

export class RedisSettingsChangeBus implements SettingsChangePublisher, SettingsChangeSubscriber {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  async publishSettingsChanged(message: SettingsChangedMessage): Promise<void> {
    await this.publisher.publish(settingsChangedChannel, JSON.stringify(settingsChangedMessageSchema.parse(message)));
  }

  async subscribeSettingsChanged(handler: (message: SettingsChangedMessage) => void | Promise<void>): Promise<void> {
    this.subscriber.on("message", (channel, raw) => {
      if (channel !== settingsChangedChannel) {
        return;
      }

      const parsed = settingsChangedMessageSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        void handler(parsed.data);
      }
    });
    await this.subscriber.subscribe(settingsChangedChannel);
  }

  async close(): Promise<void> {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }
}

export async function subscribeSettingsCacheInvalidation(
  cache: SettingsCache,
  subscriber: SettingsChangeSubscriber,
): Promise<void> {
  await subscriber.subscribeSettingsChanged((message) => {
    cache.invalidate(message.source === "settings" ? message.scope : undefined);
  });
}
