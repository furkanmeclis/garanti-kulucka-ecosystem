import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "../src/auth/tokens.js";
import type { ApiConfig } from "../src/config.js";

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "test-secret",
  encryptionKey: "test-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 60,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

describe("auth tokens", () => {
  it("round-trips required access token claims", async () => {
    const token = await signAccessToken(
      {
        user_public_id: "usr_test",
        session_public_id: "ses_test",
        role: "admin",
      },
      config,
    );

    await expect(verifyAccessToken(token, config)).resolves.toEqual({
      user_public_id: "usr_test",
      session_public_id: "ses_test",
      role: "admin",
    });
  });
});
