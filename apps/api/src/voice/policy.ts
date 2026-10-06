import type { Context } from "hono";
import type { AppBindings } from "../http/types.js";
import { SettingsRepository } from "../settings/repository.js";
import { normalizeVapiCallPolicy, type VapiCallPolicy } from "./vapi-rules.js";

/**
 * Legacy `settings.vapi_config` call policy (enabled, max_deneme, arama saatleri, tekrar arama) and
 * `settings.netgsm_teyit_ayarlar`. Provider secrets (api key, phone number id, NetGSM credentials) stay
 * in the encrypted integration account; these settings only carry non-secret orchestration values.
 */

export const vapiPolicyScope = "vapi";
export const vapiPolicyKey = "call_policy";
export const netgsmTeyitScope = "netgsm";
export const netgsmTeyitKey = "teyit_ayarlar";

export interface NetgsmTeyitSettings {
  aktif: boolean;
  ilk_arama_dakika: number;
  max_deneme: number;
  deneme_arasi_dakika: number;
}

export const defaultNetgsmTeyitSettings: NetgsmTeyitSettings = {
  aktif: false,
  ilk_arama_dakika: 5,
  max_deneme: 3,
  deneme_arasi_dakika: 10,
};

export function normalizeNetgsmTeyitSettings(value: unknown): NetgsmTeyitSettings {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const clamp = (input: unknown, fallback: number, max: number) => {
    const parsed = typeof input === "number" ? input : Number.NaN;
    return Number.isFinite(parsed) ? Math.min(max, Math.max(1, Math.trunc(parsed))) : fallback;
  };
  return {
    aktif: record.aktif === true,
    ilk_arama_dakika: clamp(record.ilk_arama_dakika, defaultNetgsmTeyitSettings.ilk_arama_dakika, 60),
    max_deneme: clamp(record.max_deneme, defaultNetgsmTeyitSettings.max_deneme, 10),
    deneme_arasi_dakika: clamp(record.deneme_arasi_dakika, defaultNetgsmTeyitSettings.deneme_arasi_dakika, 120),
  };
}

function repository(context: Context<AppBindings>) {
  const db = context.get("db");
  if (!db) throw new Error("Database connection is not configured");
  return new SettingsRepository(db, context.get("encryptor"), context.get("settingsCache"));
}

async function readSetting(context: Context<AppBindings>, scope: string, key: string): Promise<unknown> {
  const settings = await repository(context).list(scope);
  return settings.find((setting) => setting.key === key && !setting.is_secret)?.value ?? null;
}

async function writeSetting(context: Context<AppBindings>, scope: string, key: string, value: unknown) {
  const { setting, version } = await repository(context).upsert({
    key,
    scope,
    value,
    isSecret: false,
    actorUserId: context.get("actorUserId"),
    ipAddress: context.req.header("x-forwarded-for") ?? null,
    userAgent: context.req.header("user-agent") ?? null,
  });
  await context.get("settingsChangePublisher").publishSettingsChanged({ scope: setting.scope, key: setting.key, version, source: "settings" });
}

export async function readVapiCallPolicy(context: Context<AppBindings>): Promise<VapiCallPolicy> {
  return normalizeVapiCallPolicy(await readSetting(context, vapiPolicyScope, vapiPolicyKey));
}

export async function writeVapiCallPolicy(context: Context<AppBindings>, policy: VapiCallPolicy) {
  await writeSetting(context, vapiPolicyScope, vapiPolicyKey, policy);
}

export async function readNetgsmTeyitSettings(context: Context<AppBindings>): Promise<NetgsmTeyitSettings> {
  return normalizeNetgsmTeyitSettings(await readSetting(context, netgsmTeyitScope, netgsmTeyitKey));
}

export async function writeNetgsmTeyitSettings(context: Context<AppBindings>, settings: NetgsmTeyitSettings) {
  await writeSetting(context, netgsmTeyitScope, netgsmTeyitKey, settings);
}
