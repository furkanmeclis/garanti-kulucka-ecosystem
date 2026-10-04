import type { AppDatabase, ProviderAttemptsTable, UsersTable } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import { newPublicId } from "../auth/crypto.js";
import type { SecretEncryptor } from "../security/encryption.js";

export interface WebphoneConfigRecord {
  user: Pick<Selectable<UsersTable>, "public_id" | "sip_username" | "sip_password_encrypted">;
  settings: Record<string, unknown>;
}

export interface SerializedWebphoneConfig {
  enabled: boolean;
  sip_websocket_url: string | null;
  sip_domain: string | null;
  sip_username: string | null;
  sip_password: string | null;
  ice_servers: unknown[];
  media_proxy_enabled: false;
  transport: "direct_sip_over_webrtc";
}

export interface CreateWebphoneTestCallInput {
  customerName: string;
  customerPhone: string;
  cargoProvider: string;
  trackingNumber: string;
  lastEventText: string;
  idempotencyKey: string;
  requestId: string;
}

export type WebphoneProviderAttemptRecord = Selectable<ProviderAttemptsTable> & {
  provider_key: string;
  account_public_id: string | null;
};

const webphoneSettingKeys = [
  "webphone.enabled",
  "webphone.sip_websocket_url",
  "webphone.sip_domain",
  "webphone.ice_servers",
];

export class WebphoneConfigRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly encryptor: SecretEncryptor,
  ) {}

  async getForUser(userPublicId: string): Promise<WebphoneConfigRecord | null> {
    const [user, settings] = await Promise.all([
      this.db
        .selectFrom("users")
        .select(["public_id", "sip_username", "sip_password_encrypted"])
        .where("public_id", "=", userPublicId)
        .where("is_active", "=", true)
        .executeTakeFirst(),
      this.db
        .selectFrom("settings")
        .select(["key", "value"])
        .where("scope", "=", "global")
        .where("key", "in", webphoneSettingKeys)
        .execute(),
    ]);

    if (!user) {
      return null;
    }

    return {
      user,
      settings: Object.fromEntries(settings.map((setting) => [setting.key, setting.value])),
    };
  }

  decryptSipPassword(encryptedValue: string | null): string | null {
    if (!encryptedValue) {
      return null;
    }

    const decrypted = this.encryptor.decryptJson(JSON.parse(encryptedValue));
    return typeof decrypted === "string" ? decrypted : null;
  }

  async createTestCallAttempt(input: CreateWebphoneTestCallInput): Promise<WebphoneProviderAttemptRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const provider = await transaction
        .selectFrom("integration_providers")
        .selectAll()
        .where("key", "=", "vapi")
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!provider) {
        throw new Error("Unknown integration provider: vapi");
      }

      const existingAttempt = await transaction
        .selectFrom("provider_attempts")
        .selectAll()
        .where("provider_id", "=", provider.id)
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();

      if (existingAttempt) {
        assertWebphoneTestCallAttemptMatches(existingAttempt, input);
        return { ...existingAttempt, provider_key: provider.key, account_public_id: null };
      }

      const attempt = await transaction
        .insertInto("provider_attempts")
        .values({
          public_id: newPublicId("pat"),
          provider_id: provider.id,
          account_id: null,
          request_id: input.requestId,
          operation: "call.test",
          direction: "outbound",
          status: "success",
          status_code: 202,
          duration_ms: 0,
          retry_decision: "none",
          next_retry_at: null,
          idempotency_key: input.idempotencyKey,
          request_metadata: {
            source: "webphone.vapi_test_call",
            live_call_permitted: false,
            dry_run_request: {
              method: "POST",
              path: "/vapi/calls",
              headers: {
                authorization: "[redacted]",
                "content-type": "application/json",
              },
              body: {
                customer_name: input.customerName,
                customer_phone: input.customerPhone,
                cargo_provider: input.cargoProvider,
                tracking_number: input.trackingNumber,
                last_event_text: input.lastEventText,
              },
              live_call_performed: false,
            },
          },
          response_metadata: {
            mode: "dry_run",
            queued: false,
            live_call_permitted: false,
          },
          error_code: null,
          error_message: null,
          started_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(["provider_id", "idempotency_key"]).where("idempotency_key", "is not", null).doNothing(),
        )
        .returningAll()
        .executeTakeFirst();

      if (attempt) {
        return { ...attempt, provider_key: provider.key, account_public_id: null };
      }

      const replayedAttempt = await transaction
        .selectFrom("provider_attempts")
        .selectAll()
        .where("provider_id", "=", provider.id)
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();

      if (!replayedAttempt) {
        throw new Error(`Webphone test call idempotency conflict could not be replayed: ${input.idempotencyKey}`);
      }

      assertWebphoneTestCallAttemptMatches(replayedAttempt, input);
      return { ...replayedAttempt, provider_key: provider.key, account_public_id: null };
    });
  }
}

export function serializeWebphoneConfig(
  record: WebphoneConfigRecord,
  decryptPassword: (encryptedValue: string | null) => string | null,
): SerializedWebphoneConfig {
  const enabled = record.settings["webphone.enabled"];
  const iceServers = record.settings["webphone.ice_servers"];

  return {
    enabled: enabled === true,
    sip_websocket_url: stringOrNull(record.settings["webphone.sip_websocket_url"]),
    sip_domain: stringOrNull(record.settings["webphone.sip_domain"]),
    sip_username: record.user.sip_username,
    sip_password: decryptPassword(record.user.sip_password_encrypted),
    ice_servers: Array.isArray(iceServers) ? iceServers : [],
    media_proxy_enabled: false,
    transport: "direct_sip_over_webrtc",
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function assertWebphoneTestCallAttemptMatches(
  attempt: Selectable<ProviderAttemptsTable>,
  input: CreateWebphoneTestCallInput,
) {
  const metadata = attempt.request_metadata as {
    source?: unknown;
    dry_run_request?: {
      body?: {
        customer_name?: unknown;
        customer_phone?: unknown;
        cargo_provider?: unknown;
        tracking_number?: unknown;
        last_event_text?: unknown;
      };
    };
  };
  if (
    attempt.operation !== "call.test" ||
    attempt.direction !== "outbound" ||
    attempt.request_id !== input.requestId ||
    metadata.source !== "webphone.vapi_test_call" ||
    metadata.dry_run_request?.body?.customer_name !== input.customerName ||
    metadata.dry_run_request?.body?.customer_phone !== input.customerPhone ||
    metadata.dry_run_request?.body?.cargo_provider !== input.cargoProvider ||
    metadata.dry_run_request?.body?.tracking_number !== input.trackingNumber ||
    metadata.dry_run_request?.body?.last_event_text !== input.lastEventText
  ) {
    throw new Error(`Webphone test call idempotency key reuse mismatch: ${input.idempotencyKey}`);
  }
}
