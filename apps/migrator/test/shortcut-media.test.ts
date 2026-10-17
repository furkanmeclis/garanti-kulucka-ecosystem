import { afterEach, describe, expect, it, vi } from "vitest";
import { S3MigratorMediaStorage } from "../src/media-storage.js";
import { prepareShortcutMedia, shortcutDownloadUrl } from "../src/shortcut-media.js";
import { transformLegacyCommunication } from "../src/communication-mapping.js";
import { communicationFixture, inlineShortcutMedia, remoteShortcutMedia } from "./communication-fixtures.js";
import { startShortcutMediaServer } from "./shortcut-media-fixtures.js";

afterEach(() => vi.unstubAllEnvs());
describe("shortcut media local HTTP/S3 apply", () => {
  it("uploads inline and downloaded bytes with API object-key conventions and HEAD-before-PUT idempotence", async () => {
    const server = await startShortcutMediaServer();
    vi.stubEnv("MIGRATION_SHORTCUT_MEDIA_BASE_URL", server.url);
    try {
      const storage = new S3MigratorMediaStorage({ endpoint: server.url, region: "garage", accessKeyId: "fixture", secretAccessKey: "fixture", bucket: "media", prefix: "ignored-for-shortcuts" });
      const draft = transformLegacyCommunication(communicationFixture("message_shortcuts", { medyalar: [inlineShortcutMedia, remoteShortcutMedia] }), "message_shortcuts");
      const first = [];
      for (const [index, media] of draft.media.entries()) first.push(await prepareShortcutMedia({ media, index, sourceIdentity: "fixture", createdAt: draft.createdAt, storage }));
      for (const [index, media] of draft.media.entries()) expect(await prepareShortcutMedia({ media, index, sourceIdentity: "fixture", createdAt: draft.createdAt, storage })).toEqual(first[index]);
      expect(server.requests.filter((r) => r.method === "PUT")).toHaveLength(2);
      expect(server.requests.filter((r) => r.method === "HEAD")).toHaveLength(4);
      expect([...server.objects.values()].map((b) => b.toString())).toEqual(["hello", "local PDF fixture"]);
      expect(first[0]!.object.objectKey).toMatch(/^media\/2024\/01\/02\/fil_[a-f0-9]{24}\/turkce-foto.png$/);
      expect(first[0]!.object).toMatchObject({ checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), size: 5, mimeType: "image/png" });
      const put = server.requests.findIndex((r) => r.method === "PUT");
      expect(server.requests[put - 1]!.method).toBe("HEAD");
    } finally { await server.close(); }
  });
  it.each(["missing.pdf", "redirect.pdf", "large.pdf"])("fails closed for download %s", async (filename) => {
    const server = await startShortcutMediaServer();
    vi.stubEnv("MIGRATION_SHORTCUT_MEDIA_BASE_URL", server.url);
    try {
      const draft = transformLegacyCommunication(communicationFixture("message_shortcuts", { medyalar: [{ ...remoteShortcutMedia, storage_path: filename,
        previewUrl: `https://db.garantikulucka.com/storage/v1/object/public/shortcuts/${filename}` }] }), "message_shortcuts");
      const storage = new S3MigratorMediaStorage({ endpoint: server.url, region: "garage", accessKeyId: "fixture", secretAccessKey: "fixture", bucket: "media", prefix: "fixture" });
      await expect(prepareShortcutMedia({ media: draft.media[0]!, index: 0, sourceIdentity: "fixture", createdAt: draft.createdAt, storage })).rejects.toThrow("Shortcut media download");
      expect(server.objects.size).toBe(0);
    } finally { await server.close(); }
  });
  it("rejects a stored object whose HEAD size differs and forbids non-HTTPS remote base overrides", async () => {
    expect(() => shortcutDownloadUrl(remoteShortcutMedia.previewUrl, "http://example.test")).toThrow("must be HTTPS");
    const server = await startShortcutMediaServer();
    try {
      const storage = new S3MigratorMediaStorage({ endpoint: server.url, region: "garage", accessKeyId: "fixture", secretAccessKey: "fixture", bucket: "media", prefix: "fixture" });
      server.objects.set("/media/key", Buffer.from("wrong-size"));
      await expect(storage.storeObject({ bytes: Buffer.from("x"), mimeType: "image/png", objectKey: "key", checksum: "sha256:fixture" })).rejects.toThrow("HEAD size mismatch");
      expect(server.requests.some((r) => r.method === "PUT")).toBe(false);
    } finally { await server.close(); }
  });
});
