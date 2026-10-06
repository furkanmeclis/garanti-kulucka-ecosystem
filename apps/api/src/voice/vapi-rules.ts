/**
 * Pure legacy VAPI rules from server.js (`KARGO_ALMAYAN_KEYWORDS`, `/api/vapi/webhook` applyEndOfCallUpdate,
 * `/api/vapi/aramalar/:id` backfill, `/api/vapi/istatistikler`, `/api/vapi/toplu-arama` saat/tekrar kontrolleri).
 */

export const vapiCallStatuses = ["basladi", "cevaplandi", "cevapsiz", "tamamlandi", "hata", "iptal"] as const;
export type VapiCallStatus = (typeof vapiCallStatuses)[number];
export const vapiQueueStatuses = ["bekliyor", "araniyor", "tamamlandi", "basarisiz"] as const;
export type VapiQueueStatus = (typeof vapiQueueStatuses)[number];

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

const cargoNotReceivedExclusions = [
  "iade",
  "geri gönderildi",
  "teslim edildi",
  "teslimat yapıldı",
  "teslimat gerçekleştirildi",
  "teslimat tamamlandı",
];

/** Legacy kargo-almayan filter: returned / delivered texts are excluded, then a keyword must match. */
export function isCargoNotReceived(lastEventText: string | null | undefined): boolean {
  if (!lastEventText) return false;
  const lower = lastEventText.toLocaleLowerCase("tr-TR");
  if (cargoNotReceivedExclusions.some((text) => lower.includes(text))) return false;
  return cargoNotReceivedKeywords.some((keyword) => lower.includes(keyword.toLocaleLowerCase("tr-TR")));
}

export interface VapiCallPolicy {
  enabled: boolean;
  max_deneme: number;
  arama_baslangic_saati: string;
  arama_bitis_saati: string;
  tekrar_arama_saat: number;
}

export const defaultVapiCallPolicy: VapiCallPolicy = {
  enabled: false,
  max_deneme: 3,
  arama_baslangic_saati: "09:00",
  arama_bitis_saati: "18:00",
  tekrar_arama_saat: 24,
};

export function normalizeVapiCallPolicy(value: unknown): VapiCallPolicy {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const time = (input: unknown, fallback: string) => (typeof input === "string" && /^\d{2}:\d{2}$/.test(input) ? input : fallback);
  const positive = (input: unknown, fallback: number) => {
    const parsed = typeof input === "number" ? input : typeof input === "string" ? Number(input) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
  };
  return {
    enabled: record.enabled === true,
    max_deneme: positive(record.max_deneme, defaultVapiCallPolicy.max_deneme),
    arama_baslangic_saati: time(record.arama_baslangic_saati, defaultVapiCallPolicy.arama_baslangic_saati),
    arama_bitis_saati: time(record.arama_bitis_saati, defaultVapiCallPolicy.arama_bitis_saati),
    tekrar_arama_saat: positive(record.tekrar_arama_saat, defaultVapiCallPolicy.tekrar_arama_saat),
  };
}

/** Legacy HH:MM in Europe/Istanbul (server ran on TR time). */
export function istanbulClock(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

export function isWithinCallHours(policy: VapiCallPolicy, now: Date): boolean {
  const clock = istanbulClock(now);
  return !(clock < policy.arama_baslangic_saati || clock > policy.arama_bitis_saati);
}

export interface VapiCallPatch {
  status?: VapiCallStatus;
  ended_at?: Date;
  summary?: string;
  transcript?: unknown;
  duration_seconds?: number;
  cost?: string;
  ended_reason?: string;
}

const unansweredReasons = new Set(["customer-did-not-answer", "customer-busy", "customer-did-not-pick-up", "voicemail"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** VAPI sends either `{ message: {...} }` or the event itself. */
export function vapiWebhookMessage(body: unknown): Record<string, unknown> {
  const event = record(body);
  return event.message && typeof event.message === "object" ? record(event.message) : event;
}

export function vapiWebhookCallId(body: unknown): string | null {
  const event = record(body);
  const message = vapiWebhookMessage(body);
  return (
    str(record(message.call).id) ??
    str(message.callId) ??
    str(record(event.call).id) ??
    str(event.callId) ??
    str(record(record(message.artifact).call).id)
  );
}

export function vapiWebhookType(body: unknown): string | null {
  return str(vapiWebhookMessage(body).type) ?? str(record(body).type);
}

function normalizeTranscript(raw: unknown): unknown {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") return { text: raw };
  if (Array.isArray(raw)) return { messages: raw };
  return raw;
}

/** Legacy applyEndOfCallUpdate. Returns the call patch plus whether the call was unanswered. */
export function endOfCallPatch(report: Record<string, unknown>, receivedAt: Date): { patch: VapiCallPatch; unanswered: boolean } {
  const artifact = record(report.artifact);
  const call = record(report.call);
  const summary = str(report.summary) ?? str(record(report.analysis).summary) ?? str(record(artifact.analysis).summary);
  const transcript = normalizeTranscript(report.transcript ?? artifact.transcript ?? artifact.messages ?? null);
  const duration = num(report.durationSeconds) ?? num(report.duration) ?? num(call.durationSeconds);
  const cost = num(report.cost) ?? num(call.cost);
  const endedReason = str(report.endedReason) ?? str(call.endedReason);
  const unanswered = endedReason !== null && unansweredReasons.has(endedReason);
  const patch: VapiCallPatch = { status: unanswered ? "cevapsiz" : "tamamlandi", ended_at: receivedAt };
  if (summary) patch.summary = summary;
  if (transcript) patch.transcript = transcript;
  if (duration !== null) patch.duration_seconds = Math.round(duration);
  if (cost !== null) patch.cost = String(cost);
  if (endedReason) patch.ended_reason = endedReason;
  return { patch, unanswered };
}

/**
 * Legacy webhook switch: status-update maps ringing→basladi, in-progress/forwarding→cevaplandi, ended→tamamlandi
 * (+ end-of-call fields); end-of-call-report applies the end-of-call update; unknown types only when ended.
 */
export function vapiWebhookPatch(body: unknown, receivedAt: Date): { patch: VapiCallPatch; ended: boolean; unanswered: boolean } | null {
  const message = vapiWebhookMessage(body);
  const type = vapiWebhookType(body);
  if (type === "status-update") {
    const status = str(message.status);
    if (status === "ended") {
      const { patch, unanswered } = endOfCallPatch(message, receivedAt);
      return { patch, ended: true, unanswered };
    }
    const mapped: VapiCallStatus = status === "in-progress" || status === "forwarding" ? "cevaplandi" : "basladi";
    return { patch: { status: mapped }, ended: false, unanswered: false };
  }
  if (type === "end-of-call-report") {
    const { patch, unanswered } = endOfCallPatch(message, receivedAt);
    return { patch, ended: true, unanswered };
  }
  if (type === "transcript") return null;
  if (str(message.status) === "ended" || str(message.endedReason)) {
    const { patch, unanswered } = endOfCallPatch(message, receivedAt);
    return { patch, ended: true, unanswered };
  }
  return null;
}

/** Legacy GET /api/vapi/aramalar/:id backfill from the worker `vapi.call.get` snapshot. */
export function callSnapshotPatch(snapshot: Record<string, unknown>): VapiCallPatch | null {
  if (snapshot.ended !== true) return null;
  const patch: VapiCallPatch = {
    status: "tamamlandi",
    ended_at: str(snapshot.ended_at) ? new Date(str(snapshot.ended_at)!) : new Date(),
  };
  const summary = str(snapshot.summary);
  const transcript = str(snapshot.transcript);
  const duration = num(snapshot.duration_seconds);
  const cost = num(snapshot.cost);
  if (summary) patch.summary = summary;
  if (transcript) patch.transcript = { text: transcript };
  if (duration !== null) patch.duration_seconds = duration;
  if (cost !== null) patch.cost = String(cost);
  return patch;
}

export interface VapiStatisticsInput {
  calls: Array<{ status: string; duration_seconds: number | null; cost: string | null }>;
  queueWaiting: number;
}

/** Legacy /api/vapi/istatistikler over the last 30 days. */
export function vapiStatistics(input: VapiStatisticsInput) {
  const total = input.calls.length;
  const answered = input.calls.filter((call) => call.status === "cevaplandi" || call.status === "tamamlandi").length;
  const unanswered = input.calls.filter((call) => call.status === "cevapsiz").length;
  const failed = input.calls.filter((call) => call.status === "hata").length;
  const totalSeconds = input.calls.reduce((sum, call) => sum + (call.duration_seconds ?? 0), 0);
  const totalCost = input.calls.reduce((sum, call) => sum + (Number.parseFloat(call.cost ?? "0") || 0), 0);
  return {
    toplam_arama: total,
    cevaplanan: answered,
    cevapsiz: unanswered,
    hatali: failed,
    toplam_sure_sn: totalSeconds,
    ortalama_sure_sn: answered > 0 ? Math.round(totalSeconds / answered) : 0,
    toplam_maliyet: totalCost.toFixed(4),
    kuyruk_bekleyen: input.queueWaiting,
    basari_orani: total > 0 ? Math.round((answered / total) * 100) : 0,
  };
}
