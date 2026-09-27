import { describe, expect, it } from "vitest";
import {
  parseAuditLimit,
  redactAuditValue,
  serializeAuditLog,
  type AuditLogRecord,
} from "../src/audit/repository.js";

describe("audit serialization", () => {
  it("redacts nested secret-looking keys defensively", () => {
    expect(
      redactAuditValue({
        display_name: "Instagram Main",
        access_token: "plain-token",
        nested: {
          api_key: "plain-key",
          webhook: {
            verify_token: "plain-verify-token",
            callback_path: "/webhooks/meta",
          },
        },
      }),
    ).toEqual({
      display_name: "Instagram Main",
      access_token: "[redacted]",
      nested: {
        api_key: "[redacted]",
        webhook: {
          verify_token: "[redacted]",
          callback_path: "/webhooks/meta",
        },
      },
    });
  });

  it("serializes audit logs without leaking old or new secrets", () => {
    const record: AuditLogRecord = {
      id: 1,
      actor_user_id: 10,
      action: "settings_change",
      entity_type: "integration_settings",
      entity_id: "ist_meta",
      old_value: { key: "instagram.access_token", value: "[redacted]", is_secret: true },
      new_value: { key: "instagram.access_token", access_token: "plain-token", is_secret: true },
      ip_address: "10.0.0.1",
      user_agent: "vitest",
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    };

    const serialized = serializeAuditLog(record);

    expect(serialized).toMatchObject({
      entity_type: "integration_settings",
      entity_id: "ist_meta",
      old_value: { value: "[redacted]" },
      new_value: { access_token: "[redacted]" },
    });
    expect(JSON.stringify(serialized)).not.toContain("plain-token");
  });

  it("clamps audit pagination limits", () => {
    expect(parseAuditLimit(undefined)).toBe(50);
    expect(parseAuditLimit("0")).toBe(1);
    expect(parseAuditLimit("250")).toBe(100);
    expect(parseAuditLimit("bad")).toBe(50);
  });
});
