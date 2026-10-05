import { describe, expect, it } from "vitest";
import type { ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { createWorkerProcessorRegistry } from "../src/processors.js";
import type { ProviderAccountConfigRepository } from "../src/providers/account-config.js";
import type { ProviderAttemptRepository } from "../src/providers/attempts.js";
import {
  calculatePttCheckDigit,
  sendPttLiveRequest,
  type PttFetchTransport,
  type PttTransportRequest,
  type PttTransportResponse,
} from "../src/providers/ptt.js";

const now = "2026-01-01T00:00:00.000Z";
const origin = "https://ptt.test";

function accountConfig(overrides: Record<string, unknown> = {}): ProviderAccountConfigRepository {
  return {
    getAccountConfig: async () => ({
      provider: "ptt",
      account_public_id: "iac_ptt_live",
      live_mode: true,
      tokens: {},
      settings: {
        "providers.ptt.live_mode": true,
        live_mode: true,
        musteri_no: "100589048",
        sifre: "ptt-secret",
        posta_ceki: "11876293",
        gonderici_adi: "GARANTI KULUCKA",
        gonderici_adres: "Merkez Mah.",
        gonderici_il: "ISTANBUL",
        gonderici_ilce: "KADIKOY",
        gonderici_telefon: "05551234567",
        veri_yukleme_url: `${origin}/PttVeriYukleme/services/Sorgu`,
        gonderi_takip_url: `${origin}/GonderiTakipV2/services/Sorgu`,
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
    id: "bull_job_ptt",
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
    request_id: "req_ptt_create",
    provider: "ptt",
    operation: "shipment.create",
    direction: "outbound",
    channel: "cargo",
    account_public_id: "iac_ptt_live",
    occurred_at: now,
    payload: {
      idempotency_key: "shipment-create-1",
      aliciAdi: "AHMET YILMAZ",
      aliciAdres: "KADIKOY MAHALLESI NO:10",
      aliciIl: "ISTANBUL",
      aliciIlce: "KADIKOY",
      aliciTelefon: "05551234567",
      aliciEmail: "ahmet@example.com",
      agirlik: 2,
      desi: 3,
      dosyaAdi: "GND-100589048-1700000000000",
      musteriReferansNo: "REF-1700000000000-fixed",
      barkodSira: "0001",
      ...payload,
    },
  };
}

function trackEnvelope(): ProviderRequestEnvelope {
  return {
    request_id: "req_ptt_track",
    provider: "ptt",
    operation: "shipment.track",
    direction: "outbound",
    channel: "cargo",
    account_public_id: "iac_ptt_live",
    occurred_at: now,
    payload: {
      tracking_number: "2791727900015",
    },
  };
}

function transportReturning(
  captured: PttTransportRequest[],
  response: PttTransportResponse,
): PttFetchTransport {
  return async (request) => {
    captured.push(request);
    return response;
  };
}

function transportReturningSequence(
  captured: PttTransportRequest[],
  responses: PttTransportResponse[],
): PttFetchTransport {
  return async (request) => {
    captured.push(request);
    const response = responses.shift();
    if (!response) {
      throw new Error("No mock PTT response queued");
    }
    return response;
  };
}

function transportThrowing(captured: PttTransportRequest[], error: Error & { code?: string }): PttFetchTransport {
  return async (request) => {
    captured.push(request);
    throw error;
  };
}

const createSuccessXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope><soap:Body><kabulEkle2Response><return><hataKodu>1</hataKodu><aciklama>BASARILI</aciklama><dongu><donguHataKodu>1</donguHataKodu><barkod>2791727900015</barkod></dongu></return></kabulEkle2Response></soap:Body></soap:Envelope>`;

const trackSuccessXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope><soap:Body><gonderiSorgu2Response><return><sonucKodu>0</sonucKodu><sonucAciklama>BASARILI</sonucAciklama><BARNO>2791727900015</BARNO><IMERK>KADIKOY</IMERK><VMERK>ANKARA</VMERK></return></gonderiSorgu2Response></soap:Body></soap:Envelope>`;

const trackFaultXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>legacy fallback</faultstring></soap:Fault></soap:Body></soap:Envelope>`;

const deliveredTrackXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope><soap:Body><gonderiSorgu2Response><return><sonucKodu>0</sonucKodu><sonucAciklama>BASARILI</sonucAciklama><BARNO>2791727900015</BARNO><IMERK>KADIKOY</IMERK><VMERK>ANKARA</VMERK><TESALAN>AYSE DEMIR</TESALAN><ALICI>AYSE DEMIR</ALICI><GONDEREN>GARANTI KULUCKA</GONDEREN><GR>1500</GR><GONUCR>42.50</GONUCR><EKHIZ>OS</EKHIZ><ODSARUCR>100.00</ODSARUCR><ITARIH>01.01.2026</ITARIH><reserve1>GND-100589048-1700000000000</reserve1><reserve2>REF-1700000000000-fixed</reserve2><safahatlar><GonderiSafahat><ISLEM>KABUL EDILDI</ISLEM><IMERK>KADIKOY</IMERK><ITARIH>01.01.2026</ITARIH><ISAAT>10:00</ISAAT></GonderiSafahat><GonderiSafahat><ISLEM>TESLIM EDILDI</ISLEM><IMERK>ANKARA</IMERK><ITARIH>02.01.2026</ITARIH><ISAAT>12:30</ISAAT></GonderiSafahat></safahatlar></return></gonderiSorgu2Response></soap:Body></soap:Envelope>`;

const distributionTrackXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope><soap:Body><gonderiSorgu2Response><return><sonucKodu>0</sonucKodu><sonucAciklama>BASARILI</sonucAciklama><BARNO>2791727900015</BARNO><ALICI>MEHMET TEST</ALICI><GONDEREN>GARANTI KULUCKA</GONDEREN><GR>900</GR><GONUCR>25.00</GONUCR><safahatlar><GonderiSafahat><ISLEM>KABUL EDILDI</ISLEM><IMERK>KADIKOY</IMERK><ITARIH>01.01.2026</ITARIH><ISAAT>10:00</ISAAT></GonderiSafahat><GonderiSafahat><ISLEM>DAGITIMDA</ISLEM><IMERK>ANKARA</IMERK><ITARIH>02.01.2026</ITARIH><ISAAT>09:00</ISAAT></GonderiSafahat></safahatlar></return></gonderiSorgu2Response></soap:Body></soap:Envelope>`;

function liveAdapterInput(transport: PttFetchTransport, envelope: ProviderRequestEnvelope = trackEnvelope()) {
  return {
    envelope,
    job: deliveryJob(envelope).data,
    accountConfig: {
      provider: "ptt" as const,
      account_public_id: "iac_ptt_live",
      live_mode: true,
      tokens: {},
      settings: {
        "providers.ptt.live_mode": true,
        live_mode: true,
        musteri_no: "100589048",
        sifre: "ptt-secret",
        veri_yukleme_url: `${origin}/PttVeriYukleme/services/Sorgu`,
        gonderi_takip_url: `${origin}/GonderiTakipV2/services/Sorgu`,
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

describe("PTT live SOAP adapter", () => {
  it("calculates PTT barcode Mod10 check digits", () => {
    expect(calculatePttCheckDigit("279172790001")).toBe("5");
  });

  it("sends shipment.create with the legacy SOAP method, path, headers, and body", async () => {
    const captured: PttTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig({ barkod_araligi: "27917279" }),
      providerAttemptRepository: attemptRepository(persisted),
      pttTransport: transportReturning(captured, {
        status: 200,
        headers: { "content-type": "application/soap+xml" },
        body: createSuccessXml,
      }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(createEnvelope()))).resolves.toMatchObject({
      status: "accepted_live",
      live_call_performed: true,
    });

    expect(captured).toHaveLength(1);
    const request = captured[0];
    expect(request?.method).toBe("POST");
    expect(new URL(request?.url ?? "").pathname).toBe("/PttVeriYukleme/services/Sorgu");
    expect(request?.headers).toEqual({
      "Content-Type": 'application/soap+xml; charset=utf-8; action="kabulEkle2"',
      "User-Agent": "GarantiPanel/1.0",
    });
    expect(request?.body).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:kab="http://kabul.ptt.gov.tr" xmlns:xsd="http://kabul.ptt.gov.tr/xsd">
  <soap:Header/>
  <soap:Body>
    <kab:kabulEkle2>
      <kab:input>
        <xsd:dongu>
          <xsd:aAdres>KADIKOY MAHALLESI NO:10</xsd:aAdres>
          
          
          <xsd:agirlik>2000</xsd:agirlik>
          <xsd:aliciAdi>AHMET YILMAZ</xsd:aliciAdi>
          <xsd:aliciEmail>ahmet@example.com</xsd:aliciEmail>
          <xsd:aliciIlAdi>ISTANBUL</xsd:aliciIlAdi>
          <xsd:aliciIlceAdi>KADIKOY</xsd:aliciIlceAdi>
          <xsd:aliciSms>5551234567</xsd:aliciSms>
          <xsd:aliciTel>5551234567</xsd:aliciTel>
          <xsd:barkodNo>2791727900015</xsd:barkodNo>
          
          
          <xsd:desi>3</xsd:desi>
          
          
          <xsd:gondericibilgi>
            <xsd:gonderici_adi>GARANTI KULUCKA</xsd:gonderici_adi>
            <xsd:gonderici_adresi>MERKEZ MAH.</xsd:gonderici_adresi>
            <xsd:gonderici_il_ad>ISTANBUL</xsd:gonderici_il_ad>
            <xsd:gonderici_ilce_ad>KADIKOY</xsd:gonderici_ilce_ad>
            <xsd:gonderici_sms>5551234567</xsd:gonderici_sms>
            <xsd:gonderici_telefonu>5551234567</xsd:gonderici_telefonu>
            <xsd:gonderici_ulke_id>052</xsd:gonderici_ulke_id>
          </xsd:gondericibilgi>
          <xsd:musteriReferansNo>REF-1700000000000-fixed</xsd:musteriReferansNo>
          
          <xsd:odemesekli>MH</xsd:odemesekli>
          <xsd:rezerve1>11876293</xsd:rezerve1>
          <xsd:ucret>0</xsd:ucret>
          
        </xsd:dongu>
        <xsd:dosyaAdi>GND-100589048-1700000000000</xsd:dosyaAdi>
        <xsd:gonderiTip>NORMAL</xsd:gonderiTip>
        <xsd:gonderiTur>KARGO</xsd:gonderiTur>
        <xsd:kullanici>PttWs</xsd:kullanici>
        <xsd:musteriId>100589048</xsd:musteriId>
        <xsd:sifre>ptt-secret</xsd:sifre>
      </kab:input>
    </kab:kabulEkle2>
  </soap:Body>
</soap:Envelope>`);
    expect(persisted).toHaveLength(1);
    expect(JSON.stringify(persisted[0]?.request_metadata)).not.toContain("ptt-secret");
    expect(persisted[0]).toMatchObject({
      status: "success",
      status_code: 200,
      response_metadata: {
        live_call_performed: true,
      },
    });
  });

  it("sends shipment.track with the legacy SOAP method, path, headers, and body", async () => {
    const captured: PttTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      pttTransport: transportReturning(captured, {
        status: 200,
        headers: { "content-type": "application/soap+xml" },
        body: trackSuccessXml,
      }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(trackEnvelope()))).resolves.toMatchObject({
      status: "accepted_live",
    });

    expect(captured).toHaveLength(1);
    const request = captured[0];
    expect(request?.method).toBe("POST");
    expect(new URL(request?.url ?? "").pathname).toBe("/GonderiTakipV2/services/Sorgu");
    expect(request?.headers).toEqual({
      "Content-Type": 'application/soap+xml; charset=utf-8; action="gonderiSorgu2"',
    });
    expect(request?.body).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tak="http://takip.ptt.gov.tr">
  <soap:Header/>
  <soap:Body>
    <tak:gonderiSorgu2>
      <tak:input>
        <barkod>2791727900015</barkod>
        <kullanici>100589048</kullanici>
        <sifre>ptt-secret</sifre>
      </tak:input>
    </tak:gonderiSorgu2>
  </soap:Body>
</soap:Envelope>`);
    expect(persisted[0]).toMatchObject({ status: "success", status_code: 200 });
    expect(JSON.stringify(persisted[0]?.request_metadata)).not.toContain("ptt-secret");
  });

  it("falls back from gonderiSorgu2 to gonderiSorgu on SOAP Fault and records both calls", async () => {
    const captured: PttTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      pttTransport: transportReturningSequence(captured, [
        {
          status: 200,
          headers: { "content-type": "application/soap+xml" },
          body: trackFaultXml,
        },
        {
          status: 200,
          headers: { "content-type": "application/soap+xml" },
          body: distributionTrackXml,
        },
      ]),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(trackEnvelope()))).resolves.toMatchObject({
      status: "accepted_live",
    });

    expect(captured.map((request) => request.ptt_method)).toEqual(["gonderiSorgu2", "gonderiSorgu"]);
    expect(captured.map((request) => request.headers["Content-Type"])).toEqual([
      'application/soap+xml; charset=utf-8; action="gonderiSorgu2"',
      'application/soap+xml; charset=utf-8; action="gonderiSorgu"',
    ]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.request_metadata).toMatchObject({
      request: {
        method_tried: ["gonderiSorgu2", "gonderiSorgu"],
        attempts: [
          { ptt_method: "gonderiSorgu2" },
          { ptt_method: "gonderiSorgu" },
        ],
      },
    });
    expect(persisted[0]?.response_metadata).toMatchObject({
      calls: [
        { ptt_method: "gonderiSorgu2", soap_fault: true },
        { ptt_method: "gonderiSorgu", soap_fault: false },
      ],
    });
    expect(JSON.stringify(persisted[0]?.request_metadata)).not.toContain("ptt-secret");
  });

  it("normalizes delivered PTT tracking payloads with legacy fields and canonical status", async () => {
    const captured: PttTransportRequest[] = [];
    const result = await sendPttLiveRequest(liveAdapterInput(transportReturning(captured, {
      status: 200,
      headers: { "content-type": "application/soap+xml" },
      body: deliveredTrackXml,
    })));

    expect(result.response_payload).toMatchObject({
      success: true,
      barkodNo: "2791727900015",
      kabulMerkezi: "KADIKOY",
      varisMerkezi: "ANKARA",
      teslimAlan: "AYSE DEMIR",
      alici: "AYSE DEMIR",
      gonderen: "GARANTI KULUCKA",
      agirlikGram: "1500",
      ucret: "42.50",
      ekHizmet: "OS",
      odemeSartliUcret: "100.00",
      kabulTarihi: "01.01.2026",
      dosyaAdi: "GND-100589048-1700000000000",
      referansNo: "REF-1700000000000-fixed",
      durum: "TESLIM_EDILDI",
      shipment_status: "teslim_edildi",
      providerSonucKodu: 0,
      providerSonucAciklama: "BASARILI",
    });
    expect(result.response_payload.hareketler).toEqual([
      { islem: "KABUL EDILDI", merkez: "KADIKOY", tarih: "01.01.2026", saat: "10:00" },
      { islem: "TESLIM EDILDI", merkez: "ANKARA", tarih: "02.01.2026", saat: "12:30" },
    ]);
  });

  it("normalizes in-distribution PTT movements in source order", async () => {
    const captured: PttTransportRequest[] = [];
    const result = await sendPttLiveRequest(liveAdapterInput(transportReturning(captured, {
      status: 200,
      headers: { "content-type": "application/soap+xml" },
      body: distributionTrackXml,
    })));

    expect(result.response_payload).toMatchObject({
      durum: "DAGITIMDA",
      shipment_status: "dagitimda",
      alici: "MEHMET TEST",
      gonderen: "GARANTI KULUCKA",
      agirlikGram: "900",
      ucret: "25.00",
    });
    expect(result.response_payload.hareketler).toEqual([
      { islem: "KABUL EDILDI", merkez: "KADIKOY", tarih: "01.01.2026", saat: "10:00" },
      { islem: "DAGITIMDA", merkez: "ANKARA", tarih: "02.01.2026", saat: "09:00" },
    ]);
  });

  it.each([
    { status: 429, expected: "retryable_failure", decision: "retry" },
    { status: 503, expected: "retryable_failure", decision: "retry" },
  ])("persists retryable failure attempts for HTTP $status", async ({ status, expected, decision }) => {
    const captured: PttTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      pttTransport: transportReturning(captured, {
        status,
        headers: { "content-type": "text/plain" },
        body: "retry later",
      }),
    });

    await expect(registry.dispatch("provider-delivery", deliveryJob(trackEnvelope(), 3))).rejects.toThrow(`HTTP ${status}`);

    expect(captured).toHaveLength(1);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      status: expected,
      status_code: status,
      retry_decision: decision,
      error: { code: "provider_http_error" },
    });
  });

  it("does not retry non-idempotent shipment.create without an idempotency key", async () => {
    const captured: PttTransportRequest[] = [];
    const persisted: ProviderAttempt[] = [];
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: accountConfig(),
      providerAttemptRepository: attemptRepository(persisted),
      pttTransport: transportReturning(captured, {
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
      request_metadata: {
        retry: {
          reason: "missing_idempotency_key",
        },
      },
    });
  });

  it("persists timeout, connection, and malformed response failures with redacted metadata", async () => {
    const cases = [
      {
        transportError: Object.assign(new Error("PTT request timed out after 10ms"), { code: "timeout" }),
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
        response: {
          status: 200,
          headers: { "content-type": "application/soap+xml" },
          body: "<not-soap/>",
        },
        error: /could not be normalized/i,
        code: "malformed_response",
        statusCode: 200,
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const captured: PttTransportRequest[] = [];
      const persisted: ProviderAttempt[] = [];
      const registry = createWorkerProcessorRegistry({
        providerAccountConfigRepository: accountConfig({ timeout_ms: 10 }),
        providerAttemptRepository: attemptRepository(persisted),
        pttTransport: testCase.transportError
          ? transportThrowing(captured, testCase.transportError)
          : transportReturning(captured, testCase.response),
      });

      await expect(registry.dispatch("provider-delivery", deliveryJob(trackEnvelope(), 3))).rejects.toThrow(testCase.error);

      expect(captured).toHaveLength(1);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        status_code: testCase.statusCode,
        error: { code: testCase.code },
      });
      expect(JSON.stringify(persisted[0]?.request_metadata), `case ${index}`).not.toContain("ptt-secret");
    }
  });
});
