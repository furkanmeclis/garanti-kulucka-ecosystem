import type { SettingsChangedMessage } from "@garanti-kulucka/shared";
import type { ProviderAccountConfigRepository } from "./providers/account-config.js";

export interface SettingsChangeSubscriber {
  subscribeSettingsChanged: (handler: (message: SettingsChangedMessage) => void | Promise<void>) => Promise<void>;
  close: () => Promise<void>;
}

export async function bindProviderConfigInvalidation(
  repository: ProviderAccountConfigRepository | undefined,
  subscriber: SettingsChangeSubscriber | undefined,
): Promise<void> {
  // Subscribe first: a failed warm-up (database still starting) must not leave the cache without invalidation.
  await subscriber?.subscribeSettingsChanged(() => {
    repository?.invalidate?.();
  });
  await repository?.hydrate?.();
}
