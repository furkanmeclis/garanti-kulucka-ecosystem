import { z } from "zod";

const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();
const nonblankString = z.string().trim().min(1);
const urlString = z.string().url();

const netgsmConfirmationSettingsSchema = z.object({
  aktif: z.boolean(),
  ilk_arama_dakika: positiveInteger,
  max_deneme: positiveInteger,
  deneme_arasi_dakika: positiveInteger,
});

const sipConfigSchema = z.object({
  ws_url: z.string(),
  domain: z.string(),
  stun: z.string(),
});

const operationsPolicySchema = z.object({
  max_attempts: positiveInteger,
  retry_delay_ms: nonnegativeInteger,
  request_timeout_ms: positiveInteger,
  webhook_timeout_ms: positiveInteger,
  provider_rate_limit_per_minute: positiveInteger,
  queue_concurrency: positiveInteger,
  storage_bucket: nonblankString,
  lifecycle_days: positiveInteger,
  orphan_cleanup_enabled: z.boolean(),
});

const storageUploadPolicySchema = z.object({
  allowed_content_types: z.array(nonblankString).min(1),
  max_upload_bytes: positiveInteger.max(5 * 1024 * 1024 * 1024),
  require_sha256_checksum: z.boolean(),
});

const storageMalwareScanPolicySchema = z.object({
  mode: z.enum(["skip", "manual"]),
  allow_skipped_downloads: z.boolean(),
});

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const cargoPipelineSettingsSchema = z.object({
  aktif: z.boolean(),
  baslangic_saati: timeOfDay,
  bitis_saati: timeOfDay,
  mesaj_gecikme_dk: nonnegativeInteger,
  sms_gecikme_dk: nonnegativeInteger,
  vapi_gecikme_dk: nonnegativeInteger,
  max_deneme: positiveInteger,
  mesaj_sablonu: z.string().max(2000),
});

const vapiSettingsSchema = z.object({
  enabled: z.boolean(),
  assistant_id: z.string(),
  phone_number_id: z.string(),
  tts_provider: z.enum(["azure", "elevenlabs", "google"]),
  tts_voice: z.string(),
  arama_baslangic_saati: timeOfDay,
  arama_bitis_saati: timeOfDay,
  max_deneme: positiveInteger,
  tekrar_arama_saat: positiveInteger,
  otomatik_arama: z.boolean(),
  system_prompt: z.string(),
});

const providerLiveModeKeySchema = z.templateLiteral([
  "providers.",
  z.enum(["ptt", "surat", "kolaybi", "meta", "whatsapp", "instagram", "messenger", "netgsm", "vapi", "sip"]),
  ".live_mode",
]);

const literalGlobalSettingSchemas = {
  "netgsm_teyit_ayarlar": { schema: netgsmConfirmationSettingsSchema, secret: false },
  "sip_config": { schema: sipConfigSchema, secret: false },
  "operations.policy": { schema: operationsPolicySchema, secret: false },
  "storage.upload_policy": { schema: storageUploadPolicySchema, secret: false },
  "storage.malware_scan_policy": { schema: storageMalwareScanPolicySchema, secret: false },
  "webphone.enabled": { schema: z.boolean(), secret: false },
  "webphone.ice_servers": { schema: z.array(z.string().min(1)), secret: false },
  "webphone.sip_websocket_url": { schema: z.string(), secret: false },
  "webphone.sip_domain": { schema: z.string(), secret: false },
  "ai.model": { schema: nonblankString, secret: false },
  "ai.system_prompt": { schema: z.string(), secret: false },
  "ai.auto_reply_enabled": { schema: z.boolean(), secret: false },
  "kargo_pipeline_ayarlar": { schema: cargoPipelineSettingsSchema, secret: false },
  "vapi_ayarlar": { schema: vapiSettingsSchema, secret: false },
  "vapi.api_key": { schema: nonblankString, secret: true },
  "netgsm.teyit_voice_usercode": { schema: z.string(), secret: false },
  "netgsm.teyit_voice_password": { schema: nonblankString, secret: true },
  // Shared token the NetGSM IVR callback URL carries (?token=…); NetGSM cannot sign callbacks.
  "netgsm.ivr_webhook_token": { schema: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), secret: false },
} as const;

/** Global setting keys whose values are always stored encrypted and never returned to clients. */
export const secretGlobalSettingKeys = Object.entries(literalGlobalSettingSchemas)
  .filter(([, definition]) => definition.secret)
  .map(([key]) => key);

const integrationSettingSchemas = {
  "webhook.enabled": { schema: z.boolean(), secret: false },
  "webhook.verify_token": { schema: nonblankString, secret: true },
  "webhook.app_secret": { schema: nonblankString, secret: true },
  "webhook.shared_token": { schema: nonblankString, secret: true },
  "webhook.signature_mode": { schema: z.enum(["off", "report_only", "enforce"]), secret: false },
  "api_url": { schema: urlString, secret: false },
  "api_key": { schema: nonblankString, secret: true },
  "channel": { schema: nonblankString, secret: false },
  "access_token": { schema: nonblankString, secret: true },
  "app_secret": { schema: nonblankString, secret: true },
  "cod_user": { schema: nonblankString, secret: false },
  "cod_pass": { schema: nonblankString, secret: true },
  "cash_user": { schema: nonblankString, secret: false },
  "cash_pass": { schema: nonblankString, secret: true },
  "musteri_no": { schema: nonblankString, secret: false },
  "sifre": { schema: nonblankString, secret: true },
  "posta_ceki": { schema: nonblankString, secret: false },
  "barkod_araligi": { schema: nonblankString, secret: false },
  "gonderici_telefon": { schema: nonblankString, secret: false },
  "gonderici_adi": { schema: nonblankString, secret: false },
  "gonderici_adres": { schema: nonblankString, secret: false },
  "gonderici_il": { schema: nonblankString, secret: false },
  "gonderici_ilce": { schema: nonblankString, secret: false },
  "veri_yukleme_url": { schema: urlString, secret: false },
  "gonderi_takip_url": { schema: urlString, secret: false },
} as const;

export interface SettingValidationResult {
  key: string;
  value: unknown;
  is_secret: boolean;
}

export function validateGlobalSetting(key: string, value: unknown): SettingValidationResult {
  const literal = literalGlobalSettingSchemas[key as keyof typeof literalGlobalSettingSchemas];
  if (literal) {
    return { key, value: literal.schema.parse(value), is_secret: literal.secret };
  }

  if (providerLiveModeKeySchema.safeParse(key).success) {
    return { key, value: z.boolean().parse(value), is_secret: false };
  }

  throw new Error(`Unknown admin setting key: ${key}`);
}

export function validateIntegrationSetting(key: string, value: unknown): SettingValidationResult {
  const definition = integrationSettingSchemas[key as keyof typeof integrationSettingSchemas];
  if (!definition) {
    throw new Error(`Unknown integration setting key: ${key}`);
  }

  return { key, value: definition.schema.parse(value), is_secret: definition.secret };
}
