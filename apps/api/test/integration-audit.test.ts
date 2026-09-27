import { describe, expect, it } from "vitest";
import {
  auditIntegrationAccountValue,
  auditIntegrationSettingValue,
  auditIntegrationTokenValue,
} from "../src/integrations/repository.js";

describe("integration audit values", () => {
  it("captures restart-persistent account fields for old and new audit values", () => {
    expect(
      auditIntegrationAccountValue(
        {
          display_name: "Instagram Main",
          external_account_id: "ig_1",
          status: "active",
          metadata: {
            page_id: "page_1",
          },
        },
        "instagram",
      ),
    ).toEqual({
      provider_key: "instagram",
      display_name: "Instagram Main",
      external_account_id: "ig_1",
      status: "active",
      metadata: {
        page_id: "page_1",
      },
    });
  });

  it("redacts secret integration settings in audit logs", () => {
    expect(
      auditIntegrationSettingValue({
        key: "app_secret",
        value: {
          ciphertext: "stored-ciphertext",
        },
        is_secret: true,
      }),
    ).toEqual({
      key: "app_secret",
      value: "[redacted]",
      is_secret: true,
    });
  });

  it("redacts integration token values while preserving refresh metadata", () => {
    const expiresAt = new Date("2026-10-01T00:00:00.000Z");
    const refreshedAt = new Date("2026-09-27T00:00:00.000Z");

    expect(
      auditIntegrationTokenValue({
        token_type: "access",
        expires_at: expiresAt,
        last_refreshed_at: refreshedAt,
      }),
    ).toEqual({
      token_type: "access",
      value: "[redacted]",
      expires_at: expiresAt,
      last_refreshed_at: refreshedAt,
    });
  });
});
