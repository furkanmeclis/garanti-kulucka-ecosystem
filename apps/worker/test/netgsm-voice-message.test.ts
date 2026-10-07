import { describe, expect, it } from "vitest";
import type { ProviderOperation, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import {
  NetgsmLiveTransportError,
  parseNetgsmVoiceReport,
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

describe("NetGSM voice messages (legacy sesli-mesaj gonder / rapor)", () => {
  it("sends TTS text to several numbers without keypad handling", async () => {
    const captured: NetgsmTransportRequest[] = [];
    const result = await sendNetgsmLiveRequest(
      input("voice.message.send", { recipients: ["0555 123 45 67", "+90 555 765 43 21"], message: "Kargonuz yola çıktı & yakında elinizde", ringtime: 45 }, returning(captured, { status: 200, headers: {}, body: "00 778899" })),
    );
    expect(captured[0]?.url).toBe("https://netgsm.test/voicesms/send");
    const body = captured[0]?.body ?? "";
    expect(body).toContain("<key>0</key>");
    expect(body).toContain("<ringtime>30</ringtime>");
    expect(body).toContain("<text>Kargonuz yola çıktı &amp; yakında elinizde</text>");
    expect(body.match(/<no>/g)).toHaveLength(2);
    expect(body).not.toContain("<keys>");
    expect(body).not.toContain("<url>");
    expect(result.response_payload).toEqual({ success: true, bulkId: "778899", netgsm_code: "00" });
    expectNoCredentials(result.attempt);
  });

  it("sends an uploaded audio id and maps NetGSM error codes", async () => {
    const captured: NetgsmTransportRequest[] = [];
    await sendNetgsmLiveRequest(input("voice.message.send", { recipients: ["05551234567"], audio_id: "1234" }, returning(captured, { status: 200, headers: {}, body: "01 55" })));
    expect(captured[0]?.body).toContain("<audioid>1234</audioid>");
    const error = await sendNetgsmLiveRequest(input("voice.message.send", { recipients: ["05551234567"], message: "x" }, returning([], { status: 200, headers: {}, body: "45" }))).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetgsmLiveTransportError);
    expect((error as NetgsmLiveTransportError).message).toBe("Telefon numarasi bulunamadi");
    await expect(sendNetgsmLiveRequest(input("voice.message.send", { recipients: [], message: "x" }, returning([], { status: 200, headers: {}, body: "00 1" })))).rejects.toThrow(/recipients/);
  });

  it("reads per-number report rows by bulk id", async () => {
    const captured: NetgsmTransportRequest[] = [];
    const result = await sendNetgsmLiveRequest(
      input("voice.message.report", { bulk_id: "778899" }, returning(captured, { status: 200, headers: {}, body: "778899 05551234567 1 0 18<br>778899 05557654321 3 0 0" })),
    );
    expect(captured[0]?.url).toContain("/voicesms/report?");
    expect(captured[0]?.url).toContain("bulkid=778899");
    expect(result.response_payload).toEqual({
      success: true,
      bulk_id: "778899",
      report_ready: true,
      netgsm_code: null,
      rows: [
        { phone: "05551234567", status: "cevaplandi", pressed_key: null, listen_seconds: 18 },
        { phone: "05557654321", status: "ulasilamadi", pressed_key: null, listen_seconds: 0 },
      ],
    });
  });

  it("parses pipe rows, pending rows and NetGSM report errors", () => {
    expect(parseNetgsmVoiceReport("05551234567|1|TT|12|2")).toEqual({ report_ready: true, netgsm_code: null, rows: [{ phone: "05551234567", status: "cevaplandi", pressed_key: "2", listen_seconds: 12 }] });
    expect(parseNetgsmVoiceReport("1 05551234567 0 0 0")).toMatchObject({ report_ready: false });
    expect(parseNetgsmVoiceReport("40")).toEqual({ report_ready: false, netgsm_code: "40", message: "Kayit bulunamadi", rows: [] });
    expect(parseNetgsmVoiceReport("50")).toMatchObject({ report_ready: false, netgsm_code: "50", rows: [] });
  });
});
