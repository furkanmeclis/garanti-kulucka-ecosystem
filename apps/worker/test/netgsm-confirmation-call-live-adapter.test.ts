import { describe, expect, it } from "vitest";
import type { ProviderOperation, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import {
  NetgsmLiveTransportError,
  netgsmVoiceDate,
  netgsmVoiceTime,
  parseNetgsmConfirmationReport,
  sendNetgsmLiveRequest,
  type NetgsmFetchTransport,
  type NetgsmTransportRequest,
  type NetgsmTransportResponse,
} from "../src/providers/netgsm.js";

// 2026-10-05 10:30 Europe/Istanbul (UTC+3)
const now = "2026-10-05T07:30:00.000Z";
const smsUsercode = "8508400000";
const smsPassword = "netgsm-sms-password-secret";
const voiceUsercode = "3229110532";
const voicePassword = "netgsm-voice-password-secret";

function input(
  operation: ProviderOperation,
  payload: Record<string, unknown>,
  transport: NetgsmFetchTransport,
  overrides: { settings?: Record<string, unknown>; tokens?: Record<string, unknown> } = {},
) {
  const envelope: ProviderRequestEnvelope = {
    request_id: `req_netgsm_${operation}`,
    provider: "netgsm",
    operation,
    direction: "outbound",
    channel: "voice",
    account_public_id: "iac_netgsm_live",
    occurred_at: now,
    payload,
  };
  return {
    envelope,
    job: {
      job_id: `job_${envelope.request_id}`,
      queue: "provider-delivery" as const,
      name: `netgsm.${operation}`,
      requested_at: now,
      payload: { envelope },
    },
    accountConfig: {
      provider: "netgsm" as const,
      account_public_id: "iac_netgsm_live",
      live_mode: true,
      tokens: {
        sms_usercode: smsUsercode,
        sms_password: smsPassword,
        teyit_voice_usercode: voiceUsercode,
        teyit_voice_password: voicePassword,
        ...overrides.tokens,
      },
      settings: {
        "providers.netgsm.live_mode": true,
        api_url: "https://netgsm.test",
        app_url: "https://panel.example.test",
        ...overrides.settings,
      },
    },
    policy: {
      contract_mode: "live" as const,
      live_call_permitted: true as const,
      reason: "account_live_mode_enabled" as const,
      timeout_ms: 5_000,
      max_attempts: 3,
    },
    attemptNumber: 1,
    maxAttempts: 3,
    transport,
    now: new Date(now),
  };
}

function returning(captured: NetgsmTransportRequest[], response: NetgsmTransportResponse): NetgsmFetchTransport {
  return async (request) => {
    captured.push(request);
    return response;
  };
}

function expectNoCredentials(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of [smsUsercode, smsPassword, voiceUsercode, voicePassword]) {
    expect(serialized).not.toContain(secret);
  }
}

const expectedXml = `<?xml version='1.0' encoding='UTF-8'?>
<mainbody>
  <header>
    <usercode>${voiceUsercode}</usercode>
    <password>${voicePassword}</password>
    <startdate>05102026</startdate>
    <starttime>1031</starttime>
    <stopdate>06102026</stopdate>
    <stoptime>0730</stoptime>
    <key>1</key>
    <ringtime>25</ringtime>
    <url>https://panel.example.test/api/netgsm/webhook/sesli-mesaj</url>
  </header>
  <body>
    <audioid>172812485</audioid>
    <no>05551234567</no>
    <keys>
      <keydetail>
        <keyinfo>9</keyinfo>
        <audioid>149477742</audioid>
      </keydetail>
    </keys>
  </body>
</mainbody>`;

describe("NetGSM order confirmation call (legacy siparis-arama)", () => {
  it("posts the legacy IVR XML to /voicesms/send with the teyit voice account", async () => {
    const captured: NetgsmTransportRequest[] = [];
    const result = await sendNetgsmLiveRequest(
      input("call.confirmation.create", { telefon: "0555 123 45 67", idempotency_key: "teyit-1" }, returning(captured, {
        status: 200,
        headers: {},
        body: "00 778899",
      })),
    );

    expect(captured[0]).toMatchObject({
      method: "POST",
      url: "https://netgsm.test/voicesms/send",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      netgsm_endpoint: "voicesms.send",
    });
    expect(captured[0]?.body).toBe(expectedXml);
    expect(result.response_payload).toEqual({
      success: true,
      call_started: true,
      bulkId: "778899",
      netgsm_code: "00",
      ivr_arama_durumu: "araniyor",
    });
    expect(result.attempt).toMatchObject({
      status: "success",
      operation: "call.confirmation.create",
      request_metadata: { transport: "netgsm-voicesms", request: { netgsm_endpoint: "voicesms.send", recipient_count: 1 } },
    });
    expectNoCredentials(result.attempt);
  });

  it("falls back to SMS credentials and TTS text when audio ids are blanked", async () => {
    const captured: NetgsmTransportRequest[] = [];
    await sendNetgsmLiveRequest(
      input(
        "call.confirmation.create",
        { telefon: "05551234567", idempotency_key: "teyit-2" },
        returning(captured, { status: 200, headers: {}, body: "01 1" }),
        { tokens: { teyit_voice_usercode: "", teyit_voice_password: "" }, settings: { teyit_audio_id: "", iptal_audio_id: "" } },
      ),
    );

    expect(captured[0]?.body).toContain(`<usercode>${smsUsercode}</usercode>`);
    expect(captured[0]?.body).toContain("<text>Sayın müşterimiz, Garanti Kuluçkadan");
    expect(captured[0]?.body).toContain("9&apos;u tuşlayabilirsiniz");
    expect(captured[0]?.body).toContain("<text>Siparişiniz iptal isteği olarak kaydedilmiştir. Teşekkür ederiz.</text>");
  });

  it.each([
    { code: "30", message: "Gecersiz kullanici adi/sifre veya API erisim izni yok" },
    { code: "40", message: "Ses dosyasi bulunamadi" },
    { code: "45", message: "Telefon numarasi bulunamadi" },
    { code: "70", message: "Parametre hatasi" },
  ])("dead-letters NetGSM error code $code", async ({ code, message }) => {
    const error = await sendNetgsmLiveRequest(
      input("call.confirmation.create", { telefon: "05551234567", idempotency_key: `teyit-${code}` }, returning([], {
        status: 200,
        headers: {},
        body: code,
      })),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetgsmLiveTransportError);
    const attempt = (error as NetgsmLiveTransportError).attempt;
    expect(attempt).toMatchObject({ status: "terminal_failure", error: { code: "netgsm_error_code", message } });
    expectNoCredentials(attempt);
  });

  it("never retries a confirmation call without an idempotency key", async () => {
    const error = await sendNetgsmLiveRequest(
      input("call.confirmation.create", { telefon: "05551234567" }, returning([], { status: 503, headers: {}, body: "busy" })),
    ).catch((caught: unknown) => caught);

    expect((error as NetgsmLiveTransportError).attempt).toMatchObject({
      status: "terminal_failure",
      retry_decision: "dead_letter",
      request_metadata: { retry: { reason: "missing_idempotency_key" } },
    });
  });

  it("queries /voicesms/report with type=1 and bulkid and redacts query credentials", async () => {
    const captured: NetgsmTransportRequest[] = [];
    const result = await sendNetgsmLiveRequest(
      input("call.confirmation.status", { bulk_id: "778899" }, returning(captured, {
        status: 200,
        headers: {},
        body: "905551234567|1|Turkcell|12|9<br>",
      })),
    );

    const url = new URL(captured[0]?.url ?? "");
    expect(captured[0]?.method).toBe("GET");
    expect(url.pathname).toBe("/voicesms/report");
    expect([...url.searchParams.entries()]).toEqual([
      ["usercode", voiceUsercode],
      ["password", voicePassword],
      ["type", "1"],
      ["bulkid", "778899"],
    ]);
    expect(result.response_payload).toEqual({
      success: true,
      bulk_id: "778899",
      call_status: "cevaplandi",
      pressed_key: "9",
      listen_seconds: 12,
      confirmation_outcome: "iptal_istegi",
      report_ready: true,
      netgsm_code: null,
    });
    expectNoCredentials(result.attempt);
  });

  it("maps report codes and statuses like the legacy durum endpoint", () => {
    expect(parseNetgsmConfirmationReport("50")).toMatchObject({ call_status: "araniyor", report_ready: false, netgsm_code: "50" });
    expect(parseNetgsmConfirmationReport("40")).toMatchObject({ call_status: "araniyor", netgsm_code: "40", message: "Kayit bulunamadi" });
    expect(parseNetgsmConfirmationReport("905551234567|1|Vodafone|20|")).toMatchObject({ call_status: "cevaplandi", confirmation_outcome: "teyit_edildi" });
    expect(parseNetgsmConfirmationReport("905551234567|2|Vodafone|0|")).toMatchObject({ call_status: "cevaplanmadi", confirmation_outcome: "ulasilamadi" });
    expect(parseNetgsmConfirmationReport("905551234567|6|Vodafone|0|")).toMatchObject({ confirmation_outcome: "gecersiz_numara" });
    expect(parseNetgsmConfirmationReport("905551234567|0|Vodafone|0|")).toMatchObject({ call_status: "araniyor", confirmation_outcome: null });
  });

  it("formats legacy ddMMyyyy / HHmm in Europe/Istanbul", () => {
    const date = new Date("2026-12-31T21:59:00.000Z");
    expect(netgsmVoiceDate(date)).toBe("01012027");
    expect(netgsmVoiceTime(date, 1)).toBe("0100");
  });
});
