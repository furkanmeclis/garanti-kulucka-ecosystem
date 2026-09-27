import { describe, expect, it } from "vitest";
import { serializeSetting, type SettingRecord } from "../src/settings/repository.js";

describe("settings serialization", () => {
  it("does not expose secret values", () => {
    const setting: SettingRecord = {
      id: 1,
      public_id: "set_test",
      key: "instagram.access_token",
      scope: "global",
      value: "secret-token",
      is_secret: true,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    };

    expect(serializeSetting(setting)).toMatchObject({
      key: "instagram.access_token",
      value: null,
      is_secret: true,
    });
  });
});
