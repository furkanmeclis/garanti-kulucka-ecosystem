import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

const algorithm = "aes-256-gcm";

export interface EncryptedJsonEnvelope {
  alg: "aes-256-gcm";
  kid: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface SecretDecryptor {
  decryptJson: (envelope: EncryptedJsonEnvelope) => unknown;
}

function deriveKey(rawKey: string): Buffer {
  return createHash("sha256").update(rawKey).digest();
}

function assertEnvelope(input: unknown): asserts input is EncryptedJsonEnvelope {
  if (
    !input ||
    typeof input !== "object" ||
    (input as EncryptedJsonEnvelope).alg !== algorithm ||
    typeof (input as EncryptedJsonEnvelope).kid !== "string" ||
    typeof (input as EncryptedJsonEnvelope).iv !== "string" ||
    typeof (input as EncryptedJsonEnvelope).tag !== "string" ||
    typeof (input as EncryptedJsonEnvelope).ciphertext !== "string"
  ) {
    throw new Error("Invalid encrypted JSON envelope");
  }
}

export function createSecretDecryptor(rawKey: string, keyId: string): SecretDecryptor {
  const key = deriveKey(rawKey);

  return {
    decryptJson: (envelope) => {
      assertEnvelope(envelope);

      const envelopeKeyId = Buffer.from(envelope.kid);
      const expectedKeyId = Buffer.from(keyId);
      if (
        envelopeKeyId.length !== expectedKeyId.length ||
        !timingSafeEqual(envelopeKeyId, expectedKeyId)
      ) {
        throw new Error("Encrypted JSON key id does not match active key");
      }

      const decipher = createDecipheriv(algorithm, key, Buffer.from(envelope.iv, "base64url"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]);

      return JSON.parse(plaintext.toString("utf8"));
    },
  };
}
