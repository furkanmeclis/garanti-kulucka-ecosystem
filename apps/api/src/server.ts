import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const server = serve({
  fetch: createApp().fetch,
  port,
});

function shutdown(signal: NodeJS.Signals) {
  console.log(`Received ${signal}, closing API server`);
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
