import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import {
  parseSuratCoverageResponse,
  sendSuratLiveRequest,
  suratCoverageFlag,
  type SuratFetchTransport,
  type SuratTransportRequest,
  type SuratTransportResponse,
} from "../src/providers/surat.js";

const now = "2026-01-01T00:00:00.000Z";
const origin = "https://surat.test";

function accountConfig(overrides: Record<string, unknown> = {}): ProviderAccountConfigRepository {
  return {
    getAccountConfig: async () => ({
      provider: "surat",
      account_public_id: "iac_surat_live",
      live_mode: true,
      tokens: {},
      settings: {
        "providers.surat.live_mode": true,
        live_mode: true,
        api_url: `${origin}/api`,
        cash_user: "cash-user",
        cash_pass: "cash-secret",
        cod_user: "cod-user",
        cod_pass: "cod-secret",
        irsaliye_seri_no: "A1",
        ...overrides,
      },
    }),
  };
}

function attemptRepository(persisted: ProviderAttempt[]): ProviderAttemptRepository {
  return {
    persist: async (attempt) => {
      persisted.push(attempt);
      return {
        id: persisted.length,
        public_id: `pat_${persisted.length}`,
        provider_id: 1,
        account_id: 1,
        request_id: attempt.request_id,
        operation: attempt.operation,
        direction: attempt.direction,
        status: attempt.status,
        status_code: attempt.status_code,
        duration_ms: attempt.duration_ms,
        retry_decision: attempt.retry_decision,
        next_retry_at: attempt.next_retry_at,
        idempotency_key: attempt.idempotency_key,
        request_metadata: attempt.request_metadata,
        response_metadata: attempt.response_metadata,
        error_code: attempt.error?.code ?? null,
        error_message: attempt.error?.message ?? null,
        started_at: attempt.started_at,
        created_at: new Date(now),
        updated_at: new Date(now),
      };
    },
  };
}

function deliveryJob(envelope: ProviderRequestEnvelope, attempts = 3) {
  return {
    id: "bull_job_surat",
    name: `${envelope.provider}.${envelope.operation}`,
    attemptsMade: 0,
    opts: { attempts },
    data: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: `${envelope.provider}.${envelope.operation}`,
      requested_at: now,
      payload: { envelope },
    },
  };
}

function createEnvelope(payload: Record<string, unknown> = {}): ProviderRequestEnvelope {
  return {
    request_id: "req_surat_create",
    provider: "surat",
    operation: "shipment.create",
    direction: "outbound",
    channel: "cargo",
    account_public_id: "iac_surat_live",
    occurred_at: now,
    payload: {
      idempotency_key: "shipment-create-surat-1",
      aliciAd: "Test Alici CASH",
      aliciAdres: "Bahcelievler mah. bosna bulvari no:146",
      aliciIl: "Istanbul",
      aliciIlce: "Uskudar",
      aliciTelefon: "0555 555 55 55",
      aliciEmail: "alici@example.com",
      geciciOzelNo: "SK-17734761539001",
      desi: 1,
      kg: 1,
      kargoTuru: 3,
      adet: 1,
      referansNo: "REF-SURAT-1",
      ...payload,
    },
  };
}

function trackEnvelope(payload: Record<string, unknown> = {}): ProviderRequestEnvelope {
  return {
    request_id: "req_surat_track",
    provider: "surat",
    operation: "shipment.track",
    direction: "outbound",
    channel: "cargo",
    account_public_id: "iac_surat_live",
    occurred_at: now,
    payload: {
      tracking_number: "SUR123456789",
      ...payload,
    },
  };
}

function transportReturning(captured: SuratTransportRequest[], response: SuratTransportResponse): SuratFetchTransport {
  return async (request) => {
    captured.push(request);
    return response;
  };
}

function transportReturningSequence(captured: SuratTransportRequest[], responses: SuratTransportResponse[]): SuratFetchTransport {
  return async (request) => {
    captured.push(request);
    const response = responses.shift();
    if (!response) throw new Error("No mock Sürat response queued");
    return response;
  };
}

function transportThrowing(captured: SuratTransportRequest[], error: Error & { code?: string }): SuratFetchTransport {
  return async (request) => {
    captured.push(request);
    throw error;
  };
}

const createStage1Response = JSON.stringify({
  isError: false,
  Message: "BASARILI",
  KargoTakipNo: "SUR123456789",
  Barcode: [],
  BarcodeNo: [],
  StatusCode: 200,
});

const createStage2Response = JSON.stringify({
  isError: false,
  Message: "BARKOD BASARILI",
  KargoTakipNo: "SUR123456789",
  Barcode: ["PDF_BASE64"],
  BarcodeNo: ["BRK123"],
  StatusCode: 200,
});

const deliveredTrackResponse = JSON.stringify({
  isError: false,
  Gonderiler: [
    {
      KargoObjId: 42,
      KargoTakipNo: "SUR123456789",
      TakipUrl: "https://suratkargo.com.tr/KargoTakip/?kargotakipno=SUR123456789",
      KargonunBulunduguYer: "ANKARA",
      KargonunDurumu: "Teslim Edildi",
      KargonunDurumuSayi: 6,
      TeslimAlan: "AYSE DEMIR",
      DevirDurum: "Hayir",
      IadeDurum: "Hayir",
      Hareketler: [
        { IslemTarihi: "2026-01-01T10:00:00", HareketYeri: "ISTANBUL", Islem: "Kargo Kabul", KargoHareketKargonunDurumuSayi: 1 },
        { IslemTarihi: "2026-01-02T12:30:00", HareketYeri: "ANKARA", Islem: "Teslim Edildi", KargoHareketKargonunDurumuSayi: 6 },
      ],
    },
  ],
  StatusCode: 200,
});

function liveAdapterInput(transport: SuratFetchTransport, envelope: ProviderRequestEnvelope = trackEnvelope()) {
  return {
    envelope,
    job: deliveryJob(envelope).data,
    accountConfig: {
      provider: "surat" as const,
      account_public_id: "iac_surat_live",
      live_mode: true,
      tokens: {},
      settings: {
        "providers.surat.live_mode": true,
        live_mode: true,
        api_url: `${origin}/api`,
        cash_user: "cash-user",
        cash_pass: "cash-secret",
        cod_user: "cod-user",
        cod_pass: "cod-secret",
      },
    },
    policy: {
      contract_mode: "live" as const,
      live_call_permitted: true as const,
      reason: "account_live_mode_enabled" as const,
      timeout_ms: 30_000,
      max_attempts: 3,
    },
    attemptNumber: 1,
    maxAttempts: 3,
    transport,
    now: new Date(now),
  };
}

describe("Sürat live REST adapter", () => {
  it("sends shipment.create with legacy two-stage OrtakBarkodOlustur request material", async () => {
    const captured: SuratTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      suratTransport: transportReturningSequence(captured, [
        { status: 200, headers: { "content-type": "application/json" }, body: createStage1Response },
        { status: 200, headers: { "content-type": "application/json" }, body: createStage2Response },
      ]),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(createEnvelope()))).resolves.toMatchObject({
      status: "accepted_live",
      live_call_performed: true,
    });

    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      surat_endpoint: "OrtakBarkodOlustur",
      account_type: "cash",
    });
    expect(new URL(captured[0]?.url ?? "").pathname).toBe("/api/OrtakBarkodOlustur");
    expect(captured[0]?.body).toBe(JSON.stringify({
      KullaniciAdi: "cash-user",
      Sifre: "cash-secret",
      Gonderi: {
        KisiKurum: "Test Alici CASH",
        AliciAdresi: "Bahcelievler mah. bosna bulvari no:146",
        Il: "Istanbul",
        Ilce: "Uskudar",
        TelefonCep: "05555555555",
        KargoTuru: 3,
        OdemeTipi: 1,
        IrsaliyeSeriNo: "",
        IrsaliyeSiraNo: "",
        OzelKargoTakipNo: "SK-17734761539001",
        Adet: 1,
        BirimDesi: "1",
        BirimKg: "1",
        KargoIcerigi: "1:1:3:1;",
        TasimaSekli: 1,
        TeslimSekli: 1,
        GonderiSekli: 0,
        Pazaryerimi: 0,
        Iademi: 0,
        KapidanOdemeTahsilatTipi: 0,
        KapidanOdemeTutari: "0",
        Email: "alici@example.com",
        ReferansNo: "REF-SURAT-1",
      },
    }));
    expect(JSON.parse(captured[1]?.body ?? "{}").Gonderi.OzelKargoTakipNo).toBe("SUR123456789");
    expect(persisted).toHaveLength(1);
    expect(JSON.stringify(persisted[0]?.request_metadata)).not.toContain("cash-secret");
    expect(JSON.stringify(persisted[0]?.request_metadata)).not.toContain("cash-user");
    expect(persisted[0]).toMatchObject({ status: "success", status_code: 200 });
  });

  it("selects COD credentials when kapıda ödeme is requested", async () => {
    const captured: SuratTransportRequest[] = [];
    await sendSuratLiveRequest(liveAdapterInput(
      transportReturningSequence(captured, [
        { status: 200, headers: { "content-type": "application/json" }, body: createStage1Response },
        { status: 200, headers: { "content-type": "application/json" }, body: createStage2Response },
      ]),
      createEnvelope({ kapidaOdemeTutari: 150, kapidaOdemeTahsilatTipi: 1 }),
    ));

    expect(captured[0]?.account_type).toBe("cod");
    expect(JSON.parse(captured[0]?.body ?? "{}")).toMatchObject({
      KullaniciAdi: "cod-user",
      Sifre: "cod-secret",
      Gonderi: {
        IrsaliyeSeriNo: "A1",
        IrsaliyeSiraNo: "7225600000",
        KapidanOdemeTahsilatTipi: 1,
        KapidanOdemeTutari: "150",
      },
    });
  });

  it("sends shipment.track with legacy query params, headers, empty body, and normalized status", async () => {
    const captured: SuratTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      suratTransport: transportReturning(captured, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: deliveredTrackResponse,
      }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(trackEnvelope({ hesapTipi: "cash" })))).resolves.toMatchObject({
      status: "accepted_live",
      live_call_performed: true,
    });

    expect(captured).toHaveLength(1);
    const request = captured[0];
    const url = new URL(request?.url ?? "");
    expect(request).toMatchObject({
      method: "POST",
      headers: { Accept: "application/json, text/plain, */*" },
      body: "",
      surat_endpoint: "KargoTakipHareketDetayi",
      account_type: "cash",
    });
    expect(url.pathname).toBe("/api/KargoTakipHareketDetayi");
    expect(url.searchParams.get("CariKodu")).toBe("cash-user");
    expect(url.searchParams.get("Sifre")).toBe("cash-secret");
    expect(url.searchParams.get("WebSiparisKodu")).toBe("SUR123456789");
    expect(persisted[0]?.response_metadata).toMatchObject({ live_call_performed: true, accepted: true });
    expect(JSON.stringify(persisted[0]?.request_metadata)).not.toContain("cash-secret");
  });

  it("normalizes delivered Sürat tracking payloads with legacy status mapping", async () => {
    const captured: SuratTransportRequest[] = [];
    const result = await sendSuratLiveRequest(liveAdapterInput(transportReturning(captured, {
      status: 200,
      headers: { "content-type": "application/json" },
      body: deliveredTrackResponse,
    }), trackEnvelope({ hesapTipi: "cash" })));

    expect(result.response_payload).toMatchObject({
      success: true,
      data: {
        hesapTipi: "cash",
        gonderiler: [
          {
            kargoTakipNo: "SUR123456789",
            kargonunDurumu: "Teslim Edildi",
            kargonunDurumuSayi: 6,
            sonHareket: "Teslim Edildi — ANKARA",
            shipment_status: "teslim_edildi",
            hareketler: [
              { islem: "Kargo Kabul", hareketYeri: "ISTANBUL", durumuSayi: 1 },
              { islem: "Teslim Edildi", hareketYeri: "ANKARA", durumuSayi: 6 },
            ],
          },
        ],
      },
    });
  });

  it("tries cash then COD for shipment.track when no account type is supplied", async () => {
    const captured: SuratTransportRequest[] = [];
    const malformedEmpty = JSON.stringify({ isError: false, Gonderiler: [], StatusCode: 200 });

    await expect(sendSuratLiveRequest(liveAdapterInput(transportReturningSequence(captured, [
      { status: 200, headers: { "content-type": "application/json" }, body: malformedEmpty },
      { status: 200, headers: { "content-type": "application/json" }, body: deliveredTrackResponse },
    ])))).resolves.toMatchObject({ response_payload: { success: true } });

    expect(captured.map((request) => request.account_type)).toEqual(["cash", "cod"]);
  });

  it.each([
    { status: 429, expected: "retryable_failure", decision: "retry" },
    { status: 503, expected: "retryable_failure", decision: "retry" },
  ])("persists retryable failure attempts for HTTP $status", async ({ status, expected, decision }) => {
    const captured: SuratTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      suratTransport: transportReturning(captured, {
        status,
        headers: { "content-type": "text/plain" },
        body: "retry later",
      }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(trackEnvelope({ hesapTipi: "cash" }), 3))).rejects.toThrow(`HTTP ${status}`);

    expect(captured).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      status: expected,
      status_code: status,
      retry_decision: decision,
      error: { code: "provider_http_error" },
    });
    expect(JSON.stringify(persisted[0]?.request_metadata)).not.toContain("cash-secret");
  });

  it("does not retry non-idempotent shipment.create without an idempotency key", async () => {
    const captured: SuratTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      suratTransport: transportReturning(captured, {
        status: 503,
        headers: { "content-type": "text/plain" },
        body: "provider unavailable",
      }),
    });
    const envelope = createEnvelope();
    delete envelope.payload.idempotency_key;

    await expect(registry.dispatch("provider-delivery", deliveryJob(envelope, 3))).rejects.toThrow("HTTP 503");

    expect(persisted[0]).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      request_metadata: { retry: { reason: "missing_idempotency_key" } },
    });
  });

  it("persists timeout, connection, and malformed response failures with redacted metadata", async () => {
    const cases = [
      {
        transportError: Object.assign(new Error("Sürat request timed out after 10ms"), { code: "timeout" }),
        response: null,
        error: /timed out/i,
        code: "timeout",
        statusCode: null,
      },
      {
        transportError: Object.assign(new Error("fetch failed"), { code: "network_error" }),
        response: null,
        error: /fetch failed/i,
        code: "network_error",
        statusCode: null,
      },
      {
        transportError: null,
        response: { status: 200, headers: { "content-type": "application/json" }, body: "not-json" },
        error: /could not be normalized/i,
        code: "malformed_response",
        statusCode: 200,
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const captured: SuratTransportRequest[] = [];
      const persisted: ProviderAttempt[] = [];
      const registry = createWorkerProcessorRegistry({
        providerAccountConfigRepository: accountConfig({ timeout_ms: 10 }),
        providerAttemptRepository: attemptRepository(persisted),
        suratTransport: testCase.transportError
          ? transportThrowing(captured, testCase.transportError)
          : transportReturning(captured, testCase.response),
      });

      await expect(registry.dispatch("provider-delivery", deliveryJob(trackEnvelope({ hesapTipi: "cash" }), 3))).rejects.toThrow(testCase.error);

      expect(captured).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        status_code: testCase.statusCode,
        error: { code: testCase.code },
      });
      expect(JSON.stringify(persisted[0]?.request_metadata), `case ${index}`).not.toContain("cash-secret");
      expect(JSON.stringify(persisted[0]?.request_metadata), `case ${index}`).not.toContain("cash-user");
    }
  });
});

describe("Sürat ATDurumListesi (address.coverage)", () => {
  const fixture = (name: string) => readFileSync(new URL(`../../../contracts/providers/surat/fixtures/responses/${name}`, import.meta.url), "utf8");

  function coverageEnvelope(): ProviderRequestEnvelope {
    return {
      request_id: "req_surat_coverage",
      provider: "surat",
      operation: "address.coverage",
      direction: "outbound",
      channel: "cargo",
      account_public_id: "iac_surat_live",
      occurred_at: now,
      payload: { il: "Konya", ilce: "Selçuklu", idempotency_key: "surat_coverage_konya_selcuklu_20260101" },
    };
  }

  it("sends a SOAP ATDurumListesi request with redacted credentials and parses per-area AT flags", async () => {
    const captured: SuratTransportRequest[] = [];
    const result = await sendSuratLiveRequest(
      liveAdapterInput(transportReturning(captured, { status: 200, headers: { "content-type": "text/xml" }, body: fixture("at_durum_listesi_mixed.xml") }), coverageEnvelope()),
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      method: "POST",
      url: "https://webservices.suratkargo.com.tr/services.asmx",
      surat_endpoint: "ATDurumListesi",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '"http://tempuri.org/ATDurumListesi"' },
    });
    expect(captured[0]!.body).toContain("<Il>Konya</Il><Ilce>Selçuklu</Ilce>");
    expect(captured[0]!.body).toContain("<KullaniciAdi>cash-user</KullaniciAdi>");
    expect(result.response_payload).toMatchObject({
      success: true,
      data: {
        il: "Konya",
        ilce: "Selçuklu",
        at_ici: 2,
        at_disi: 1,
        records: [
          { mahalle: "BOSNA HERSEK", at: true },
          { mahalle: "SARAYKÖY", at: false, durum: "AT DIŞI" },
          { mahalle: "YAZIR", at: true },
        ],
      },
    });
    const serialized = JSON.stringify(result.attempt);
    expect(serialized).not.toContain("cash-secret");
    expect(serialized).toContain("<Sifre>[redacted]</Sifre>");
  });

  it("treats a SOAP fault as a malformed (non-retryable) response", async () => {
    const captured: SuratTransportRequest[] = [];
    await expect(
      sendSuratLiveRequest(liveAdapterInput(transportReturning(captured, { status: 200, headers: {}, body: fixture("at_durum_listesi_fault.xml") }), coverageEnvelope())),
    ).rejects.toMatchObject({ attempt: { error: { code: "malformed_response" } } });
  });

  it("maps legacy status words and bare single-district answers", () => {
    expect(["AT İÇİ", "Var", "EVET", "true"].map(suratCoverageFlag)).toEqual([true, true, true, true]);
    expect(["AT DIŞI", "at disi", "Yok", "Hayır", "0"].map(suratCoverageFlag)).toEqual([false, false, false, false, false]);
    expect(suratCoverageFlag("bilinmiyor")).toBeNull();
    expect(
      parseSuratCoverageResponse("<s:Envelope><s:Body><ATDurumListesiResponse><ATDurumListesiResult><Il>VAN</Il><Ilce>BAHÇESARAY</Ilce><ATDurumu>AT DIŞI</ATDurumu></ATDurumListesiResult></ATDurumListesiResponse></s:Body></s:Envelope>"),
    ).toMatchObject({ data: { at_disi: 1, records: [{ il: "VAN", ilce: "BAHÇESARAY", at: false }] } });
  });

  it("stays a dry-run fixture attempt unless providers.surat.live_mode is explicitly on", async () => {
    const persisted: ProviderAttempt[] = [];
    const captured: SuratTransportRequest[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAttemptRepository: attemptRepository(persisted),
      providerAccountConfigRepository: accountConfig({ "providers.surat.live_mode": false }),
      suratTransport: transportReturning(captured, { status: 200, headers: {}, body: fixture("at_durum_listesi_mixed.xml") }),
    });
    await registry.dispatch("provider-delivery", deliveryJob(coverageEnvelope()));
    expect(captured).toHaveLength(0);
    expect(persisted[0]).toMatchObject({ operation: "address.coverage", status: "success", response_metadata: { live_call_performed: false } });

    const livePersisted: ProviderAttempt[] = [];
    const live = createWorkerProcessorRegistry({
      providerAttemptRepository: attemptRepository(livePersisted),
      providerAccountConfigRepository: accountConfig(),
      suratTransport: transportReturning(captured, { status: 200, headers: {}, body: fixture("at_durum_listesi_mixed.xml") }),
    });
    await live.dispatch("provider-delivery", deliveryJob(coverageEnvelope()));
    expect(captured).toHaveLength(1);
    // The API reads the area list back from the persisted attempt.
    expect(livePersisted[0]).toMatchObject({ status: "success", response_metadata: { live_call_performed: true, result: { data: { at_disi: 1 } } } });
  });
});
