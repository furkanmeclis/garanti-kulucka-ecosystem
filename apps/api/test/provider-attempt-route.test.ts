import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";
import type { ProviderAttemptRecord } from "../src/integrations/repository.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const providerAttempt: ProviderAttemptRecord = {
    id: 1,
    public_id: "pat_preview",
    provider_id: 1,
    account_id: 2,
    provider_key: "whatsapp",
    account_public_id: "iac_whatsapp",
    request_id: "req_preview",
    operation: "message.send",
    direction: "outbound",
    status: "success",
    status_code: 202,
    duration_ms: 18,
    retry_decision: "none",
    next_retry_at: null,
    idempotency_key: "msg_preview_1",
    request_metadata: {
      dry_run_request: {
        method: "POST",
        path: "/meta/whatsapp/messages",
        headers: {
          authorization: "Bearer plain-token",
        },
        body: {
          message: "Merhaba",
        },
        live_call_performed: false,
      },
    },
    response_metadata: {
      accepted: true,
    },
    error_code: null,
    error_message: null,
    started_at: now,
    created_at: now,
    updated_at: now,
  };

  return {
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_admin",
        role_id: 1,
        email: "admin@example.com",
        password_hash: "hash",
        first_name: "Admin",
        last_name: "User",
        phone: null,
        is_active: true,
        is_online: false,
        last_seen_at: null,
        sip_username: null,
        sip_password_encrypted: null,
        created_at: now,
        updated_at: now,
        role_name: "admin",
      })),
      findSessionByPublicId: vi.fn(async () => ({
        id: 100,
        public_id: "ses_admin",
        user_id: 10,
        user_agent: null,
        ip_address: null,
        expires_at: new Date("2026-02-01T00:00:00.000Z"),
        revoked_at: null,
        created_at: now,
        updated_at: now,
      })),
    },
    integrationRepository: {
      listProviderAttempts: vi.fn(async () => [providerAttempt]),
      getProviderDebugSummary: vi.fn(async () => ({
        providers: [
          {
            provider_key: "surat",
            total_attempts: 1,
            success_count: 0,
            failure_count: 1,
            retry_count: 1,
            average_duration_ms: 1450,
            latest_attempt: {
              ...providerAttempt,
              provider_key: "surat",
              account_public_id: null,
              status: "failed",
              duration_ms: 1450,
              retry_decision: "retry",
              request_metadata: {
                dry_run_request: {
                  method: "POST",
                  path: "/kargo-takip",
                  headers: {
                    authorization: "Bearer plain-surat-token",
                  },
                  body: {
                    takip_no: "TRK-SURAT-TEST",
                    api_key: "plain-surat-key",
                  },
                  live_call_performed: false,
                },
              },
            },
          },
        ],
        cron: {
          provider_keys: ["ptt", "surat"],
          operation: "shipment.track",
          total_attempts: 1,
          success_count: 0,
          failure_count: 1,
          retry_count: 1,
          total_duration_ms: 1450,
          latest_attempt: providerAttempt,
        },
      })),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return routeMocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/integrations/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/integrations/repository.js")>();

  return {
    ...actual,
    IntegrationsRepository: vi.fn(function IntegrationsRepository() {
      return routeMocks.integrationRepository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "provider-attempt-route-test-secret",
  encryptionKey: "provider-attempt-route-encryption",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

async function adminAccessToken() {
  return signAccessToken(
    {
      user_public_id: "usr_admin",
      session_public_id: "ses_admin",
      role: "admin",
    },
    config,
  );
}

describe("provider attempt admin route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes redacted provider request previews in list responses", async () => {
    const token = await adminAccessToken();
    const app = createApp({ config, db: {} as AppDatabase });
    const response = await app.request(
      "/admin/integrations/provider-attempts?provider_key=whatsapp&account_public_id=iac_whatsapp&limit=1",
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(routeMocks.integrationRepository.listProviderAttempts).toHaveBeenCalledWith({
      providerKey: "whatsapp",
      accountPublicId: "iac_whatsapp",
      limit: 1,
    });
    expect(payload.data[0]).toMatchObject({
      provider_key: "whatsapp",
      provider_request_preview: {
        method: "POST",
        path: "/meta/whatsapp/messages",
        headers: {
          authorization: "[redacted]",
        },
        body: {
          message: "Merhaba",
        },
        live_call_performed: false,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("plain-token");
  });

  it("exposes backend-owned provider debug summary metrics with redacted latest attempts", async () => {
    const token = await adminAccessToken();
    const app = createApp({ config, db: {} as AppDatabase });
    const response = await app.request("/admin/integrations/provider-debug-summary", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(routeMocks.integrationRepository.getProviderDebugSummary).toHaveBeenCalledOnce();
    expect(payload.providers[0]).toMatchObject({
      provider_key: "surat",
      total_attempts: 1,
      success_count: 0,
      failure_count: 1,
      retry_count: 1,
      average_duration_ms: 1450,
      latest_attempt: {
        provider_key: "surat",
        provider_request_preview: {
          headers: {
            authorization: "[redacted]",
          },
          body: {
            takip_no: "TRK-SURAT-TEST",
            api_key: "[redacted]",
          },
        },
      },
    });
    expect(payload.cron).toMatchObject({
      provider_keys: ["ptt", "surat"],
      operation: "shipment.track",
      total_attempts: 1,
      failure_count: 1,
      total_duration_ms: 1450,
    });
    expect(JSON.stringify(payload)).not.toContain("plain-surat-token");
    expect(JSON.stringify(payload)).not.toContain("plain-surat-key");
  });
});
