import type { AppDatabase } from "@garanti-kulucka/database";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => ({
  repository: {
    createToken: vi.fn(async (email: string): Promise<{ token: string; publicId: string; email: string; firstName: string | null } | null> =>
      email === "ayse@example.com" ? { token: "tok_abcdefghijklmnopqrstuvwxyz", publicId: "prt_1", email: "ayse@example.com", firstName: "Ayşe" } : null,
    ),
    consume: vi.fn(async (token: string) => token === "tok_abcdefghijklmnopqrstuvwxyz"),
  },
}));

vi.mock("../src/auth/password-reset-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/password-reset-repository.js")>()),
  PasswordResetRepository: vi.fn(function PasswordResetRepository() {
    return mocks.repository;
  }),
}));

const { createApp } = await import("../src/app.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "password-reset-route-test-secret",
  encryptionKey: "password-reset-route-encryption",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: "https://panel.example.com,https://beta.example.com",
};

const jobs: JobEnvelope[] = [];
let ip = 0;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  ip += 1;
  return createApp({ config, db: {} as AppDatabase, providerDeliveryQueuePublisher: { publish: async (job) => (jobs.push(job), job.job_id) } }).request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${ip}`, ...headers },
    body: JSON.stringify(body),
  });
}

describe("password reset routes (legacy ResetPasswordPage)", () => {
  beforeEach(() => {
    jobs.length = 0;
    vi.clearAllMocks();
  });

  it("queues the reset e-mail for a known user with a link to the requesting panel", async () => {
    const response = await post("/auth/password-reset/request", { email: " ayse@example.com " }, { origin: "https://beta.example.com" });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(mocks.repository.createToken).toHaveBeenCalledWith("ayse@example.com", expect.any(String));
    expect(jobs[0]).toMatchObject({ name: "smtp.email.send", payload: { envelope: { provider: "smtp", operation: "email.send", channel: "email", payload: { to: "ayse@example.com", template: "password_reset", idempotency_key: "password_reset:prt_1" } } } });
    const mail = (jobs[0]?.payload as { envelope: { payload: { text: string } } }).envelope.payload.text;
    expect(mail).toContain("https://beta.example.com/sifre-sifirla?token=tok_abcdefghijklmnopqrstuvwxyz");
    expect(mail).toContain("Merhaba Ayşe,");
  });

  it("answers the same for unknown e-mails and falls back to the first panel origin", async () => {
    const unknown = await post("/auth/password-reset/request", { email: "nobody@example.com" });
    expect(unknown.status).toBe(202);
    expect(jobs).toHaveLength(0);
    await post("/auth/password-reset/request", { email: "ayse@example.com" }, { origin: "https://evil.example.org" });
    expect((jobs[0]?.payload as { envelope: { payload: { text: string } } }).envelope.payload.text).toContain("https://panel.example.com/sifre-sifirla?token=");
    expect((await post("/auth/password-reset/request", { email: "not-an-email" })).status).toBe(400);
  });

  it("confirms with a valid token and rejects invalid ones", async () => {
    const ok = await post("/auth/password-reset/confirm", { token: "tok_abcdefghijklmnopqrstuvwxyz", password: "yeni-sifre" });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ reset: true });
    const bad = await post("/auth/password-reset/confirm", { token: "tok_zzzzzzzzzzzzzzzzzzzzzzzz", password: "yeni-sifre" });
    expect(bad.status).toBe(400);
    await expect(bad.json()).resolves.toMatchObject({ error: { code: "invalid_token" } });
    expect((await post("/auth/password-reset/confirm", { token: "tok_abcdefghijklmnopqrstuvwxyz", password: "123" })).status).toBe(400);
  });
});
