import type { AppDatabase } from "@garanti-kulucka/database";
import type { ApiConfig } from "../config.js";
import type { AccessTokenClaims } from "../auth/tokens.js";

export interface AppBindings {
  Variables: {
    config: ApiConfig;
    db: AppDatabase | null;
    auth: AccessTokenClaims | null;
    actorUserId: number | null;
  };
}
