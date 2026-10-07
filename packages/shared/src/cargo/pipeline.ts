/**
 * Legacy "Teslim Alınmayan Kargo Pipeline" (server.js `kargo_pipeline_kuyrugu`, `kargo_pipeline_config`):
 * a shipment whose last carrier event says the parcel was not collected walks mesaj → sms → vapi.
 * Pure rules shared by the API (config, actions, test) and the worker engine.
 */

export const cargoPipelineSteps = ["mesaj", "sms", "vapi", "tamamlandi", "teslim"] as const;
export type CargoPipelineStep = (typeof cargoPipelineSteps)[number];
export const cargoPipelineStatuses = ["bekliyor", "isleniyor", "tamamlandi", "hata", "iptal", "teslim"] as const;
export type CargoPipelineStatus = (typeof cargoPipelineStatuses)[number];
export const cargoPipelineActions = ["run_now", "skip", "complete", "cancel"] as const;
export type CargoPipelineAction = (typeof cargoPipelineActions)[number];
export const cargoPipelineChannels = ["whatsapp", "instagram", "messenger"] as const;

export const cargoPipelineSettingScope = "global";
export const cargoPipelineSettingKey = "kargo_pipeline_ayarlar";

export interface CargoPipelineConfig {
  aktif: boolean;
  baslangic_saati: string;
  bitis_saati: string;
  mesaj_gecikme_dk: number;
  sms_gecikme_dk: number;
  vapi_gecikme_dk: number;
  max_deneme: number;
  mesaj_sablonu: string;
}

export const defaultCargoPipelineMessageTemplate =
  "Sayın {musteri_adi}, kargonuz ({takip_no}) {son_hareket} sebebiyle size ulaşmamış. Takip: {takip_link}";

export const defaultCargoPipelineConfig: CargoPipelineConfig = {
  aktif: false,
  baslangic_saati: "09:00",
  bitis_saati: "20:00",
  mesaj_gecikme_dk: 0,
  sms_gecikme_dk: 30,
  vapi_gecikme_dk: 60,
  max_deneme: 3,
  mesaj_sablonu: defaultCargoPipelineMessageTemplate,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function minutes(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, Math.trunc(parsed))) : fallback;
}

function clock(value: unknown, fallback: string) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

export function normalizeCargoPipelineConfig(value: unknown): CargoPipelineConfig {
  const record = asRecord(value);
  const template = typeof record.mesaj_sablonu === "string" && record.mesaj_sablonu.trim() ? record.mesaj_sablonu.slice(0, 2000) : defaultCargoPipelineConfig.mesaj_sablonu;
  return {
    aktif: record.aktif === true,
    baslangic_saati: clock(record.baslangic_saati, defaultCargoPipelineConfig.baslangic_saati),
    bitis_saati: clock(record.bitis_saati, defaultCargoPipelineConfig.bitis_saati),
    mesaj_gecikme_dk: minutes(record.mesaj_gecikme_dk, defaultCargoPipelineConfig.mesaj_gecikme_dk, 1440),
    sms_gecikme_dk: minutes(record.sms_gecikme_dk, defaultCargoPipelineConfig.sms_gecikme_dk, 1440),
    vapi_gecikme_dk: minutes(record.vapi_gecikme_dk, defaultCargoPipelineConfig.vapi_gecikme_dk, 1440),
    max_deneme: Math.max(1, minutes(record.max_deneme, defaultCargoPipelineConfig.max_deneme, 10)),
    mesaj_sablonu: template,
  };
}

/** Legacy HH:MM on Europe/Istanbul wall-clock time. */
export function istanbulMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? "0");
  return part("hour") * 60 + part("minute");
}

function clockMinutes(value: string) {
  const [hours, mins] = value.split(":").map(Number);
  return (hours || 0) * 60 + (mins || 0);
}

/** Legacy isCalismaSaatiIcinde: start inclusive, end exclusive. */
export function isWithinWorkingHours(start: string, end: string, now: Date): boolean {
  const current = istanbulMinutes(now);
  return current >= clockMinutes(start) && current < clockMinutes(end);
}

export const cargoNotReceivedKeywords = [
  "işyerinde bekliyor",
  "şubede bekliyor",
  "adreste yok",
  "adreste bulunam",
  "kapalı-",
  "teslim edilemedi",
  "haber kağıdı",
  "teslimat gerçekleştirilemedi",
  "müşteri bulunamadı",
  "teslimat yapılamadı",
  "teslim alınmadı",
  "telefon ihbarlı",
  "alıcı kabul etmedi",
  "müşteri şubeden alacak",
] as const;

const deliveredPhrases = ["teslim edildi", "teslimat yapıldı", "teslimat gerçekleştirildi", "teslimat tamamlandı"];
const cargoNotReceivedExclusions = ["iade", "geri gönderildi", ...deliveredPhrases];

function lower(text: string) {
  return text.toLocaleLowerCase("tr-TR");
}

/** Legacy kargo-almayan filter: returned / delivered texts are excluded, then a keyword must match. */
export function isCargoNotReceived(lastEventText: string | null | undefined): boolean {
  if (!lastEventText) return false;
  const text = lower(lastEventText);
  if (cargoNotReceivedExclusions.some((phrase) => text.includes(phrase))) return false;
  return cargoNotReceivedKeywords.some((keyword) => text.includes(lower(keyword)));
}

/** Legacy isKargoTeslimEdildi. */
export function isCargoDelivered(status: string | null | undefined, lastEventText: string | null | undefined): boolean {
  if (status === "delivered" || status === "teslim_edildi") return true;
  const text = lower(lastEventText ?? "");
  return deliveredPhrases.some((phrase) => text.includes(phrase));
}

/** Legacy getKargoTakipLink. */
export function cargoTrackingLink(cargoProvider: string | null | undefined, trackingNumber: string | null | undefined): string {
  if (!trackingNumber) return "";
  const provider = lower(cargoProvider ?? "");
  if (provider.includes("ptt")) return `https://gonderitakip.ptt.gov.tr/Track/Verify?q=${trackingNumber}`;
  if (provider.includes("sürat") || provider.includes("surat")) return `https://suratkargo.com.tr/KargoTakip/?kargotakipno=${trackingNumber}`;
  return trackingNumber;
}

/** Legacy kargoPipelineSablonDoldur. */
export function fillCargoPipelineTemplate(
  template: string | null | undefined,
  input: { customerName?: string | null; trackingNumber?: string | null; lastEventText?: string | null; cargoProvider?: string | null },
): string {
  return (template || defaultCargoPipelineMessageTemplate)
    .replace(/\{musteri_adi\}/g, input.customerName || "Müşterimiz")
    .replace(/\{takip_no\}/g, input.trackingNumber || "")
    .replace(/\{son_hareket\}/g, input.lastEventText || "")
    .replace(/\{takip_link\}/g, cargoTrackingLink(input.cargoProvider, input.trackingNumber));
}

/** Legacy `skip` action: mesaj → sms → vapi → tamamlandi. */
export function nextCargoPipelineStep(step: string): CargoPipelineStep {
  if (step === "mesaj") return "sms";
  if (step === "sms") return "vapi";
  return "tamamlandi";
}

export function isFinishedCargoPipelineStatus(status: string): boolean {
  return status === "tamamlandi" || status === "teslim" || status === "iptal";
}
