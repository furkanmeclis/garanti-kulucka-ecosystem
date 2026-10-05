import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const shipment = {
    id: 1,
    public_id: "shp_slice6",
    order_id: 2,
    customer_id: 3,
    provider: "ptt",
    tracking_number: "TRK-SLICE6",
    barcode_number: "BAR-SLICE6",
    status: "in_transit",
    recipient_name: "Slice Müşteri",
    recipient_phone: "05551234567",
    recipient_address: "Adres",
    recipient_city: "İstanbul",
    recipient_district: "Kadıköy",
    last_event_text: "Accepted at branch",
    shipped_at: now,
    delivered_at: null,
    raw_payload: null,
    created_at: now,
    updated_at: now,
    order_number: "ORD-SLICE6",
    customer_full_name: "Slice Customer",
    tracking_events: [
      {
        id: 11,
        public_id: "ste_slice6",
        shipment_id: 1,
        status: "in_transit",
        description: "Accepted at branch",
        location: "Kadıköy / İstanbul",
        occurred_at: now,
        raw_payload: null,
        created_at: now,
        updated_at: now,
      },
    ],
  };

  return {
    authRepository: {
      findUserByPublicId: vi.fn(async (publicId: string) => ({
        id: 10,
        public_id: publicId,
        role_id: 1,
        email: `${publicId}@example.com`,
        password_hash: "hash",
        first_name: "Test",
        last_name: "User",
        phone: null,
        is_active: true,
        is_online: false,
        last_seen_at: null,
        sip_username: null,
        sip_password_encrypted: null,
        created_at: now,
        updated_at: now,
        role_name: publicId === "usr_kargo" ? "kargo_operatoru" : "calisan",
      })),
      findSessionByPublicId: vi.fn(async () => ({
        id: 100,
        public_id: "ses_slice6",
        user_id: 10,
        user_agent: null,
        ip_address: null,
        expires_at: new Date("2026-02-01T00:00:00.000Z"),
        revoked_at: null,
        created_at: now,
        updated_at: now,
      })),
    },
    domainRepository: {
      listShipmentsPage: vi.fn(async () => ({
        rows: [shipment],
        total_count: 42,
        limit: 20,
        offset: 20,
      })),
      getShipmentByPublicId: vi.fn(async () => shipment),
      updateShipmentStatus: vi.fn(async () => ({ ...shipment, status: "delivered", last_event_text: "Teslim edildi" })),
    },
    queuePublisher: {
      publish: vi.fn(async () => "job_track_slice6"),
    },
    realtimePublisher: {
      publish: vi.fn(),
      publishToUser: vi.fn(),
      publishToConversation: vi.fn(),
      broadcast: vi.fn(),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return routeMocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/domain/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/domain/repository.js")>();

  return {
    ...actual,
    DomainRepository: vi.fn(function DomainRepository() {
      return routeMocks.domainRepository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "shipments-slice6-route-test-secret",
  encryptionKey: "shipments-slice6-route-encryption",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

async function accessToken(role: "calisan" | "kargo_operatoru") {
  return signAccessToken(
    {
      user_public_id: role === "kargo_operatoru" ? "usr_kargo" : "usr_calisan",
      session_public_id: "ses_slice6",
      role,
    },
    config,
  );
}

function app() {
  return createApp({
    config,
    db: {} as AppDatabase,
    providerDeliveryQueuePublisher: routeMocks.queuePublisher,
    realtimePublisher: routeMocks.realtimePublisher,
  });
}

describe("shipments slice 6 routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies server-side shipment filters, search, and pagination for calisan", async () => {
    const response = await app().request("/api/shipments?provider=ptt&status=in_transit&search=TRK&limit=20&offset=20", {
      headers: { authorization: `Bearer ${await accessToken("calisan")}` },
    });

    expect(response.status).toBe(200);
    expect(routeMocks.domainRepository.listShipmentsPage).toHaveBeenCalledWith({
      provider: "ptt",
      status: "in_transit",
      search: "TRK",
      limit: 20,
      offset: 20,
    });
    await expect(response.json()).resolves.toMatchObject({
      meta: { total_count: 42, limit: 20, offset: 20 },
      data: [{ tracking_number: "TRK-SLICE6", tracking_events: [{ description: "Accepted at branch" }] }],
    });
  });

  it("queues shipment.track through provider-delivery for kargo_operatoru", async () => {
    const response = await app().request("/api/shipments/shp_slice6/track", {
      method: "POST",
      headers: { authorization: `Bearer ${await accessToken("kargo_operatoru")}`, "content-type": "application/json" },
      body: JSON.stringify({ idempotency_key: "track_slice6" }),
    });

    expect(response.status).toBe(202);
    expect(routeMocks.queuePublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: "provider-delivery",
        name: "ptt.shipment.track",
        job_id: "job_track_slice6",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      operation: "shipment.track",
      queued: true,
      live_gate: "providers.ptt.live_mode",
    });
  });

  it("publishes shipment.updated when status changes", async () => {
    const response = await app().request("/api/shipments/shp_slice6/status", {
      method: "PATCH",
      headers: { authorization: `Bearer ${await accessToken("calisan")}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "delivered", last_event_text: "Teslim edildi" }),
    });

    expect(response.status).toBe(200);
    expect(routeMocks.realtimePublisher.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "shipment.updated",
        payload: expect.objectContaining({
          shipment_public_id: "shp_slice6",
          status: "delivered",
          tracking_number: "TRK-SLICE6",
        }),
      }),
    );
  });
});
