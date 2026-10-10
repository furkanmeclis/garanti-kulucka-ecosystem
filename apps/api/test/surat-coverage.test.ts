import type { AppDatabase } from "@garanti-kulucka/database";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { describe, expect, it } from "vitest";
import { evaluateSuratCoverage, istanbulDay, SuratCoverageService, suratAtKeywordWarning, suratCoverageKey } from "../src/cargo/surat-coverage.js";

const records = [
  { il: "KONYA", ilce: "SELÇUKLU", mahalle: "BOSNA HERSEK", at: true },
  { il: "KONYA", ilce: "SELÇUKLU", mahalle: "SARAYKÖY", at: false },
];

/** Minimal Kysely stand-in: settings → live gate, provider_attempts → cached answer. */
function fakeDb(input: { liveMode: boolean; answer?: unknown }) {
  const query = (table: string) => {
    const builder = {
      innerJoin: () => builder,
      select: () => builder,
      where: () => builder,
      orderBy: () => builder,
      executeTakeFirst: async () =>
        table === "settings"
          ? (input.liveMode ? { value: true } : undefined)
          : input.answer
            ? { response_metadata: { live_call_performed: true, result: { data: { records: input.answer } } }, started_at: new Date("2026-10-10T07:00:00.000Z") }
            : undefined,
    };
    return builder;
  };
  return { selectFrom: query } as unknown as AppDatabase;
}

function publisher(jobs: JobEnvelope[]) {
  return { publish: async (job: JobEnvelope) => (jobs.push(job), job.job_id) };
}

const now = () => new Date("2026-10-09T22:30:00.000Z"); // 01:30 on 10 Oct in Istanbul

describe("Sürat AT coverage decision", () => {
  it("keys districts and days the way the worker job is deduplicated", () => {
    expect(suratCoverageKey(" Konya ", "Selçuklu")).toBe("konya_selcuklu");
    expect(suratCoverageKey("İstanbul", "Üsküdar")).toBe("istanbul_uskudar");
    expect(istanbulDay(now())).toBe("20261010");
  });

  it("warns for an AT dışı mahalle named in the address or a fully AT dışı district only", () => {
    expect(evaluateSuratCoverage(records, "Sarayköy Mah. 12. Sk. No 3").status).toBe("not_covered");
    expect(evaluateSuratCoverage(records, "Bosna Hersek Mh. Ankara Cd.").status).toBe("covered");
    expect(evaluateSuratCoverage(records, "Merkez").status).toBe("partial");
    expect(evaluateSuratCoverage([{ mahalle: "A", at: false }], "").status).toBe("not_covered");
    expect(evaluateSuratCoverage([{ mahalle: "A", at: true }], "").status).toBe("covered");
    expect(evaluateSuratCoverage([{ mahalle: "A", at: null }], "").status).toBe("unknown");
    expect(evaluateSuratCoverage(records, "Merkez").uncovered).toEqual(["SARAYKÖY"]);
  });

  it("keeps the legacy keyword behaviour while the live gate is closed and queues nothing", async () => {
    const jobs: JobEnvelope[] = [];
    const service = new SuratCoverageService(fakeDb({ liveMode: false, answer: records }), publisher(jobs), now);
    await expect(service.check({ city: "Konya", district: "Selçuklu", address_line: "Sarayköy Mah." })).resolves.toMatchObject({
      status: "unknown",
      source: "keyword_fallback",
      warning: false,
      live_enabled: false,
      queued: false,
    });
    await expect(service.check({ city: "Konya", district: "Selçuklu", address_line: "Köy yolu, AT dışı" })).resolves.toMatchObject({ warning: true, source: "keyword_fallback" });
    expect(jobs).toHaveLength(0);
    expect(suratAtKeywordWarning({ city: "Van", district: "Merkez", address_line: "teslimat yok" })).toBe(true);
  });

  it("queues one idempotent coverage job per district and day when live and nothing is cached", async () => {
    const jobs: JobEnvelope[] = [];
    const service = new SuratCoverageService(fakeDb({ liveMode: true }), publisher(jobs), now);
    await expect(service.check({ city: "Konya", district: "Selçuklu", address_line: "Sarayköy Mah." })).resolves.toMatchObject({
      source: "keyword_fallback",
      warning: false,
      live_enabled: true,
      queued: true,
    });
    expect(jobs[0]).toMatchObject({
      job_id: "job_surat_coverage_konya_selcuklu_20261010",
      queue: "provider-delivery",
      name: "surat.address.coverage",
      payload: { envelope: { provider: "surat", operation: "address.coverage", payload: { il: "Konya", ilce: "Selçuklu", idempotency_key: "surat_coverage_konya_selcuklu_20261010" } } },
    });
  });

  it("uses today's live ATDurumListesi answer instead of keywords", async () => {
    const jobs: JobEnvelope[] = [];
    const service = new SuratCoverageService(fakeDb({ liveMode: true, answer: records }), publisher(jobs), now);
    await expect(service.check({ city: "Konya", district: "Selçuklu", address_line: "Sarayköy Mah. 3" })).resolves.toMatchObject({
      status: "not_covered",
      source: "provider",
      warning: true,
      uncovered_areas: ["SARAYKÖY"],
      checked_at: "2026-10-10T07:00:00.000Z",
    });
    await expect(service.check({ city: "Konya", district: "Selçuklu", address_line: "Bosna Hersek Mh." })).resolves.toMatchObject({ status: "covered", warning: false });
    expect(jobs).toHaveLength(0);
  });
});
