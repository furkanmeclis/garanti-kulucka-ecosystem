import type { AppDatabase, UsersTable } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
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
