import { describe, expect, it } from "vitest";
import type { SettingsChangedMessage } from "@garanti-kulucka/shared";
import { SettingsCache } from "../src/settings/cache.js";
import { subscribeSettingsCacheInvalidation, type SettingsChangeSubscriber } from "../src/settings/change-bus.js";

class FakeSubscriber implements SettingsChangeSubscriber {
  handler: ((message: SettingsChangedMessage) => void | Promise<void>) | null = null;

  async subscribeSettingsChanged(handler: (message: SettingsChangedMessage) => void | Promise<void>): Promise<void> {
    this.handler = handler;
  }

  async close(): Promise<void> {
    this.handler = null;
  }
}

describe("settings change bus cache invalidation", () => {
  it("invalidates global setting scope changes through a fake subscriber", async () => {
    const cache = new SettingsCache();
    cache.set("global", []);
    const subscriber = new FakeSubscriber();

    await subscribeSettingsCacheInvalidation(cache, subscriber);
    await subscriber.handler?.({ source: "settings", scope: "global", key: "operations.policy", version: 2 });

    expect(cache.get("global")).toBeNull();
  });

  it("clears all cached scopes for integration setting changes", async () => {
    const cache = new SettingsCache();
    cache.set("global", []);
    cache.set("tenant", []);
    const subscriber = new FakeSubscriber();

    await subscribeSettingsCacheInvalidation(cache, subscriber);
    await subscriber.handler?.({ source: "integration_settings", scope: "integration:iac_1", key: "api_key", version: null });

    expect(cache.get("global")).toBeNull();
    expect(cache.get("tenant")).toBeNull();
  });
});
