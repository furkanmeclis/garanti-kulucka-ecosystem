import { describe, expect, it } from "vitest";
import {
  serializeIntegrationSetting,
  serializeIntegrationToken,
  type IntegrationSettingRecord,
  type IntegrationTokenRecord,
} from "../src/integrations/repository.js";

describe("integration serialization", () => {
  it("masks secret settings", () => {
    const setting: IntegrationSettingRecord = {
      id: 1,
      public_id: "ist_test",
      provider_id: 1,
      account_id: 1,
      key: "webhook.verify_token",
      value: { ciphertext: "encrypted" },
      is_secret: true,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    };

    expect(serializeIntegrationSetting(setting)).toMatchObject({
      key: "webhook.verify_token",
      value: null,
      is_secret: true,
    });
  });

  it("never serializes token values", () => {
    const token: IntegrationTokenRecord = {
      id: 1,
      public_id: "itk_test",
      account_id: 1,
      token_type: "access_token",
      encrypted_value: "encrypted",
      expires_at: null,
      last_refreshed_at: new Date("2026-01-01T00:00:00.000Z"),
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    };

    expect(serializeIntegrationToken(token)).toMatchObject({
      token_type: "access_token",
      value: null,
    });
  });
});
