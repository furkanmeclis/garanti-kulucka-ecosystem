import { describe, expect, it } from "vitest";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { SmtpLiveTransportError, sendSmtpLiveRequest, type SmtpConnection, type SmtpMessage } from "../src/providers/smtp.js";

const now = "2026-10-07T09:00:00.000Z";

function input(payload: Record<string, unknown>, settings: Record<string, unknown>, transport: (connection: SmtpConnection, message: SmtpMessage) => Promise<{ message_id: string | null; accepted: string[]; rejected: string[] }>) {
  const envelope: ProviderRequestEnvelope = {
    request_id: "req_smtp_1",
    provider: "smtp",
    operation: "email.send",
    direction: "outbound",
    channel: "email",
    account_public_id: "iac_smtp",
    occurred_at: now,
    payload,
  };
  return {
    envelope,
    job: { job_id: "job_smtp_1", queue: "provider-delivery" as const, name: "smtp.email.send", requested_at: now, payload: { envelope } },
    accountConfig: { provider: "smtp" as const, account_public_id: "iac_smtp", live_mode: true, settings, tokens: { password: "smtp-secret-pass" } },
    policy: { contract_mode: "live" as const, live_call_permitted: true as const, reason: "account_live_mode_enabled" as const, timeout_ms: 5_000, max_attempts: 3 },
    attemptNumber: 1,
    maxAttempts: 3,
    transport,
    now: new Date(now),
  };
}

const settings = { host: "smtp.example.com", port: "465", from_address: "no-reply@example.com", from_name: "Garanti Kuluçka", username: "mailer" };

describe("SMTP live adapter", () => {
  it("sends the e-mail and keeps the body and password out of the attempt", async () => {
    const sent: Array<{ connection: SmtpConnection; message: SmtpMessage }> = [];
    const result = await sendSmtpLiveRequest(
      input({ to: "ayse@example.com", subject: "Şifre sıfırlama", text: "link https://x/sifre-sifirla?token=secret-token", template: "password_reset", idempotency_key: "pr_1" }, settings, async (connection, message) => {
        sent.push({ connection, message });
        return { message_id: "<m1@example.com>", accepted: ["ayse@example.com"], rejected: [] };
      }),
    );
    expect(sent[0]?.connection).toMatchObject({ host: "smtp.example.com", port: 465, secure: true, username: "mailer", password: "smtp-secret-pass" });
    expect(sent[0]?.message).toMatchObject({ from: '"Garanti Kuluçka" <no-reply@example.com>', to: "ayse@example.com", subject: "Şifre sıfırlama" });
    expect(result.response_payload).toEqual({ success: true, message_sent: true, message_id: "<m1@example.com>" });
    expect(result.attempt).toMatchObject({ status: "success", operation: "email.send", request_metadata: { request: { to: "ay***@example.com", template: "password_reset" } } });
    const serialized = JSON.stringify(result.attempt);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("smtp-secret-pass");
    expect(serialized).not.toContain("Şifre sıfırlama");
  });

  it("fails with a provider attempt when the account or recipient is incomplete", async () => {
    const missingHost = await sendSmtpLiveRequest(input({ to: "a@example.com", text: "x" }, { from_address: "n@example.com" }, async () => ({ message_id: null, accepted: [], rejected: [] }))).catch((error: unknown) => error);
    expect(missingHost).toBeInstanceOf(SmtpLiveTransportError);
    expect((missingHost as SmtpLiveTransportError).attempt.error).toMatchObject({ message: "SMTP host is not configured" });

    const rejected = await sendSmtpLiveRequest(input({ to: "a@example.com", text: "x" }, settings, async () => ({ message_id: null, accepted: [], rejected: ["a@example.com"] }))).catch((error: unknown) => error);
    expect((rejected as SmtpLiveTransportError).attempt.error).toMatchObject({ code: "recipient_rejected" });
  });
});
