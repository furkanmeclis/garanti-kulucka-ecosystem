import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const migration = readFileSync(
  new URL("../migrations/030_add_call_logs.sql", import.meta.url),
  "utf8",
);
describe("call logs migration contract", () => {
  it("supports parallel 029, constrains identities/status and protects archived files", () => {
    const [up, down] = migration.split("-- Down Migration");
    expect(up).toContain(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS sip_extension TEXT",
    );
    expect(up).toContain("unique_id TEXT UNIQUE");
    expect(up).toContain(
      "recording_file_id BIGINT REFERENCES files(id) ON DELETE RESTRICT",
    );
    for (const value of [
      "inbound",
      "outbound",
      "internal",
      "answered",
      "missed",
      "busy",
      "timeout",
      "failed",
      "cancelled",
      "netgsm_webhook",
      "netgsm_report",
      "softphone",
      "legacy",
    ])
      expect(up).toContain(`'${value}'`);
    expect(up).toContain("jsonb_typeof(events) = 'array'");
    expect(up).toContain("call_logs_user_time_idx");
    expect(down).toContain("DROP TABLE IF EXISTS call_logs");
    expect(down).not.toContain("DROP COLUMN");
  });
});
