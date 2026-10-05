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

const providerLiveModeKeySchema = z.templateLiteral([
  "providers.",
  z.enum(["ptt", "surat", "kolaybi", "meta", "whatsapp", "instagram", "messenger", "netgsm", "vapi", "sip"]),
  ".live_mode",
]);

const literalGlobalSettingSchemas = {
  "netgsm_teyit_ayarlar": { schema: netgsmConfirmationSettingsSchema, secret: false },
  "sip_config": { schema: sipConfigSchema, secret: false },
  "operations.policy": { schema: operationsPolicySchema, secret: false },
  "webphone.enabled": { schema: z.boolean(), secret: false },
  "webphone.ice_servers": { schema: z.array(z.string().min(1)), secret: false },
  "webphone.sip_websocket_url": { schema: z.string(), secret: false },
  "webphone.sip_domain": { schema: z.string(), secret: false },
  "ai.model": { schema: nonblankString, secret: false },
  "ai.system_prompt": { schema: z.string(), secret: false },
} as const;

const integrationSettingSchemas = {
  "webhook.enabled": { schema: z.boolean(), secret: false },
  "webhook.verify_token": { schema: nonblankString, secret: true },
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
