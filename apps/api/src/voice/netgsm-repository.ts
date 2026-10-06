import type { AppDatabase } from "@garanti-kulucka/database";

export interface NetgsmCdrRow {
  id: string | null;
  tarih: string | null;
  arayanNumara: string | null;
  arayanAdi: string;
  arananNumara: string | null;
  yontem: string;
  sure: string;
  sureSaniye: number;
  yon: string;
  yonKod: number | null;
  sesKaydi: string | null;
  hat: string | null;
}

export interface NetgsmCdrSnapshot {
  request_id: string;
  status: string;
  synced_at: Date;
  error_message: string | null;
  records: NetgsmCdrRow[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export class NetgsmVoiceRepository {
  constructor(private readonly db: AppDatabase) {}

  async isConfigured(): Promise<boolean> {
    const row = await this.db
      .selectFrom("integration_accounts")
      .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("integration_providers.key", "=", "netgsm")
      .where("integration_accounts.status", "=", "active")
      .executeTakeFirst();
    return Number(row?.count ?? 0) > 0;
  }

  /** Latest worker-written `netgsm.call.report` attempt (the API never calls NetGSM itself). */
  async latestCdrSnapshot(): Promise<NetgsmCdrSnapshot | null> {
    const attempt = await this.db
      .selectFrom("provider_attempts")
      .innerJoin("integration_providers", "integration_providers.id", "provider_attempts.provider_id")
      .select([
        "provider_attempts.request_id",
        "provider_attempts.status",
        "provider_attempts.started_at",
        "provider_attempts.error_message",
        "provider_attempts.response_metadata",
      ])
      .where("integration_providers.key", "=", "netgsm")
      .where("provider_attempts.operation", "=", "call.report")
      .orderBy("provider_attempts.started_at", "desc")
      .executeTakeFirst();
    if (!attempt) return null;
    const records = asRecord(attempt.response_metadata).cdr_records;
    return {
      request_id: attempt.request_id,
      status: attempt.status,
      synced_at: new Date(attempt.started_at),
      error_message: attempt.error_message,
      records: Array.isArray(records) ? (records as NetgsmCdrRow[]) : [],
    };
  }
}

/** Legacy formatDuration: seconds → HH:MM:SS. */
export function formatCdrDuration(seconds: number) {
  const s = Math.max(0, Math.trunc(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function filterCdrByDirection(records: NetgsmCdrRow[], direction: "gelen" | "giden" | null) {
  if (direction === "gelen") return records.filter((record) => record.yonKod === 1 || record.yonKod === 2);
  if (direction === "giden") return records.filter((record) => record.yonKod === 0 || record.yonKod === 3);
  return records;
}

/** Legacy /api/netgsm/cdr/istatistik. */
export function cdrStatistics(records: NetgsmCdrRow[]) {
  const gelenArama = records.filter((record) => record.yonKod === 1 || record.yonKod === 2).length;
  const gelenCevapli = records.filter((record) => record.yonKod === 1).length;
  const gelenCevapsiz = records.filter((record) => record.yonKod === 2).length;
  const gidenArama = records.filter((record) => record.yonKod === 0 || record.yonKod === 3).length;
  const totalSeconds = records.reduce((sum, record) => sum + (record.sureSaniye || 0), 0);
  return {
    gelenArama,
    gidenArama,
    gelenCevapli,
    gelenCevapsiz,
    toplamSure: formatCdrDuration(totalSeconds),
    toplamGorisme: records.length,
    ortalamaSure: formatCdrDuration(records.length > 0 ? Math.round(totalSeconds / records.length) : 0),
    cevaplananOran: gelenArama > 0 ? Math.round((gelenCevapli / gelenArama) * 100) : 0,
  };
}
