import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createApiDatabase } from "./database.js";
import { attachRealtime, noopRealtimePublisher, type RealtimePublisher } from "./realtime.js";
import { SettingsCache } from "./settings/cache.js";
import { RedisSettingsChangeBus, subscribeSettingsCacheInvalidation } from "./settings/change-bus.js";
import {
  createBullMqProviderDeliveryQueuePublisher,
  createBullMqWebhookQueuePublisher,
} from "./webhooks/queue-publisher.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const config = loadConfig();
const database = createApiDatabase(config);
const webhookQueuePublisher = config.redisUrl
  ? createBullMqWebhookQueuePublisher(config.redisUrl)
  : undefined;
const providerDeliveryQueuePublisher = config.redisUrl
  ? createBullMqProviderDeliveryQueuePublisher(config.redisUrl)
  : undefined;
const settingsCache = new SettingsCache();
if (database.db) {
  await settingsCache.hydrate(database.db);
}
const settingsChangeBus = config.redisUrl ? new RedisSettingsChangeBus(config.redisUrl) : undefined;
if (settingsChangeBus) {
  await subscribeSettingsCacheInvalidation(settingsCache, settingsChangeBus);
}
let activeRealtimePublisher: RealtimePublisher = noopRealtimePublisher;
const realtimePublisher: RealtimePublisher = {
  publish: (room, envelope) => activeRealtimePublisher.publish(room, envelope),
  publishToUser: (userPublicId, envelope) => activeRealtimePublisher.publishToUser(userPublicId, envelope),
  publishToConversation: (conversationPublicId, envelope) =>
    activeRealtimePublisher.publishToConversation(conversationPublicId, envelope),
  broadcast: (envelope) => activeRealtimePublisher.broadcast(envelope),
};
const app = createApp({
  config,
  db: database.db,
  realtimePublisher,
  ...(webhookQueuePublisher ? { webhookQueuePublisher } : {}),
  ...(providerDeliveryQueuePublisher ? { providerDeliveryQueuePublisher } : {}),
  settingsCache,
  ...(settingsChangeBus ? { settingsChangePublisher: settingsChangeBus } : {}),
});

const server = serve({
  fetch: app.fetch,
  port,
});

const realtime = await attachRealtime(server, config);
activeRealtimePublisher = realtime.publisher;

async function shutdown(signal: NodeJS.Signals) {
  console.log(`Received ${signal}, closing API server`);
  await realtime.close();
  await settingsChangeBus?.close();
  await webhookQueuePublisher?.close?.();
  await providerDeliveryQueuePublisher?.close?.();
  await database.destroy();
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
