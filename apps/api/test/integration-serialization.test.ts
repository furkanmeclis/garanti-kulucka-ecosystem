import { describe, expect, it } from "vitest";
import {
  serializeAccountSnapshot,
  serializeIntegrationSetting,
  serializeIntegrationToken,
  type IntegrationAccountRecord,
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

  it("serializes restart-hydration snapshots without exposing secrets", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const account: IntegrationAccountRecord = {
      id: 1,
      public_id: "iac_instagram",
      provider_id: 1,
      display_name: "Instagram Main",
      external_account_id: "17841400000000000",
      status: "active",
      metadata: { username: "brand" },
      created_at: now,
      updated_at: now,
      provider_key: "instagram",
      provider_name: "Instagram Graph API",
    };
    const setting: IntegrationSettingRecord = {
      id: 1,
      public_id: "ist_instagram",
      provider_id: 1,
      account_id: 1,
      key: "webhook.verify_token",
      value: { ciphertext: "encrypted-setting" },
      is_secret: true,
      created_at: now,
      updated_at: now,
    };
    const token: IntegrationTokenRecord = {
      id: 1,
      public_id: "itk_instagram",
      account_id: 1,
      token_type: "access_token",
      encrypted_value: "encrypted-token",
      expires_at: null,
      last_refreshed_at: now,
      created_at: now,
      updated_at: now,
    };

    const snapshot = serializeAccountSnapshot({
      account,
      settings: [setting],
      tokens: [token],
    });

    expect(snapshot).toMatchObject({
      account: {
        public_id: "iac_instagram",
        provider_key: "instagram",
        status: "active",
      },
      settings: [{ key: "webhook.verify_token", value: null, is_secret: true }],
      tokens: [{ token_type: "access_token", value: null }],
    });
    expect(JSON.stringify(snapshot)).not.toContain("encrypted-token");
    expect(JSON.stringify(snapshot)).not.toContain("encrypted-setting");
  });
});
