import { describe, expect, it } from "vitest";
import { attemptOutcome, compactJson, countTrainingRecords, requestPreview, type ProviderAttempt } from "../src/lib/debug";

function attempt(overrides: Partial<ProviderAttempt> = {}): ProviderAttempt {
  return {
    public_id: "pa_1", provider_key: "surat", account_public_id: null, request_id: "req_1", operation: "shipment.track", direction: "outbound",
    status: "success", status_code: 200, duration_ms: 120, retry_decision: "none", next_retry_at: null, idempotency_key: null, request_metadata: {},
    provider_request_preview: null, response_metadata: {}, error_code: null, error_message: null, started_at: "2026-10-07T09:00:00.000Z", updated_at: "2026-10-07T09:00:00.000Z",
    ...overrides,
  };
}

describe("debug helpers", () => {
  it("masks sensitive keys at any depth", () => {
    expect(compactJson({ Authorization: "Bearer x", nested: { api_key: "k", password: "p", keep: 1 }, list: [{ token: "t" }] })).toBe(
      '{"Authorization":"[redacted]","nested":{"api_key":"[redacted]","password":"[redacted]","keep":1},"list":[{"token":"[redacted]"}]}',
    );
    expect(compactJson(null)).toBe("-");
    expect(compactJson("plain")).toBe("plain");
  });

  it("classifies attempts like the legacy Sürat debug page", () => {
    expect(attemptOutcome(attempt())).toBe("success");
    expect(attemptOutcome(attempt({ status: "failed" }))).toBe("error");
    expect(attemptOutcome(attempt({ status: "error", retry_decision: "retry" }))).toBe("error");
    expect(attemptOutcome(attempt({ retry_decision: "retried" }))).toBe("recovered");
  });

  it("only shows dry-run request previews", () => {
    expect(requestPreview(attempt({ provider_request_preview: { method: "POST", path: "/kargo-takip", headers: { a: "1", b: 2 }, body: { x: 1 }, live_call_performed: false } }))).toEqual({
      method: "POST",
      path: "/kargo-takip",
      headers: { a: "1" },
      body: { x: 1 },
      live_call_performed: false,
    });
    expect(requestPreview(attempt({ provider_request_preview: { method: "POST", path: "/x", live_call_performed: true } }))).toBeNull();
    expect(requestPreview(attempt())).toBeNull();
  });

  it("counts exported training conversations per format", () => {
    expect(countTrainingRecords("jsonl", '{"a":1}\n{"a":2}\n')).toBe(2);
    expect(countTrainingRecords("json", "[1,2,3]")).toBe(3);
    expect(countTrainingRecords("text", "### Konuşma 1\nx\n### Konuşma 2\ny")).toBe(2);
  });
});
