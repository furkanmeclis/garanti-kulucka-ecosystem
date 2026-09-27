import { describe, expect, it } from "vitest";
import { buildMediaObjectKey, assertSafeObjectKey } from "../src/files/object-key.js";
import { serializeFile, type FileRecord } from "../src/files/repository.js";
import { MediaStorageService } from "../src/files/storage.js";

const date = new Date("2026-01-02T03:04:05.000Z");

describe("file storage foundation", () => {
  it("builds deterministic safe media object keys", () => {
    expect(
      buildMediaObjectKey({
        publicId: "fil_test",
        originalName: "../Müşteri Evrakı.JPG",
        now: date,
      }),
    ).toBe("media/2026/01/02/fil_test/musteri-evrak.jpg");
  });

  it("rejects unsafe object keys", () => {
    expect(() => assertSafeObjectKey("../secret.txt")).toThrow("unsafe");
    expect(() => assertSafeObjectKey("media//secret.txt")).toThrow("unsafe");
    expect(() => assertSafeObjectKey("/media/secret.txt")).toThrow("relative");
  });

  it("serializes file metadata without storage credentials", () => {
    const file: FileRecord = {
      id: 1,
      public_id: "fil_test",
      bucket: "garanti-media",
      object_key: "media/2026/01/02/fil_test/invoice.pdf",
      original_name: "invoice.pdf",
      mime_type: "application/pdf",
      byte_size: 123,
      checksum: "checksum",
      created_by_user_id: 1,
      created_at: date,
      updated_at: date,
    };

    expect(serializeFile(file)).toEqual({
      public_id: "fil_test",
      bucket: "garanti-media",
      object_key: "media/2026/01/02/fil_test/invoice.pdf",
      original_name: "invoice.pdf",
      mime_type: "application/pdf",
      byte_size: 123,
      checksum: "checksum",
      created_at: date,
      updated_at: date,
    });
    expect(serializeFile(file)).not.toHaveProperty("created_by_user_id");
  });

  it("creates secret-free upload instructions", () => {
    const storage = new MediaStorageService({
      endpoint: "http://garage:3900",
      region: "garage",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      bucket: "garanti-media",
    });

    expect(
      storage.createUploadInstruction({
        objectKey: "media/2026/01/02/fil_test/invoice.pdf",
        mimeType: "application/pdf",
        byteSize: 123,
        checksum: "checksum",
      }),
    ).toEqual({
      method: "PUT",
      bucket: "garanti-media",
      object_key: "media/2026/01/02/fil_test/invoice.pdf",
      headers: {
        "content-type": "application/pdf",
        "content-length": "123",
        "x-amz-checksum-sha256": "checksum",
      },
      presigned_url: null,
      expires_at: null,
    });
  });
});
