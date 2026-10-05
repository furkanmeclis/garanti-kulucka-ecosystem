import type { AppDatabase } from "@garanti-kulucka/database";
import { describe, expect, it } from "vitest";
import { SettingsCache } from "../src/settings/cache.js";

describe("API restart hydration", () => {
  it("hydrates admin settings from PostgreSQL rows after a fresh API cache is created", async () => {
    const rows = [
      {
        id: 1,
        public_id: "set_sip_config",
        key: "sip_config",
        scope: "global",
        value: {
          ws_url: "wss://sip.example.com/ws",
          domain: "sip.example.com",
          stun: "stun:stun.example.com:3478",
        },
        is_secret: false,
        updated_at: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: 2,
        public_id: "set_operations_policy",
        key: "operations.policy",
        scope: "global",
        value: {
          queue_concurrency: 4,
          provider_rate_limit_per_minute: 60,
        },
        is_secret: false,
        updated_at: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    const db = settingsDb(rows);

    const beforeRestart = new SettingsCache();
    await beforeRestart.hydrate(db);
    const afterRestart = new SettingsCache();
    await afterRestart.hydrate(db);

    expect(afterRestart.get("global")).toEqual(beforeRestart.get("global"));
    expect(afterRestart.get("global")?.map((setting) => setting.key)).toEqual([
      "operations.policy",
      "sip_config",
    ]);
  });
});

function settingsDb(rows: unknown[]): AppDatabase {
  return {
    selectFrom: () => ({
      selectAll: () => ({
        orderBy: () => ({
          execute: async () =>
            [...rows].sort((first, second) =>
              String((first as { key: string }).key).localeCompare(String((second as { key: string }).key)),
            ),
        }),
      }),
    }),
  } as unknown as AppDatabase;
}
