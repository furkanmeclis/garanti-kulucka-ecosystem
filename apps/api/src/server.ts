import { serve } from "@hono/node-server";
import { ServiceConfigError, validateServiceEnv } from "@garanti-kulucka/shared";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createApiDatabase } from "./database.js";
import { drainHttpServer, InFlightRequestTracker } from "./http/graceful-drain.js";
import { getApiMetrics, startInternalMetricsServer } from "./observability/metrics.js";
import { attachRealtime, noopRealtimePublisher, type RealtimePublisher } from "./realtime.js";
import { SettingsCache } from "./settings/cache.js";
import { RedisSettingsChangeBus, subscribeSettingsCacheInvalidation } from "./settings/change-bus.js";
import {
  createBullMqProviderDeliveryQueuePublisher,
  createBullMqWebhookQueuePublisher,
} from "./webhooks/queue-publisher.js";

let validatedEnv: ReturnType<typeof validateServiceEnv<"api">>;
try {
  validatedEnv = validateServiceEnv("api", process.env);
} catch (error) {
  if (error instanceof ServiceConfigError) {
    console.error(error.message);
    process.exit(78);
  }
  throw error;
}

const port = validatedEnv.PORT ?? 3000;
const shutdownTimeoutMs = validatedEnv.API_SHUTDOWN_TIMEOUT_MS ?? 25_000;
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

const inFlight = new InFlightRequestTracker();
const server = serve({
  fetch: inFlight.wrap(app.fetch),
  port,
});

const realtime = await attachRealtime(server, config, { db: database.db });
activeRealtimePublisher = realtime.publisher;
const apiMetrics = getApiMetrics();
apiMetrics.registry.addCollector(() => {
  apiMetrics.socketConnections.set({}, realtime.io.engine.clientsCount);
});
const internalMetricsServer = startInternalMetricsServer(apiMetrics.registry);

let shuttingDown = false;

function closeInternalMetricsServer(): Promise<void> {
  if (!internalMetricsServer?.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    internalMetricsServer.close(() => resolve());
    internalMetricsServer.closeAllConnections();
  });
}

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}, draining API server (timeout ${shutdownTimeoutMs}ms)`);

  let exitCode = 0;
  try {
    const result = await drainHttpServer({
      server: server as import("node:http").Server,
      tracker: inFlight,
      realtime,
      timeoutMs: shutdownTimeoutMs,
    });
    if (!result.drained) {
      console.error(`Drain timeout reached with ${result.abandonedRequests} in-flight request(s)`);
      exitCode = 1;
    }
    await realtime.close();
    await closeInternalMetricsServer();
    await settingsChangeBus?.close();
    await webhookQueuePublisher?.close?.();
    await providerDeliveryQueuePublisher?.close?.();
    await database.destroy();
  } catch (error) {
    console.error(error);
    exitCode = 1;
  }
  process.exit(exitCode);
}

process.on("SIGINT", (signal) => void shutdown(signal));
process.on("SIGTERM", (signal) => void shutdown(signal));
