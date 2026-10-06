import { describe, expect, it } from "vitest";
import type { ProviderOperation, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import {
  NetgsmLiveTransportError,
  netgsmCdrDate,
  parseNetgsmCdrReport,
  sendNetgsmLiveRequest,
  type NetgsmFetchTransport,
  type NetgsmTransportRequest,
} from "../src/providers/netgsm.js";
import { normalizeVapiCallSnapshot, sendVapiLiveRequest, type VapiFetchTransport, type VapiTransportRequest } from "../src/providers/vapi.js";
import { providerAdapters } from "../src/providers/registry.js";

const now = "2026-10-06T07:30:00.000Z";
const apiKey = "vapi-api-key-secret";
const usercode = "8508400000";
const password = "netgsm-cdr-password-secret";

const policy = {
  contract_mode: "live" as const,
  live_call_permitted: true as const,
  reason: "account_live_mode_enabled" as const,
  timeout_ms: 5_000,
  max_attempts: 3,
};

function envelope(provider: "vapi" | "netgsm", operation: ProviderOperation, payload: Record<string, unknown>): ProviderRequestEnvelope {
  return {
    request_id: `req_${provider}_${operation}`,
    provider,
    operation,
    direction: "outbound",
    channel: "voice",
    account_public_id: `iac_${provider}_live`,
    occurred_at: now,
    payload,
  };
}

function job(env: ProviderRequestEnvelope) {
  return {
    job_id: `job_${env.request_id}`,
    queue: "provider-delivery" as const,
    name: `${env.provider}.${env.operation}`,
    requested_at: now,
    payload: { envelope: env },
  };
}

describe("Vapi call.get backfill (legacy GET /call/:id)", () => {
  it("is registered as a vapi delivery operation", () => {
    expect(providerAdapters.find((adapter) => adapter.provider === "vapi")?.delivery_operations).toContain("call.get");
    expect(providerAdapters.find((adapter) => adapter.provider === "netgsm")?.delivery_operations).toContain("call.report");
  });

  it("GETs /call/{id} and stores a normalized snapshot without leaking the API key", async () => {
    const captured: VapiTransportRequest[] = [];
    const transport: VapiFetchTransport = async (request) => {
      captured.push(request);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "call_abc",
          status: "ended",
          startedAt: "2026-10-06T07:00:00.000Z",
          endedAt: "2026-10-06T07:01:30.000Z",
          endedReason: "assistant-ended-call",
          summary: "Müşteri yarın şubeden alacak",
          transcript: "AI: Merhaba",
          cost: 0.08,
        }),
      };
    };
    const env = envelope("vapi", "call.get", { vapi_call_id: "call_abc", call_public_id: "vcl_1" });
    const result = await sendVapiLiveRequest({
      envelope: env,
      job: job(env),
      accountConfig: { provider: "vapi", account_public_id: "iac_vapi_live", live_mode: true, tokens: { api_key: apiKey }, settings: { api_url: "https://vapi.test" } },
      policy,
      attemptNumber: 1,
      maxAttempts: 3,
      transport,
      now: new Date(now),
    });

    expect(captured[0]).toMatchObject({ method: "GET", url: "https://vapi.test/call/call_abc", body: "", vapi_endpoint: "call.get" });
    expect(result.response_payload).toMatchObject({ call_id: "call_abc", call: { ended: true, duration_seconds: 90 } });
    expect(result.attempt).toMatchObject({
      operation: "call.get",
      status: "success",
      response_metadata: {
        vapi_call_id: "call_abc",
        call_snapshot: { ended: true, summary: "Müşteri yarın şubeden alacak", transcript: "AI: Merhaba", duration_seconds: 90, cost: 0.08 },
      },
    });
    expect(JSON.stringify(result.attempt)).not.toContain(apiKey);
  });

  it("normalizes a still-running call as not ended", () => {
    expect(normalizeVapiCallSnapshot({ id: "c", status: "in-progress" })).toMatchObject({ ended: false, duration_seconds: null });
  });
});

describe("NetGSM call.report (legacy /api/netgsm/cdr)", () => {
  function input(transport: NetgsmFetchTransport, payload: Record<string, unknown> = { start_date: "2026-09-29", stop_date: "2026-10-06" }) {
    const env = envelope("netgsm", "call.report", payload);
    return {
      envelope: env,
      job: job(env),
      accountConfig: {
        provider: "netgsm" as const,
        account_public_id: "iac_netgsm_live",
        live_mode: true,
        tokens: { usercode, password },
        settings: { api_url: "https://netgsm.test", "providers.netgsm.live_mode": true },
      },
      policy,
      attemptNumber: 1,
      maxAttempts: 3,
      transport,
      now: new Date(now),
    };
  }

  it("posts the netsantral report body and maps CDR rows like legacy", async () => {
    const captured: NetgsmTransportRequest[] = [];
    const result = await sendNetgsmLiveRequest(
      input(async (request) => {
        captured.push(request);
        return {
          status: 200,
          headers: {},
          body: JSON.stringify([
            {
              uniqueid: "u1",
              values: [
                { date: "06.10.2026 10:00:00", source: "905551112233", destination: "908500000000", duration: "75", direction: 1, recording: "https://rec.test/u1.mp3", directory: '"Ahmet Yilmaz" <905551112233>' },
                { date: "06.10.2026 11:00:00", source: "908500000000", destination: "905550000000", duration: "0", direction: 3 },
              ],
            },
          ]),
        };
      }),
    );

    expect(captured[0]).toMatchObject({ method: "POST", url: "https://netgsm.test/netsantral/report", netgsm_endpoint: "netsantral.report" });
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({ usercode, password, startdate: "290920260000", stopdate: "061020262359" });
    expect(result.response_payload).toMatchObject({ record_count: 2 });
    expect(result.attempt.response_metadata).toMatchObject({
      cdr_record_count: 2,
      cdr_total_seconds: 75,
      cdr_records: [
        { id: "u1", arayanNumara: "905551112233", arayanAdi: "Ahmet", sure: "00:01:15", sureSaniye: 75, yon: "Gelen Arama", yonKod: 1, sesKaydi: "https://rec.test/u1.mp3" },
        { yon: "Giden Cevapsız", yonKod: 3, sesKaydi: null },
      ],
    });
    const serialized = JSON.stringify(result.attempt);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(usercode);
  });

  it("turns legacy NetGSM error codes into a terminal attempt", async () => {
    await expect(sendNetgsmLiveRequest(input(async () => ({ status: 200, headers: {}, body: "30" })))).rejects.toBeInstanceOf(NetgsmLiveTransportError);
    expect(parseNetgsmCdrReport("40")).toEqual({ ok: false, code: "40", message: "Kayıt bulunamadı veya geçersiz santral bilgisi" });
    expect(parseNetgsmCdrReport('{"code":"70","error":"Parametre"}')).toMatchObject({ ok: false, code: "70" });
    expect(netgsmCdrDate("2026-10-06", false)).toBe("061020260000");
  });
});
