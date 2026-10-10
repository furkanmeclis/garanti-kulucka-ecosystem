import { sql, type AppDatabase } from "@garanti-kulucka/database";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";

/**
 * Sürat AT (adrese teslim) coverage for the order-create warning (legacy `at-durum-kontrol`).
 *
 * The carrier call (`surat.address.coverage`, SOAP ATDurumListesi) runs in the worker behind
 * `providers.surat.live_mode`; its area list is persisted on the provider attempt and read back here, per
 * il/ilçe and Istanbul day. Without a live answer the legacy keyword check ("AT dışı", "teslimat yok") is used.
 */
export type SuratCoverageStatus = "covered" | "not_covered" | "partial" | "unknown";

export interface SuratCoverageAddress {
  city: string;
  district: string;
  address_line?: string | null | undefined;
}

export interface SuratCoverageRecord {
  il?: string;
  ilce?: string;
  mahalle?: string;
  at?: boolean | null;
}

export interface SuratCoverageDecision {
  status: SuratCoverageStatus;
  /** `provider`: a live ATDurumListesi answer from today; `keyword_fallback`: legacy address keywords only. */
  source: "provider" | "keyword_fallback";
  /** True when the order form must ask before creating (legacy `surat_at_warning`). */
  warning: boolean;
  message: string | null;
  /** AT dışı areas of the district (provider answers only). */
  uncovered_areas: string[];
  checked_at: string | null;
  live_gate: "providers.surat.live_mode";
  live_enabled: boolean;
  /** A coverage job was queued so a later check can use the carrier's answer. */
  queued: boolean;
}

export interface SuratCoverageJobPublisher {
  publish: (job: ReturnType<typeof jobEnvelopeSchema.parse>) => Promise<string | null>;
}

const notCoveredMessage = "Bu adrese sürat kargo teslimat yapmamaktadır";

/** Legacy keyword check kept as the fallback (and as an extra signal: an address annotated "AT dışı" still warns). */
export function suratAtKeywordWarning(address: SuratCoverageAddress) {
  const text = `${address.city} ${address.district} ${address.address_line ?? ""}`.toLocaleLowerCase("tr-TR");
  return text.includes("at dışı") || text.includes("at disi") || text.includes("teslimat yok");
}

function fold(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable per-district key used in the job/idempotency ids (`konya_selcuklu`). */
export function suratCoverageKey(city: string, district: string) {
  const slug = (value: string) => fold(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${slug(city)}_${slug(district)}`.slice(0, 80);
}

export function istanbulDay(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).replaceAll("-", "");
}

/** Mahalle-level decision: an AT dışı area named in the address (or a fully AT dışı district) warns. */
export function evaluateSuratCoverage(records: SuratCoverageRecord[], addressLine: string | null | undefined) {
  const known = records.filter((record) => typeof record.at === "boolean");
  const uncovered = known.filter((record) => record.at === false).map((record) => record.mahalle?.trim() ?? "").filter(Boolean);
  if (known.length === 0) return { status: "unknown" as const, uncovered };
  if (uncovered.length === 0 && known.every((record) => record.at === true)) return { status: "covered" as const, uncovered };
  if (known.every((record) => record.at === false)) return { status: "not_covered" as const, uncovered };
  const address = fold(addressLine ?? "");
  const mentions = (area: string) => {
    const folded = fold(area);
    return folded.length >= 3 && address.includes(folded);
  };
  if (known.some((record) => record.at === false && mentions(record.mahalle ?? ""))) return { status: "not_covered" as const, uncovered };
  if (known.some((record) => record.at === true && mentions(record.mahalle ?? ""))) return { status: "covered" as const, uncovered };
  return { status: "partial" as const, uncovered };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export class SuratCoverageService {
  constructor(
    private readonly db: AppDatabase,
    private readonly publisher: SuratCoverageJobPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Global `providers.surat.live_mode`; the worker additionally requires the account's live mode. */
  async liveEnabled() {
    const row = await this.db
      .selectFrom("settings")
      .select("value")
      .where("scope", "=", "global")
      .where("key", "=", "providers.surat.live_mode")
      .executeTakeFirst();
    return row?.value === true;
  }

  /** Today's live ATDurumListesi answer for the district, read back from the worker's provider attempt. */
  async latestAnswer(key: string) {
    const row = await this.db
      .selectFrom("provider_attempts")
      .innerJoin("integration_providers", "integration_providers.id", "provider_attempts.provider_id")
      .select(["provider_attempts.response_metadata", "provider_attempts.started_at"])
      .where("integration_providers.key", "=", "surat")
      .where("provider_attempts.operation", "=", "address.coverage")
      .where("provider_attempts.status", "=", "success")
      .where("provider_attempts.idempotency_key", "=", `surat_coverage_${key}_${istanbulDay(this.now())}`)
      .where(sql<boolean>`provider_attempts.response_metadata ->> 'live_call_performed' = 'true'`)
      .orderBy("provider_attempts.started_at", "desc")
      .orderBy("provider_attempts.id", "desc")
      .executeTakeFirst();
    if (!row) return null;
    const records = asRecord(asRecord(asRecord(row.response_metadata).result).data).records;
    if (!Array.isArray(records)) return null;
    const startedAt = row.started_at as Date | string;
    return { records: records.map(asRecord) as SuratCoverageRecord[], checkedAt: startedAt instanceof Date ? startedAt.toISOString() : String(startedAt) };
  }

  /** Idempotent per district and Istanbul day: BullMQ ignores a job id it already holds. */
  async requestCheck(address: SuratCoverageAddress, key: string, requestId: string | undefined) {
    const day = istanbulDay(this.now());
    const idempotencyKey = `surat_coverage_${key}_${day}`;
    const occurredAt = this.now().toISOString();
    const job = jobEnvelopeSchema.parse({
      job_id: `job_${idempotencyKey}`,
      queue: "provider-delivery",
      name: "surat.address.coverage",
      payload: providerDeliveryJobPayloadSchema.parse({
        envelope: {
          request_id: `req_${idempotencyKey}`,
          provider: "surat",
          operation: "address.coverage",
          direction: "outbound",
          channel: "cargo",
          occurred_at: occurredAt,
          payload: { il: address.city.trim(), ilce: address.district.trim(), idempotency_key: idempotencyKey },
          legacy_contract: { source: "routes/suratKargoRouter.js POST /api/surat-kargo/at-durum-kontrol", legacy_event: "surat_at_durum_kontrol" },
        },
      }),
      requested_at: occurredAt,
      ...(requestId ? { request_id: requestId } : {}),
    });
    return (await this.publisher.publish(job)) !== null;
  }

  async check(address: SuratCoverageAddress, options: { requestId?: string } = {}): Promise<SuratCoverageDecision> {
    const keyword = suratAtKeywordWarning(address);
    const base = { live_gate: "providers.surat.live_mode" as const, checked_at: null, uncovered_areas: [] as string[], queued: false };
    const key = suratCoverageKey(address.city, address.district);
    const liveEnabled = await this.liveEnabled();
    const answer = liveEnabled && key !== "_" ? await this.latestAnswer(key) : null;
    if (answer) {
      const evaluation = evaluateSuratCoverage(answer.records, address.address_line);
      const warning = keyword || evaluation.status === "not_covered";
      return {
        ...base,
        status: keyword ? "not_covered" : evaluation.status,
        source: "provider",
        warning,
        message: warning ? notCoveredMessage : null,
        uncovered_areas: evaluation.uncovered.slice(0, 20),
        checked_at: answer.checkedAt,
        live_enabled: true,
      };
    }
    const queued = liveEnabled && key !== "_" ? await this.requestCheck(address, key, options.requestId) : false;
    return {
      ...base,
      status: keyword ? "not_covered" : "unknown",
      source: "keyword_fallback",
      warning: keyword,
      message: keyword ? notCoveredMessage : null,
      live_enabled: liveEnabled,
      queued,
    };
  }
}
