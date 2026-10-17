import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { AppBindings } from "../http/types.js";
import type { EncryptedJsonEnvelope } from "../security/encryption.js";

export function constantTimeEqual(left: string, right: string) {
  // Fixed-size digests also avoid exposing the configured token length.
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export function isProduction() {
  return process.env.APP_ENV === "production";
}

export function verifyMetaSignature(rawBody: Uint8Array, signature: string | undefined, secret: string) {
  if (!signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return constantTimeEqual(signature.slice(7).toLowerCase(), expected);
}

function secretString(context: Context<AppBindings>, value: unknown): string | null {
  const decoded = value && typeof value === "object" && "alg" in value && value.alg === "aes-256-gcm"
    ? context.get("encryptor").decryptJson(value as EncryptedJsonEnvelope)
    : value;
  return typeof decoded === "string" && decoded.trim() ? decoded : null;
}

/** Shared admin secret is the fallback; existing per-provider/account secrets take precedence.
 * Without an account hint, only an unambiguous provider secret can be selected.
 */
export async function resolveMetaAppSecret(context: Context<AppBindings>, providerId?: number, accountId?: number | null) {
  const db = context.get("db");
  if (!db) return null;
  const setting = await db.selectFrom("settings").select("value").where("scope", "=", "global").where("key", "=", "webhook.app_secret").executeTakeFirst();
  const sharedSecret = setting ? secretString(context, setting.value) : null;
  if (providerId === undefined && sharedSecret) return sharedSecret;
  let query = db.selectFrom("integration_settings")
    .innerJoin("integration_providers", "integration_providers.id", "integration_settings.provider_id")
    .leftJoin("integration_accounts", "integration_accounts.id", "integration_settings.account_id")
    .select(["integration_settings.key", "integration_settings.value", "integration_settings.account_id"])
    .where("integration_settings.key", "in", ["webhook.app_secret", "app_secret"])
    .where("integration_providers.is_active", "=", true)
    .where((e) => e.or([e("integration_settings.account_id", "is", null), e("integration_accounts.status", "=", "active")]));
  if (providerId !== undefined) query = query.where("integration_settings.provider_id", "=", providerId);
  else query = query.where("integration_providers.key", "in", ["meta", "whatsapp", "instagram", "messenger"]);
  if (accountId) query = query.where((e) => e.or([e("integration_settings.account_id", "=", accountId), e("integration_settings.account_id", "is", null)]));
  const rows = await query.execute();
  if (providerId === undefined) {
    const values = new Set(rows.map((row) => secretString(context, row.value)).filter((value): value is string => value !== null));
    return values.size === 1 ? [...values][0]! : null;
  }
  const secretForScope = (scope: number | null) => {
    for (const key of ["webhook.app_secret", "app_secret"]) {
      const values = new Set(rows.filter((row) => row.account_id === scope && row.key === key)
        .map((row) => secretString(context, row.value)).filter((value): value is string => value !== null));
      if (values.size === 1) return [...values][0]!;
      if (values.size > 1) return null;
    }
    return null;
  };
  const scopedSecret = (accountId ? secretForScope(accountId) : null) ?? secretForScope(null);
  if (scopedSecret) return scopedSecret;
  if (!accountId) {
    const accounts = new Set(rows.map((row) => row.account_id).filter((id): id is number => id !== null));
    const values = new Set([...accounts].map(secretForScope).filter((value): value is string => value !== null));
    if (values.size === 1) return [...values][0]!;
  }
  return sharedSecret;
}

/** Decode only after authenticating the exact encoded payload (Meta's signed_request format). */
export function signedRequestUserId(signedRequest: unknown, secret: string | null): string | null {
  if (!secret || typeof signedRequest !== "string") return null;
  const parts = signedRequest.split(".");
  if (parts.length !== 2) return null;
  const [signature, payload] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]{43}=?$/.test(signature) || !/^[A-Za-z0-9_-]+={0,2}$/.test(payload)) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!constantTimeEqual(Buffer.from(signature, "base64url").toString("base64url"), expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { algorithm?: unknown; user_id?: unknown };
    return typeof parsed.algorithm === "string" && parsed.algorithm.toUpperCase() === "HMAC-SHA256" && typeof parsed.user_id === "string" && /^\d{1,40}$/.test(parsed.user_id) ? parsed.user_id : null;
  } catch {
    return null;
  }
}

export function netgsmTokenMatches(expected: string | null, received: string | undefined) {
  return expected ? Boolean(received && constantTimeEqual(expected, received)) : !isProduction();
}
