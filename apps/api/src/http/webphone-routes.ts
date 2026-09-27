import { Hono } from "hono";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { serializeWebphoneConfig, WebphoneConfigRepository } from "../webphone/config.js";

export function createWebphoneRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);

  routes.get("/config", async (context) => {
    const db = context.get("db");
    const auth = context.get("auth");
    if (!db || !auth) {
      return context.json({ error: { code: "unauthorized", message: "Valid session is required" } }, 401);
    }

    const repository = new WebphoneConfigRepository(db, context.get("encryptor"));
    const record = await repository.getForUser(auth.user_public_id);
    if (!record) {
      return context.json({ error: { code: "not_found", message: "Webphone user config was not found" } }, 404);
    }

    return context.json(serializeWebphoneConfig(record, (encryptedValue) => repository.decryptSipPassword(encryptedValue)));
  });

  return routes;
}
