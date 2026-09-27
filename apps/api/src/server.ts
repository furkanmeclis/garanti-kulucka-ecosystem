import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createApiDatabase } from "./database.js";
import { attachRealtime } from "./realtime.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const config = loadConfig();
const database = createApiDatabase(config);

const server = serve({
  fetch: createApp({ config, db: database.db }).fetch,
  port,
});

const realtime = await attachRealtime(server, config);

async function shutdown(signal: NodeJS.Signals) {
  console.log(`Received ${signal}, closing API server`);
  await realtime.close();
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
