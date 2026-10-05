import type { AppDatabase } from "@garanti-kulucka/database";
import type { SettingRecord } from "./repository.js";

export class SettingsCache {
  private readonly scopeSettings = new Map<string, SettingRecord[]>();

  async hydrate(db: AppDatabase): Promise<void> {
    const rows = await db.selectFrom("settings").selectAll().orderBy("key", "asc").execute();
    const next = new Map<string, SettingRecord[]>();
    for (const row of rows) {
      const settings = next.get(row.scope) ?? [];
      settings.push(row);
      next.set(row.scope, settings);
    }

    this.scopeSettings.clear();
    for (const [scope, settings] of next) {
      this.scopeSettings.set(scope, settings);
    }
  }

  get(scope: string): SettingRecord[] | null {
    return this.scopeSettings.get(scope) ?? null;
  }

  set(scope: string, settings: SettingRecord[]): void {
    this.scopeSettings.set(scope, settings);
  }

  invalidate(scope?: string): void {
    if (scope) {
      this.scopeSettings.delete(scope);
      return;
    }
    this.scopeSettings.clear();
  }
}
