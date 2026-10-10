import { sql } from "@garanti-kulucka/database";
import { expect, it } from "vitest";
import { StorageOrphanReconciler } from "../src/storage-orphans.js";
import { describePg, withRollback } from "./support/pg.js";

describePg("storage orphan reconciliation against Postgres", () => {
  it("never deletes shortcut media, publications or fresh uploads, and removes what it deletes", async () => {
    await withRollback(async (db) => {
      // Make the test independent of whatever files the database already holds.
      await sql`update files set created_at = now() where true`.execute(db);
      const old = sql`now() - interval '30 days'`;
      const file = async (key: string, createdAt: ReturnType<typeof sql>, status = "available") =>
        (await sql<{ id: number }>`insert into files (public_id, bucket, object_key, upload_status, created_at) values (${`fil_orphan_${key}`}, 'media', ${`orphans/${key}`}, ${status}, ${createdAt}) returning id`.execute(db)).rows[0]!.id;
      const orphan = await file("orphan", old);
      await file("fresh", sql`now()`);
      const shortcutFile = await file("shortcut", old);
      const shortcut = await sql<{ id: number }>`insert into message_shortcuts (public_id, code, message, type, is_active, sort_order) values ('msc_orphan_test', 'orphan-test', 'x', 'custom', true, 1) returning id`.execute(db);
      await sql`insert into message_shortcut_attachments (public_id, shortcut_id, file_id, attachment_type, sort_order) values ('msa_orphan_test', ${shortcut.rows[0]!.id}, ${shortcutFile}, 'image', 0)`.execute(db);

      const deleted: string[] = [];
      const reconciler = new StorageOrphanReconciler(db, {}, async (_bucket, key) => {
        deleted.push(key);
      });
      const report = await reconciler.reconcile({ mode: "dry_run", limit: 100, deleteEnabled: true });
      expect(report.candidates.map((candidate) => candidate.public_id).filter((id) => id.startsWith("fil_orphan_"))).toEqual(["fil_orphan_orphan"]);
      expect(deleted).toEqual([]);

      const applied = await reconciler.reconcile({ mode: "apply", limit: 100, deleteEnabled: true });
      expect(deleted).toContain("orphans/orphan");
      expect(deleted).not.toContain("orphans/shortcut");
      expect(applied.summary.deleted_count).toBe(deleted.length);
      expect(await db.selectFrom("files").select("id").where("id", "=", orphan).executeTakeFirst()).toBeUndefined();
      const again = await reconciler.reconcile({ mode: "dry_run", limit: 100, deleteEnabled: true });
      expect(again.candidates.some((candidate) => candidate.public_id === "fil_orphan_orphan")).toBe(false);
    });
  });
});
