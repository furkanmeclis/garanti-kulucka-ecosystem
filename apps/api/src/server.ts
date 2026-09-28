import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createApiDatabase } from "./database.js";
import { attachRealtime } from "./realtime.js";
import { createBullMqWebhookQueuePublisher } from "./webhooks/queue-publisher.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const config = loadConfig();
const database = createApiDatabase(config);
const webhookQueuePublisher = config.redisUrl
  ? createBullMqWebhookQueuePublisher(config.redisUrl)
  : undefined;
const app = createApp({
  config,
  db: database.db,
  ...(webhookQueuePublisher ? { webhookQueuePublisher } : {}),
});

const server = serve({
  fetch: app.fetch,
  port,
});

const realtime = await attachRealtime(server, config);

async function shutdown(signal: NodeJS.Signals) {
  console.log(`Received ${signal}, closing API server`);
  await realtime.close();
  await webhookQueuePublisher?.close?.();
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
