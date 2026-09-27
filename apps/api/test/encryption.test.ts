import { describe, expect, it } from "vitest";
import { createSecretEncryptor } from "../src/security/encryption.js";

describe("secret encryption", () => {
  it("encrypts and decrypts JSON values", () => {
    const encryptor = createSecretEncryptor("unit-test-key", "unit");
    const envelope = encryptor.encryptJson({ token: "instagram-token" });

    expect(envelope.ciphertext).not.toContain("instagram-token");
    expect(encryptor.decryptJson(envelope)).toEqual({ token: "instagram-token" });
  });

  it("rejects envelopes for a different key id", () => {
    const encryptor = createSecretEncryptor("unit-test-key", "unit");
    const envelope = encryptor.encryptJson("secret");
    const otherEncryptor = createSecretEncryptor("unit-test-key", "other");

    expect(() => otherEncryptor.decryptJson(envelope)).toThrow("key id");
  });
});
