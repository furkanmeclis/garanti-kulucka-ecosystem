import type { JobEnvelope, ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptSchema } from "@garanti-kulucka/shared";
import type { ProviderRetryDecision } from "./retry.js";
import { decideProviderRetry } from "./retry.js";
import type { ProviderAccountConfig } from "./account-config.js";
import type { LiveProviderTransportPolicy } from "./transport-policy.js";

export interface PttTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface PttTransportRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeout_ms: number;
  ptt_method: string;
}

export type PttFetchTransport = (request: PttTransportRequest) => Promise<PttTransportResponse>;

export interface PttLiveAdapterInput {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  accountConfig: ProviderAccountConfig;
  policy: LiveProviderTransportPolicy;
  attemptNumber: number;
  maxAttempts: number;
  transport?: PttFetchTransport;
  now?: Date;
}

export interface PttLiveAdapterResult {
  attempt: ProviderAttempt;
  response_payload: Record<string, unknown>;
}

export class PttLiveTransportError extends Error {
  constructor(
    message: string,
    readonly attempt: ProviderAttempt,
  ) {
    super(message);
    this.name = "PttLiveTransportError";
  }
}

interface PttMovement {
  islem: string;
  merkez: string;
  tarih: string;
  saat: string;
}

interface PttTrackParseResult {
  hasFault: boolean;
  sonucKodu: number | null;
  sonucAciklama: string;
  barkodNo: string;
  kabulMerkezi: string;
  varisMerkezi: string;
  teslimAlan: string;
  alici: string;
  gonderen: string;
  agirlikGram: string;
  ucret: string;
  ekHizmet: string;
  odemeSartliUcret: string;
  kabulTarihi: string;
  dosyaAdi: string;
  referansNo: string;
  hareketler: PttMovement[];
}

interface PttCallRecord {
  request: PttTransportRequest;
  response: PttTransportResponse;
}

const defaultVeriYuklemeUrl = "https://pttws.ptt.gov.tr/PttVeriYukleme/services/Sorgu";
const defaultGonderiTakipUrl = "https://pttws.ptt.gov.tr/GonderiTakipV2/services/Sorgu";

function stringSetting(settings: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return fallback;
}

function payloadString(payload: Record<string, unknown>, keys: string[], fallback = ""): string {
  return stringSetting(payload, keys, fallback);
}

function payloadNumber(payload: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return fallback;
}

export function calculatePttCheckDigit(barcode12: string): string | null {
  if (!/^\d{12}$/.test(barcode12)) {
    return null;
  }

  let total = 0;
  for (let index = 0; index < barcode12.length; index += 1) {
    total += Number.parseInt(barcode12[index] ?? "0", 10) * (index % 2 === 0 ? 1 : 3);
  }

  return String((10 - (total % 10)) % 10);
}

function buildPttBarcode(range: string, sequence: string): string {
  const barcode12 = `${range}${sequence.padStart(4, "0")}`;
  const checkDigit = calculatePttCheckDigit(barcode12);
  if (!checkDigit) {
    throw new Error("PTT barcode range and sequence must create 12 digits");
  }

  return `${barcode12}${checkDigit}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function turkishUpperCase(value: string): string {
  return value
    .replace(/i/g, "İ")
    .replace(/ı/g, "I")
    .replace(/ğ/g, "Ğ")
    .replace(/ü/g, "Ü")
    .replace(/ş/g, "Ş")
    .replace(/ö/g, "Ö")
    .replace(/ç/g, "Ç")
    .toUpperCase();
}

function senderXml(settings: Record<string, unknown>): string {
  const phone = stringSetting(settings, ["gonderici_telefon", "ptt.gonderici_telefon", "sender_phone"])
    .replace(/[^0-9]/g, "")
    .replace(/^0/, "")
    .slice(-10);
  const name = turkishUpperCase(stringSetting(settings, ["gonderici_adi", "ptt.gonderici_adi", "sender_name"], "GARANTI KULUCKA"));
  const address = turkishUpperCase(stringSetting(settings, ["gonderici_adres", "ptt.gonderici_adres", "sender_address"]));
  const city = turkishUpperCase(stringSetting(settings, ["gonderici_il", "ptt.gonderici_il", "sender_city"]));
  const district = turkishUpperCase(stringSetting(settings, ["gonderici_ilce", "ptt.gonderici_ilce", "sender_district"]));

  return `<xsd:gondericibilgi>
            <xsd:gonderici_adi>${escapeXml(name)}</xsd:gonderici_adi>
            <xsd:gonderici_adresi>${escapeXml(address)}</xsd:gonderici_adresi>
            ${city ? `<xsd:gonderici_il_ad>${escapeXml(city)}</xsd:gonderici_il_ad>` : ""}
            ${district ? `<xsd:gonderici_ilce_ad>${escapeXml(district)}</xsd:gonderici_ilce_ad>` : ""}
            ${phone ? `<xsd:gonderici_sms>${phone}</xsd:gonderici_sms>` : ""}
            ${phone ? `<xsd:gonderici_telefonu>${phone}</xsd:gonderici_telefonu>` : ""}
            <xsd:gonderici_ulke_id>052</xsd:gonderici_ulke_id>
          </xsd:gondericibilgi>`;
}

function parseSoapTagText(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`(?:\\w+:)?${tagName}[^>]*>([^<]*)<`, "i"));
  return match ? match[1]?.trim() ?? null : null;
}

function parseSoapTagInt(xml: string, tagName: string): number | null {
  const value = parseSoapTagText(xml, tagName);
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSoapTagIntAll(xml: string, tagName: string): number[] {
  const values: number[] = [];
  const regex = new RegExp(`(?:\\w+:)?${tagName}[^>]*>(-?\\d+)<`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(parsed)) {
      values.push(parsed);
    }
  }
  return values;
}

function createXmlBody(envelope: ProviderRequestEnvelope, settings: Record<string, unknown>, now: Date): string {
  const payload = envelope.payload;
  const customerId = stringSetting(settings, ["musteri_no", "ptt.musteri_no", "customer_id"]);
  const password = stringSetting(settings, ["sifre", "ptt.sifre", "password"]);
  const postalAccount = stringSetting(settings, ["posta_ceki", "ptt.posta_ceki", "postal_account"], "11876293");
  const fileName = payloadString(payload, ["dosyaAdi", "dosya_adi", "file_name"], `GND-${customerId}-${now.getTime()}`);
  const referenceNo = payloadString(
    payload,
    ["musteriReferansNo", "musteri_referans_no", "reference_number"],
    `REF-${now.getTime()}-${String(now.getTime()).slice(-6)}`,
  );
  const barcode = payloadString(payload, ["barkodNo", "barkod_no", "barcode"], "");
  const barcodeRange = stringSetting(settings, ["barkod_araligi", "ptt.barkod_araligi", "barcode_range"]);
  const barcodeSequence = payloadString(payload, ["barkodSira", "barkod_sira", "barcode_sequence"], "");
  const barcodeNo = barcode || (barcodeRange && barcodeSequence ? buildPttBarcode(barcodeRange, barcodeSequence) : "");
  const phone = payloadString(payload, ["aliciTelefon", "recipient_phone"], "")
    .replace(/[^0-9]/g, "")
    .replace(/^0/, "")
    .slice(-10);
  let extraService = "";
  if (payload.sigortali === true) {
    extraService += "DK";
  }
  const cashOnDelivery = payload.kapidaOdeme === true;
  const receiverPays =
    payload.ucretAlicidan === true ||
    payload.odemeTipi === "alici" ||
    payload.odemeTipi === "ALICI_ODER";
  if (cashOnDelivery) {
    extraService += "OS";
  } else if (receiverPays) {
    extraService += "UA";
  }
  let paymentType = "MH";
  if (receiverPays && !cashOnDelivery) {
    paymentType = "UA";
  }
  if (payload.odemeTipi === "NAKIT") {
    paymentType = "N";
  }

  const recipientCity = turkishUpperCase(payloadString(payload, ["aliciIl", "recipient_city"], "ISTANBUL"));
  const recipientDistrict = turkishUpperCase(payloadString(payload, ["aliciIlce", "recipient_district"]));
  const recipientName = turkishUpperCase(payloadString(payload, ["aliciAdi", "recipient_name"], "ALICI"));
  const recipientAddress = turkishUpperCase(payloadString(payload, ["aliciAdres", "recipient_address"], "ADRES"));

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:kab="http://kabul.ptt.gov.tr" xmlns:xsd="http://kabul.ptt.gov.tr/xsd">
  <soap:Header/>
  <soap:Body>
    <kab:kabulEkle2>
      <kab:input>
        <xsd:dongu>
          <xsd:aAdres>${escapeXml(recipientAddress)}</xsd:aAdres>
          ${payloadString(payload, ["aliciIlKodu", "recipient_city_code"]) ? `<xsd:aIlKodu>${payloadString(payload, ["aliciIlKodu", "recipient_city_code"])}</xsd:aIlKodu>` : ""}
          ${payloadString(payload, ["aliciIlceKodu", "recipient_district_code"]) ? `<xsd:aIlceKodu>${payloadString(payload, ["aliciIlceKodu", "recipient_district_code"])}</xsd:aIlceKodu>` : ""}
          <xsd:agirlik>${Math.ceil(payloadNumber(payload, ["agirlik", "weight_kg"], 1) * 1000)}</xsd:agirlik>
          <xsd:aliciAdi>${escapeXml(recipientName)}</xsd:aliciAdi>
          ${payloadString(payload, ["aliciEmail", "recipient_email"]) ? `<xsd:aliciEmail>${payloadString(payload, ["aliciEmail", "recipient_email"])}</xsd:aliciEmail>` : ""}
          <xsd:aliciIlAdi>${escapeXml(recipientCity)}</xsd:aliciIlAdi>
          <xsd:aliciIlceAdi>${escapeXml(recipientDistrict)}</xsd:aliciIlceAdi>
          <xsd:aliciSms>${phone}</xsd:aliciSms>
          ${phone ? `<xsd:aliciTel>${phone}</xsd:aliciTel>` : ""}
          ${barcodeNo ? `<xsd:barkodNo>${barcodeNo}</xsd:barkodNo>` : ""}
          ${payloadString(payload, ["boy", "length"]) ? `<xsd:boy>${payloadString(payload, ["boy", "length"])}</xsd:boy>` : ""}
          ${payloadString(payload, ["degerUcreti", "declared_value"]) ? `<xsd:deger_ucreti>${payloadString(payload, ["degerUcreti", "declared_value"])}</xsd:deger_ucreti>` : ""}
          <xsd:desi>${payloadNumber(payload, ["desi", "volumetric_weight"], 1)}</xsd:desi>
          ${extraService ? `<xsd:ekhizmet>${extraService}</xsd:ekhizmet>` : ""}
          ${payloadString(payload, ["en", "width"]) ? `<xsd:en>${payloadString(payload, ["en", "width"])}</xsd:en>` : ""}
          ${senderXml(settings)}
          <xsd:musteriReferansNo>${referenceNo}</xsd:musteriReferansNo>
          ${payloadString(payload, ["kapidaOdemeTutar", "cash_on_delivery_amount"]) ? `<xsd:odeme_sart_ucreti>${payloadString(payload, ["kapidaOdemeTutar", "cash_on_delivery_amount"])}</xsd:odeme_sart_ucreti>` : ""}
          <xsd:odemesekli>${paymentType}</xsd:odemesekli>
          ${postalAccount ? `<xsd:rezerve1>${postalAccount}</xsd:rezerve1>` : ""}
          <xsd:ucret>0</xsd:ucret>
          ${payloadString(payload, ["yukseklik", "height"]) ? `<xsd:yukseklik>${payloadString(payload, ["yukseklik", "height"])}</xsd:yukseklik>` : ""}
        </xsd:dongu>
        <xsd:dosyaAdi>${fileName}</xsd:dosyaAdi>
        <xsd:gonderiTip>NORMAL</xsd:gonderiTip>
        <xsd:gonderiTur>KARGO</xsd:gonderiTur>
        <xsd:kullanici>PttWs</xsd:kullanici>
        <xsd:musteriId>${customerId}</xsd:musteriId>
        <xsd:sifre>${password}</xsd:sifre>
      </kab:input>
    </kab:kabulEkle2>
  </soap:Body>
</soap:Envelope>`;
}

function trackXmlBody(envelope: ProviderRequestEnvelope, settings: Record<string, unknown>, method: string): string {
  const trackingNumber = payloadString(envelope.payload, ["tracking_number", "takipNo", "barkod"]);
  const customerId = stringSetting(settings, ["musteri_no", "ptt.musteri_no", "customer_id"]);
  const password = stringSetting(settings, ["sifre", "ptt.sifre", "password"]);

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tak="http://takip.ptt.gov.tr">
  <soap:Header/>
  <soap:Body>
    <tak:${method}>
      <tak:input>
        <barkod>${trackingNumber}</barkod>
        <kullanici>${customerId}</kullanici>
        <sifre>${password}</sifre>
      </tak:input>
    </tak:${method}>
  </soap:Body>
</soap:Envelope>`;
}

function parseCreateResponse(xml: string, now: Date): Record<string, unknown> | null {
  const hasFault = /(?:\w+:)?Fault/i.test(xml);
  const errorCode = parseSoapTagInt(xml, "hataKodu");
  const explanation = parseSoapTagText(xml, "aciklama");
  const loopErrorCodes = parseSoapTagIntAll(xml, "donguHataKodu");
  const loopSuccessful = loopErrorCodes.length === 0 || loopErrorCodes.every((code) => code === 1);
  const successful = !hasFault && errorCode === 1 && loopSuccessful;
  if (!successful) {
    return null;
  }

  const barcodeMatch =
    xml.match(/<(?:\w+:)?barkod[^>]*>(\d{10,20})<\//i) ||
    xml.match(/<(?:\w+:)?barkod[^>]*>(\d+)<\//i) ||
    xml.match(/barkod[^>]*>(\d+)<\//i);
  const barcode = barcodeMatch ? barcodeMatch[1]?.trim() : null;

  return {
    success: true,
    takipNo: barcode || `PTT-${now.getTime()}`,
    barkodNo: barcode || `PTT-${now.getTime()}`,
    providerAciklama: explanation,
    barkodParseFailed: !barcode,
    ucret: 0,
  };
}

function parseTrackResponse(xml: string, fallbackBarcode: string): Record<string, unknown> | null {
  const parsed = parsePttTrackResult(xml, fallbackBarcode);
  if (parsed.hasFault) {
    return null;
  }

  const successful =
    parsed.sonucKodu === 0 ||
    parsed.sonucAciklama.toLowerCase().includes("basarili") ||
    parsed.sonucAciklama.toLocaleLowerCase("tr-TR").includes("başarılı");

  if (!successful) {
    return null;
  }

  const durum = calculatePttStatus(parsed.teslimAlan, parsed.hareketler);
  return {
    success: true,
    barkodNo: parsed.barkodNo,
    kabulMerkezi: parsed.kabulMerkezi,
    varisMerkezi: parsed.varisMerkezi,
    teslimAlan: parsed.teslimAlan,
    alici: parsed.alici,
    gonderen: parsed.gonderen,
    agirlikGram: parsed.agirlikGram,
    ucret: parsed.ucret,
    ekHizmet: parsed.ekHizmet,
    odemeSartliUcret: parsed.odemeSartliUcret,
    kabulTarihi: parsed.kabulTarihi,
    dosyaAdi: parsed.dosyaAdi,
    referansNo: parsed.referansNo,
    durum,
    shipment_status: canonicalShipmentStatus(durum),
    hareketler: parsed.hareketler,
    providerSonucKodu: parsed.sonucKodu,
    providerSonucAciklama: parsed.sonucAciklama || null,
  };
}

function parsePttTrackResult(xml: string, fallbackBarcode = ""): PttTrackParseResult {
  const hareketler: PttMovement[] = [];
  const safahatRegex = /<(?:\w+:)?(?:dongu|safahatlar|GonderiSafahat|array|OutputArrayEn)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:dongu|safahatlar|GonderiSafahat|array|OutputArrayEn)>/gi;
  let safahatMatch: RegExpExecArray | null;
  while ((safahatMatch = safahatRegex.exec(xml)) !== null) {
    const itemXml = safahatMatch[1] ?? "";
    const innerRegex = /<(?:\w+:)?(?:GonderiSafahat|OutputArrayEn)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:GonderiSafahat|OutputArrayEn)>/gi;
    let innerMatch: RegExpExecArray | null;
    let foundInner = false;
    while ((innerMatch = innerRegex.exec(itemXml)) !== null) {
      foundInner = true;
      pushMovement(hareketler, innerMatch[1] ?? "");
    }
    if (!foundInner) {
      pushMovement(hareketler, itemXml);
    }
  }

  return {
    hasFault: /(?:\w+:)?Fault/i.test(xml),
    sonucKodu: parseSoapTagInt(xml, "sonucKodu") ?? parseSoapTagInt(xml, "resultCode"),
    sonucAciklama:
      parseSoapTagText(xml, "sonucAciklama") ||
      parseSoapTagText(xml, "resultExplanation") ||
      "",
    barkodNo:
      parseSoapTagText(xml, "BARNO") ||
      parseSoapTagText(xml, "barcodeNumber") ||
      fallbackBarcode,
    kabulMerkezi:
      parseSoapTagText(xml, "IMERK") ||
      parseSoapTagText(xml, "transactionCenter") ||
      "",
    varisMerkezi:
      parseSoapTagText(xml, "VMERK") ||
      parseSoapTagText(xml, "destinationCenter") ||
      "",
    teslimAlan: parseSoapTagText(xml, "TESALAN") || parseSoapTagText(xml, "recipient") || "",
    alici: parseSoapTagText(xml, "ALICI") || parseSoapTagText(xml, "addressee") || "",
    gonderen: parseSoapTagText(xml, "GONDEREN") || parseSoapTagText(xml, "sender") || "",
    agirlikGram: parseSoapTagText(xml, "GR") || parseSoapTagText(xml, "gr") || "",
    ucret: parseSoapTagText(xml, "GONUCR") || parseSoapTagText(xml, "postagePaid") || "",
    ekHizmet: parseSoapTagText(xml, "EKHIZ") || parseSoapTagText(xml, "additionalService") || "",
    odemeSartliUcret:
      parseSoapTagText(xml, "ODSARUCR") ||
      parseSoapTagText(xml, "priceOfCashOnDelivery") ||
      "",
    kabulTarihi: parseSoapTagText(xml, "ITARIH") || parseSoapTagText(xml, "transactionDate") || "",
    dosyaAdi: parseSoapTagText(xml, "reserve1") || "",
    referansNo: parseSoapTagText(xml, "reserve2") || "",
    hareketler,
  };
}

function pushMovement(hareketler: PttMovement[], xml: string): void {
  const islem =
    parseSoapTagText(xml, "ISLEM") ||
    parseSoapTagText(xml, "transaction") ||
    "";
  const merkez =
    parseSoapTagText(xml, "IMERK") ||
    parseSoapTagText(xml, "transactionCenter") ||
    "";
  const tarih =
    parseSoapTagText(xml, "ITARIH") ||
    parseSoapTagText(xml, "transactionDate") ||
    "";
  const saat =
    parseSoapTagText(xml, "ISAAT") ||
    parseSoapTagText(xml, "transactionTime") ||
    "";
  if (islem || tarih || merkez) {
    hareketler.push({ islem, merkez, tarih, saat });
  }
}

function calculatePttStatus(teslimAlan: string, hareketler: PttMovement[]): string {
  if (teslimAlan) return "TESLIM_EDILDI";
  if (hareketler.length === 0) return "BILINMIYOR";

  const lastOperation = String(hareketler[hareketler.length - 1]?.islem || "").toUpperCase();

  if (lastOperation.includes("TESLIM")) return "TESLIM_EDILDI";

  if (
    lastOperation.includes("ADRESTE YOK") ||
    lastOperation.includes("HABER KAĞIDI") ||
    lastOperation.includes("HABER KAGIDI") ||
    lastOperation.includes("ADRESTEN AYRILMIŞ") ||
    lastOperation.includes("ADRESTEN AYRILMIS") ||
    lastOperation.includes("TAŞINMIŞ") ||
    lastOperation.includes("TASINMIS") ||
    lastOperation.includes("KABUL EDİLMEDİ") ||
    lastOperation.includes("KABUL EDILMEDI") ||
    lastOperation.includes("İŞYERİNDE BEKLİYOR") ||
    lastOperation.includes("ISYERINDE BEKLIYOR") ||
    lastOperation.includes("DAĞITIMDAN İADE") ||
    lastOperation.includes("DAGITIMDAN IADE") ||
    lastOperation.includes("ALICI BULUNAMADI") ||
    lastOperation.includes("KAPIDA ALINAMADI") ||
    lastOperation.includes("MÜRACAAT") ||
    lastOperation.includes("MURACAAT")
  ) {
    return "ALICI_ULASILAMADI";
  }

  if (lastOperation.includes("İADE") || lastOperation.includes("IADE")) return "IADE";
  if (lastOperation.includes("DAGITIM") || lastOperation.includes("DAĞITIM")) return "DAGITIMDA";
  if (lastOperation.includes("TRANSFER") || lastOperation.includes("YOLDA")) return "TRANSFER";
  if (lastOperation.includes("KABUL")) return "KABUL_EDILDI";

  return "ISLEMDE";
}

function canonicalShipmentStatus(durum: string): string | null {
  const statusMap: Record<string, string> = {
    TESLIM_EDILDI: "teslim_edildi",
    DAGITIMDA: "dagitimda",
    ALICI_ULASILAMADI: "dagitimda",
    IADE: "dagitimda",
    TRANSFER: "kargoya_verildi",
    KABUL_EDILDI: "kargoya_verildi",
    ISLEMDE: "kargoya_verildi",
    OLUSTURULDU: "olusturuldu",
  };

  return statusMap[durum] ?? null;
}

function requestFor(
  envelope: ProviderRequestEnvelope,
  accountConfig: ProviderAccountConfig,
  policy: LiveProviderTransportPolicy,
  now: Date,
  method = "gonderiSorgu2",
): PttTransportRequest {
  const settings = accountConfig.settings;
  if (envelope.operation === "shipment.create") {
    return {
      method: "POST",
      url: stringSetting(settings, ["veri_yukleme_url", "ptt.veri_yukleme_url"], defaultVeriYuklemeUrl),
      headers: {
        "Content-Type": 'application/soap+xml; charset=utf-8; action="kabulEkle2"',
        "User-Agent": "GarantiPanel/1.0",
      },
      body: createXmlBody(envelope, settings, now),
      timeout_ms: policy.timeout_ms,
      ptt_method: "kabulEkle2",
    };
  }

  return {
    method: "POST",
    url: stringSetting(settings, ["gonderi_takip_url", "ptt.gonderi_takip_url"], defaultGonderiTakipUrl),
    headers: {
      "Content-Type": `application/soap+xml; charset=utf-8; action="${method}"`,
    },
    body: trackXmlBody(envelope, settings, method),
    timeout_ms: policy.timeout_ms,
    ptt_method: method,
  };
}

function redactRequest(request: PttTransportRequest): Record<string, unknown> {
  const url = new URL(request.url);
  return {
    method: request.method,
    ptt_method: request.ptt_method,
    origin: url.origin,
    path: `${url.pathname}${url.search}`,
    headers: request.headers,
    body_bytes: Buffer.byteLength(request.body, "utf8"),
    body: request.body
      .replace(/<xsd:sifre>[\s\S]*?<\/xsd:sifre>/g, "<xsd:sifre>[redacted]</xsd:sifre>")
      .replace(/<sifre>[\s\S]*?<\/sifre>/g, "<sifre>[redacted]</sifre>")
      .replace(/<xsd:musteriId>[\s\S]*?<\/xsd:musteriId>/g, "<xsd:musteriId>[redacted]</xsd:musteriId>")
      .replace(/<kullanici>[\s\S]*?<\/kullanici>/g, "<kullanici>[redacted]</kullanici>"),
  };
}

function retryMetadata(decision: ProviderRetryDecision): Record<string, unknown> {
  return {
    reason: decision.reason,
    attempts_remaining: decision.attempts_remaining,
    retry_delay_ms: decision.retry_delay_ms,
    error_retryable: decision.error_retryable,
  };
}

function createAttempt(input: {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  startedAt: Date;
  endedAt: Date;
  statusCode: number | null;
  status: ProviderAttempt["status"];
  retryDecision: ProviderAttempt["retry_decision"];
  nextRetryAt: string | null;
  request: PttTransportRequest;
  requests?: PttTransportRequest[];
  methodTried?: string[];
  response: Record<string, unknown>;
  error: ProviderAttempt["error"];
  retry?: Record<string, unknown>;
}): ProviderAttempt {
  return providerAttemptSchema.parse({
    provider: input.envelope.provider,
    operation: input.envelope.operation,
    direction: input.envelope.direction,
    request_id: input.envelope.request_id,
    account_public_id: input.envelope.account_public_id,
    started_at: input.startedAt.toISOString(),
    duration_ms: Math.max(0, input.endedAt.getTime() - input.startedAt.getTime()),
    status: input.status,
    status_code: input.statusCode,
    retry_decision: input.retryDecision,
    next_retry_at: input.nextRetryAt,
    idempotency_key:
      typeof input.envelope.payload.idempotency_key === "string"
        ? input.envelope.payload.idempotency_key
        : null,
    request_metadata: {
      queue: input.job.queue,
      job_id: input.job.job_id,
      channel: input.envelope.channel,
      live_call_performed: true,
      transport: "ptt-soap",
      request: {
        ...redactRequest(input.request),
        ...(input.methodTried ? { method_tried: input.methodTried } : {}),
        ...(input.requests ? { attempts: input.requests.map((request) => redactRequest(request)) } : {}),
      },
      ...(input.retry ? { retry: input.retry } : {}),
    },
    response_metadata: input.response,
    error: input.error,
  });
}

export async function defaultPttFetchTransport(request: PttTransportRequest): Promise<PttTransportResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeout_ms);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    const headers = Object.fromEntries(response.headers.entries());
    return {
      status: response.status,
      headers,
      body: await response.text(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(`PTT request timed out after ${request.timeout_ms}ms`);
      Object.assign(timeoutError, { code: "timeout" });
      throw timeoutError;
    }
    const networkError = error instanceof Error ? error : new Error("PTT network error");
    Object.assign(networkError, { code: "network_error" });
    throw networkError;
  } finally {
    clearTimeout(timeout);
  }
}

function failureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "network_error";
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "PTT transport failed";
}

function createResponseMetadata(
  response: PttTransportResponse,
  calls: PttCallRecord[] = [],
): Record<string, unknown> {
  return {
    live_call_performed: true,
    accepted: response.status >= 200 && response.status < 300,
    status_code: response.status,
    headers: response.headers,
    body_bytes: Buffer.byteLength(response.body, "utf8"),
    body_preview: response.body.slice(0, 800),
    ...(calls.length > 1
      ? {
          calls: calls.map((call) => ({
            ptt_method: call.request.ptt_method,
            status_code: call.response.status,
            body_bytes: Buffer.byteLength(call.response.body, "utf8"),
            body_preview: call.response.body.slice(0, 800),
            soap_fault: parsePttTrackResult(call.response.body).hasFault,
          })),
        }
      : {}),
  };
}

export async function sendPttLiveRequest(input: PttLiveAdapterInput): Promise<PttLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  const now = () => (input.now ? new Date(input.now) : new Date());
  const transport = input.transport ?? defaultPttFetchTransport;
  const trackMethods = input.envelope.operation === "shipment.track"
    ? ["gonderiSorgu2", "gonderiSorgu"]
    : ["kabulEkle2"];
  const trackingNumber = payloadString(input.envelope.payload, ["tracking_number", "takipNo", "barkod"]);
  const calls: PttCallRecord[] = [];
  const requests: PttTransportRequest[] = [];
  const methodTried: string[] = [];
  let request = requestFor(
    input.envelope,
    input.accountConfig,
    input.policy,
    startedAt,
    trackMethods[0],
  );
  let response: PttTransportResponse | null = null;
  let payload: Record<string, unknown> | null = null;

  for (const method of trackMethods) {
    request = requestFor(input.envelope, input.accountConfig, input.policy, startedAt, method);
    requests.push(request);
    methodTried.push(method);

    try {
      response = await transport(request);
    } catch (error) {
      const endedAt = now();
      const decision = decideProviderRetry(
        {
          operation: input.envelope.operation,
          error_code: failureCode(error),
          attempt_number: input.attemptNumber,
          max_attempts: input.maxAttempts,
          idempotency_key:
            typeof input.envelope.payload.idempotency_key === "string"
              ? input.envelope.payload.idempotency_key
              : null,
        },
        endedAt,
      );
      const attempt = createAttempt({
        envelope: input.envelope,
        job: input.job,
        startedAt,
        endedAt,
        statusCode: null,
        status: decision.status,
        retryDecision: decision.retry_decision,
        nextRetryAt: decision.next_retry_at,
        request,
        requests,
        methodTried,
        response: {
          live_call_performed: true,
          accepted: false,
        },
        error: {
          code: failureCode(error),
          message: failureMessage(error),
        },
        retry: retryMetadata(decision),
      });
      throw new PttLiveTransportError(failureMessage(error), attempt);
    }

    calls.push({ request, response });

    const endedAt = now();
    const responseMetadata = createResponseMetadata(response, calls);

    if (response.status === 429 || response.status >= 500) {
      const decision = decideProviderRetry(
        {
          operation: input.envelope.operation,
          status_code: response.status,
          attempt_number: input.attemptNumber,
          max_attempts: input.maxAttempts,
          idempotency_key:
            typeof input.envelope.payload.idempotency_key === "string"
              ? input.envelope.payload.idempotency_key
              : null,
        },
        endedAt,
      );
      const attempt = createAttempt({
        envelope: input.envelope,
        job: input.job,
        startedAt,
        endedAt,
        statusCode: response.status,
        status: decision.status,
        retryDecision: decision.retry_decision,
        nextRetryAt: decision.next_retry_at,
        request,
        requests,
        methodTried,
        response: responseMetadata,
        error: {
          code: "provider_http_error",
          message: `PTT returned HTTP ${response.status}`,
        },
        retry: retryMetadata(decision),
      });
      throw new PttLiveTransportError(`PTT returned HTTP ${response.status}`, attempt);
    }

    payload =
      input.envelope.operation === "shipment.create"
        ? parseCreateResponse(response.body, endedAt)
        : parseTrackResponse(response.body, trackingNumber);

    if (payload || input.envelope.operation !== "shipment.track") {
      break;
    }

    if (!parsePttTrackResult(response.body, trackingNumber).hasFault) {
      break;
    }
  }

  if (!response) {
    throw new Error("PTT transport did not execute");
  }

  const endedAt = now();
  const responseMetadata = createResponseMetadata(response, calls);

  if (!payload) {
    const decision = decideProviderRetry(
      {
        operation: input.envelope.operation,
        status_code: response.status,
        error_code: "malformed_response",
        attempt_number: input.attemptNumber,
        max_attempts: input.maxAttempts,
        idempotency_key:
          typeof input.envelope.payload.idempotency_key === "string"
            ? input.envelope.payload.idempotency_key
            : null,
      },
      endedAt,
    );
    const attempt = createAttempt({
      envelope: input.envelope,
      job: input.job,
      startedAt,
      endedAt,
      statusCode: response.status,
      status: decision.status,
      retryDecision: decision.retry_decision,
      nextRetryAt: decision.next_retry_at,
      request,
      requests,
      methodTried,
      response: responseMetadata,
      error: {
        code: "malformed_response",
        message: "PTT SOAP response could not be normalized",
      },
      retry: retryMetadata(decision),
    });
    throw new PttLiveTransportError("PTT SOAP response could not be normalized", attempt);
  }

  return {
    response_payload: payload,
    attempt: createAttempt({
      envelope: input.envelope,
      job: input.job,
      startedAt,
      endedAt,
      statusCode: response.status,
      status: "success",
      retryDecision: "none",
      nextRetryAt: null,
      request,
      requests,
      methodTried,
      response: responseMetadata,
      error: null,
    }),
  };
}
