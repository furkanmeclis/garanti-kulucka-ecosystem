import { describe, expect, it, vi } from "vitest";
import type { SettingsChangedMessage } from "@garanti-kulucka/shared";
import { bindProviderConfigInvalidation, type SettingsChangeSubscriber } from "../src/settings-invalidation.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";

class FakeSubscriber implements SettingsChangeSubscriber {
  handler: ((message: SettingsChangedMessage) => void | Promise<void>) | null = null;

  async subscribeSettingsChanged(handler: (message: SettingsChangedMessage) => void | Promise<void>): Promise<void> {
    this.handler = handler;
  }

  async close(): Promise<void> {
    this.handler = null;
  }
}

describe("worker settings invalidation", () => {
  it("hydrates on boot and invalidates provider config cache on fake bus events", async () => {
    const repository: ProviderAccountConfigRepository = {
      getAccountConfig: vi.fn(),
      hydrate: vi.fn(async () => undefined),
      invalidate: vi.fn(),
    };
    const subscriber = new FakeSubscriber();

    await bindProviderConfigInvalidation(repository, subscriber);
    await subscriber.handler?.({ source: "settings", scope: "global", key: "providers.ptt.live_mode", version: 1 });

    expect(repository.hydrate).toHaveBeenCalledTimes(1);
    expect(repository.invalidate).toHaveBeenCalledTimes(1);
  });
});
