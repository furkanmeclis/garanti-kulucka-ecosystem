import { describe, expect, it, vi } from "vitest";
import {
  assertRecordingUrl,
  downloadRecording,
  previousIstanbulDay,
} from "../../apps/worker/src/call-logs.js";
import {
  sendNetgsmLiveRequest,
  parseNetgsmCdrReport,
  type NetgsmTransportRequest,
} from "../../apps/worker/src/providers/netgsm.js";
import { createWorkerProcessorRegistry } from "../../apps/worker/src/processors.js";
import type {
  JobEnvelope,
  ProviderRequestEnvelope,
} from "@garanti-kulucka/shared";

describe("call log worker with mock HTTP only", () => {
  it("uses the previous Istanbul calendar day across the UTC boundary", () => {
    expect(previousIstanbulDay(new Date("2026-10-17T22:15:00Z"))).toBe(
      "2026-10-17",
    );
    expect(previousIstanbulDay(new Date("2026-10-17T01:00:00Z"))).toBe(
      "2026-10-16",
    );
  });
  it("clamps explicit multi-day and default report windows below 24h and preserves every response field", async () => {
    for (const payload of [
      {},
      { start_date: "2026-10-01", stop_date: "2026-10-17" },
    ]) {
      const captured: NetgsmTransportRequest[] = [];
      const value = {
        date: "17.10.2026 12:01:00",
        source: "101",
        destination: "05551112233",
        duration: "42",
        direction: "0",
        recording: "https://dosyaindir.netgsm.com.tr/fixture.wav",
        line: "8500000000",
        directory: '"Fixture"',
        extra: { keep: true },
      };
      const envelope: ProviderRequestEnvelope = {
        request_id: "req_test",
        provider: "netgsm",
        operation: "call.report",
        direction: "outbound",
        channel: "voice",
        account_public_id: "iac_test",
        occurred_at: "2026-10-17T00:00:00Z",
        payload,
      };
      const job: JobEnvelope = {
        job_id: "job_test",
        queue: "provider-delivery",
        name: "netgsm.call.report",
        requested_at: envelope.occurred_at,
        payload: { envelope },
      };
      const result = await sendNetgsmLiveRequest({
        envelope,
        job,
        accountConfig: {
          provider: "netgsm",
          account_public_id: "iac_test",
          live_mode: true,
          tokens: { usercode: "test-user", password: "test-password" },
          settings: { api_url: "https://netgsm.test" },
        },
        policy: {
          contract_mode: "live",
          live_call_permitted: true,
          reason: "account_live_mode_enabled",
          timeout_ms: 1000,
          max_attempts: 2,
        },
        attemptNumber: 1,
        maxAttempts: 2,
        now: new Date("2026-10-17T12:00:00Z"),
        transport: async (r) => {
          captured.push(r);
          return {
            status: 200,
            headers: {},
            body: JSON.stringify([
              { uniqueid: "unique-test", values: [value] },
            ]),
          };
        },
      });
      const request = JSON.parse(captured[0]!.body);
      expect(request.startdate.slice(0, 8)).toBe(request.stopdate.slice(0, 8));
      expect(request.startdate.slice(8)).toBe("0000");
      expect(request.stopdate.slice(8)).toBe("2359");
      expect(
        (result.response_payload.records as Array<{ raw: unknown }>)[0]?.raw,
      ).toEqual({ ...value, uniqueid: "unique-test" });
    }
    expect(parseNetgsmCdrReport("60")).toMatchObject({ ok: false, code: "60" });
    expect(parseNetgsmCdrReport("40")).toEqual({ ok: true, records: [] });
  });
  it("routes the nightly and archive jobs through the delivery worker", async () => {
    const run = vi.fn(async () => ({ status: "live_mode_disabled" }));
    const registry = createWorkerProcessorRegistry({ callLogJobs: { run } });
    for (const name of [
      "netgsm.call.reconcile",
      "netgsm.call.recording.archive",
    ]) {
      const data: JobEnvelope = {
        job_id: "test",
        queue: "provider-delivery",
        name,
        payload: {},
        requested_at: new Date().toISOString(),
      };
      expect(
        await registry.dispatch("provider-delivery", { name, data }),
      ).toMatchObject({ status: "live_mode_disabled" });
    }
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("downloads bytes using a mock, prohibits redirects/external hosts and rejects non-audio", async () => {
    const transport = vi.fn(
      async () =>
        new Response("RIFFmock", {
          status: 200,
          headers: { "content-type": "audio/wav" },
        }),
    );
    const result = await downloadRecording(
      "https://dosyaindir.netgsm.com.tr/upload.php?q=fixture",
      transport as unknown as typeof fetch,
    );
    expect(result.bytes.toString()).toBe("RIFFmock");
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    for (const url of [
      "http://dosyaindir.netgsm.com.tr/a",
      "https://netgsm.com.tr.evil.test/a",
      "https://localhost/a",
      "https://127.0.0.1/a",
    ])
      expect(() => assertRecordingUrl(url)).toThrow();
    await expect(
      downloadRecording(
        "https://dosyaindir.netgsm.com.tr/a",
        (async () =>
          new Response("<html>", {
            headers: { "content-type": "text/html" },
          })) as typeof fetch,
      ),
    ).rejects.toThrow("not audio");
  });
});
