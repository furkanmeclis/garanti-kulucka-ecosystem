import type { AppDatabase } from "@garanti-kulucka/database";
import type { ApiConfig } from "../config.js";
import type { AccessTokenClaims } from "../auth/tokens.js";
import type { SecretEncryptor } from "../security/encryption.js";
import type { RealtimePublisher } from "../realtime.js";

export interface AppBindings {
  Variables: {
    config: ApiConfig;
    db: AppDatabase | null;
    encryptor: SecretEncryptor;
    auth: AccessTokenClaims | null;
    actorUserId: number | null;
    realtimePublisher: RealtimePublisher;
  };
}
