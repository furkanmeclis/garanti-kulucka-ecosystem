import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { expect, request, test } from "@playwright/test";
import type { AppDatabase } from "../../packages/database/src/index.js";
import { createApp } from "../../apps/api/src/app.js";
import type { ApiConfig } from "../../apps/api/src/config.js";
import { signAccessToken } from "../../apps/api/src/auth/tokens.js";
import type { SecretEncryptor } from "../../apps/api/src/security/encryption.js";
import type { JobEnvelope, RealtimeEnvelope, RealtimeRoom } from "../../packages/shared/src/index.js";

const date = new Date("2026-01-01T00:00:00.000Z");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "playwright-domain-flows-secret",
  encryptionKey: "playwright-domain-flows-encryption",
  encryptionKeyId: "playwright",
  accessTokenTtlSeconds: 900,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const user = {
  id: 1,
  public_id: "usr_playwright",
  email: "admin@example.com",
  first_name: "Admin",
  last_name: "User",
  password_hash: "unused",
  role_id: 1,
  is_active: true,
  is_online: false,
  last_seen_at: null,
  sip_username: "1001",
  sip_password_encrypted: "\"encrypted-sip-password\"",
  created_at: date,
  updated_at: date,
  role_name: "admin",
};

const session = {
  id: 1,
  public_id: "ses_playwright",
  user_id: user.id,
  user_agent: "playwright",
  ip_address: "127.0.0.1",
  revoked_at: null,
  expires_at: new Date("2027-01-01T00:00:00.000Z"),
  created_at: date,
  updated_at: date,
};

const conversation = {
  id: 10,
  public_id: "cnv_playwright",
  customer_id: 20,
  assigned_user_id: null,
  channel: "instagram",
  external_thread_id: "thread_playwright",
  status: "open",
  is_in_pool: true,
  human_agent_enabled: false,
  unread_count: 2,
  last_message_text: "Merhaba",
  last_message_sender_type: "customer",
  last_message_at: date,
  created_at: date,
  updated_at: date,
  customer_full_name: "Playwright Customer",
  customer_phone: "5550000000",
  assigned_user_email: null,
};

const customers = [
  {
    id: 20,
    public_id: "cus_playwright",
    full_name: "Playwright Customer",
    phone: "5550000000",
    email: "playwright@example.com",
    username: "playwright_customer",
    notes: "VIP kuluçka müşterisi",
    created_at: date,
    updated_at: date,
  },
];

const messages = [
  {
    id: 100,
    public_id: "msg_playwright_1",
    conversation_id: conversation.id,
    sender_type: "customer",
    sender_name: "Playwright Customer",
    body: "Merhaba",
    external_message_id: "external_msg_1",
    is_read: false,
    sent_at: date,
    raw_payload: { secret: "must-not-leak" },
    created_at: date,
    updated_at: date,
  },
];

const orders = [
  {
    id: 200,
    public_id: "ord_playwright",
    customer_id: 20,
    conversation_id: conversation.id,
    created_by_user_id: user.id,
    order_number: "ORD-PLAYWRIGHT",
    status: "draft",
    source: "manual",
    total_amount: "125.50",
    currency: "TRY",
    confirmation_status: null,
    notes: "fixture order",
    external_order_id: null,
    created_at: date,
    updated_at: date,
    customer_full_name: "Playwright Customer",
  },
  {
    id: 201,
    public_id: "ord_delivered_playwright",
    customer_id: 20,
    conversation_id: null,
    created_by_user_id: user.id,
    order_number: "ORD-DELIVERED",
    status: "delivered",
    source: "manual",
    total_amount: "75.00",
    currency: "TRY",
    confirmation_status: "confirmed",
    notes: "delivered fixture order",
    external_order_id: null,
    created_at: date,
    updated_at: date,
    customer_full_name: "Delivered Customer",
  },
];

const products = [
  {
    id: 250,
    public_id: "prd_incubator",
    sku: "SKU-KUL-56",
    name: "Kuluçka Pro 56",
    category: "incubator",
    unit_price: "1250.00",
    stock_quantity: 7,
    is_active: true,
    external_product_id: "kb_prd_56",
    created_at: date,
    updated_at: date,
  },
  {
    id: 251,
    public_id: "prd_fan",
    sku: "SKU-FAN",
    name: "Yedek Fan",
    category: "spare_part",
    unit_price: "85.00",
    stock_quantity: 0,
    is_active: true,
    external_product_id: "kb_fan",
    created_at: date,
    updated_at: date,
  },
];

const shipments = [
  {
    id: 300,
    public_id: "shp_playwright",
    order_id: 200,
    customer_id: 20,
    provider: "ptt",
    tracking_number: "TRK-PLAYWRIGHT",
    barcode_number: "BAR-PLAYWRIGHT",
    status: "in_transit",
    recipient_name: "Playwright Customer",
    recipient_phone: "5550000000",
    recipient_address: "Address",
    recipient_city: "Istanbul",
    recipient_district: "Kadikoy",
    last_event_text: "Accepted at branch",
    shipped_at: date,
    delivered_at: null,
    raw_payload: { provider_secret: "must-not-leak" },
    created_at: date,
    updated_at: date,
    order_number: "ORD-PLAYWRIGHT",
    customer_full_name: "Playwright Customer",
  },
];

const integrationProviders = [
  {
    id: 398,
    public_id: "prv_ptt",
    key: "ptt",
    name: "PTT Kargo",
    is_active: true,
    created_at: date,
    updated_at: date,
  },
  {
    id: 399,
    public_id: "prv_surat",
    key: "surat",
    name: "Sürat Kargo",
    is_active: true,
    created_at: date,
    updated_at: date,
  },
  {
    id: 400,
    public_id: "prv_kolaybi",
    key: "kolaybi",
    name: "KolayBi",
    is_active: true,
    created_at: date,
    updated_at: date,
  },
  {
    id: 401,
    public_id: "prv_instagram",
    key: "instagram",
    name: "Instagram",
    is_active: true,
    created_at: date,
    updated_at: date,
  },
  {
    id: 402,
    public_id: "prv_vapi",
    key: "vapi",
    name: "Vapi",
    is_active: true,
    created_at: date,
    updated_at: date,
  },
];

const providerAttempts: Array<Record<string, unknown>> = [];

const integrationAccounts = [
  {
    id: 450,
    public_id: "iac_instagram",
    provider_id: 401,
    display_name: "Instagram Main",
    external_account_id: "ig_main",
    status: "active",
    metadata: {
      analytics: {
        followers: 2240,
        reach: 1980,
        impressions: 2450,
        profile_views: 187,
        engagement_rate: 8,
      },
    },
    created_at: date,
    updated_at: date,
  },
];

const files = [
  {
    id: 350,
    public_id: "fil_orphan",
    bucket: "media",
    object_key: "uploads/orphan-proof.txt",
    original_name: "orphan-proof.txt",
    mime_type: "text/plain",
    byte_size: 42,
    checksum: "sha256:orphan-proof",
    created_by_user_id: user.id,
    created_at: date,
    updated_at: date,
  },
  {
    id: 351,
    public_id: "fil_attached",
    bucket: "media",
    object_key: "uploads/attached-proof.txt",
    original_name: "attached-proof.txt",
    mime_type: "text/plain",
    byte_size: 24,
    checksum: "sha256:attached-proof",
    created_by_user_id: user.id,
    created_at: date,
    updated_at: date,
  },
];

const settings = [
  {
    id: 400,
    public_id: "set_webphone_enabled",
    key: "webphone.enabled",
    scope: "global",
    value: true,
    is_secret: false,
    created_at: date,
    updated_at: date,
  },
  {
    id: 401,
    public_id: "set_webphone_url",
    key: "webphone.sip_websocket_url",
    scope: "global",
    value: "wss://sip.example.com/ws",
    is_secret: false,
    created_at: date,
    updated_at: date,
  },
  {
    id: 402,
    public_id: "set_webphone_domain",
    key: "webphone.sip_domain",
    scope: "global",
    value: "sip.example.com",
    is_secret: false,
    created_at: date,
    updated_at: date,
  },
  {
    id: 403,
    public_id: "set_webphone_ice",
    key: "webphone.ice_servers",
    scope: "global",
    value: [{ urls: "stun:stun.example.com:3478" }],
    is_secret: false,
    created_at: date,
    updated_at: date,
  },
  {
    id: 404,
    public_id: "set_provider_token",
    key: "instagram.access_token",
    scope: "global",
    value: { ciphertext: "hidden" },
    is_secret: true,
    created_at: date,
    updated_at: date,
  },
];

class FixtureQuery {
  private readonly whereValues = new Map<string, unknown>();
  private readonly whereOperators = new Map<string, string>();

  constructor(private readonly table: string) {}

  innerJoin() {
    return this;
  }

  leftJoin() {
    return this;
  }

  selectAll() {
    return this;
  }

  select() {
    return this;
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  $if(condition: boolean, callback: (builder: this) => this) {
    return condition ? callback(this) : this;
  }

  where(columnOrExpression: string | ((expression: unknown) => unknown), operator?: string, value?: unknown) {
    if (typeof columnOrExpression === "string" && operator !== undefined) {
      this.whereValues.set(columnOrExpression, value);
      this.whereOperators.set(columnOrExpression, operator);
    }
    return this;
  }

  async execute() {
    switch (this.table) {
      case "conversations":
        return [conversation];
      case "customers":
        return customers;
      case "messages":
        return messages;
      case "orders":
        return orders.filter((order) => {
          const statusFilter = this.whereValues.get("orders.status");
          const confirmationFilter = this.whereValues.get("orders.confirmation_status");
          const statusMatches =
            statusFilter === undefined ||
            (Array.isArray(statusFilter)
              ? !statusFilter.includes(order.status)
              : order.status === statusFilter);
          const confirmationMatches =
            confirmationFilter === undefined ||
            (confirmationFilter === null
              ? order.confirmation_status === null
              : order.confirmation_status === confirmationFilter);
          return statusMatches && confirmationMatches;
        });
      case "products":
        return products;
      case "shipments":
        return shipments.filter((shipment) => {
          const providerFilter = this.whereValues.get("shipments.provider");
          const statusFilter = this.whereValues.get("shipments.status");
          const trackingNumberFilter = this.whereValues.get("shipments.tracking_number");
          const barcodeNumberFilter = this.whereValues.get("shipments.barcode_number");
          const providerMatches =
            providerFilter === undefined ||
            (Array.isArray(providerFilter)
              ? this.whereOperators.get("shipments.provider") === "not in"
                ? !providerFilter.includes(shipment.provider)
                : providerFilter.includes(shipment.provider)
              : shipment.provider === providerFilter);
          const statusMatches = statusFilter === undefined || shipment.status === statusFilter;
          const trackingMatches =
            trackingNumberFilter === undefined ||
            (trackingNumberFilter === null && shipment.tracking_number === null);
          const barcodeMatches =
            barcodeNumberFilter === undefined ||
            (barcodeNumberFilter === null && shipment.barcode_number === null);
          return providerMatches && statusMatches && trackingMatches && barcodeMatches;
        });
      case "files":
        return files.filter((file) => file.public_id === "fil_orphan");
      case "settings":
        return settings.filter((setting) => this.whereValues.get("scope") === undefined || setting.scope === this.whereValues.get("scope"));
      case "roles":
        return [{ id: 1 }];
      case "integration_providers":
        return integrationProviders.filter((provider) =>
          (this.whereValues.get("key") === undefined || provider.key === this.whereValues.get("key")) &&
          (this.whereValues.get("is_active") === undefined || provider.is_active === this.whereValues.get("is_active")),
        );
      case "integration_accounts":
        return integrationAccounts.filter((account) =>
          (this.whereValues.get("provider_id") === undefined || account.provider_id === this.whereValues.get("provider_id")) &&
          (this.whereValues.get("public_id") === undefined || account.public_id === this.whereValues.get("public_id")),
        );
      case "provider_attempts":
        return providerAttempts.filter((attempt) =>
          (this.whereValues.get("provider_id") === undefined || attempt.provider_id === this.whereValues.get("provider_id")) &&
          (this.whereValues.get("idempotency_key") === undefined || attempt.idempotency_key === this.whereValues.get("idempotency_key")),
        ).map((attempt) => ({
          ...attempt,
          provider_key: integrationProviders.find((provider) => provider.id === attempt.provider_id)?.key,
          account_public_id: integrationAccounts.find((account) => account.id === attempt.account_id)?.public_id ?? null,
        }));
      default:
        return [];
    }
  }

  async executeTakeFirst() {
    switch (this.table) {
      case "users":
        return user;
      case "user_sessions":
        return session;
      case "conversations":
        return this.whereValues.get("public_id") === conversation.public_id ||
          this.whereValues.get("conversations.public_id") === conversation.public_id
          ? conversation
          : null;
      case "orders":
        return orders.find((order) =>
          this.whereValues.get("public_id") === order.public_id ||
          this.whereValues.get("orders.public_id") === order.public_id,
        ) ?? null;
      case "integration_providers":
      case "integration_accounts":
      case "provider_attempts":
        return (await this.execute())[0] ?? null;
      case "files":
        return files.find((file) =>
          this.whereValues.get("public_id") === file.public_id ||
          this.whereValues.get("files.public_id") === file.public_id,
        ) ?? null;
      default:
        return null;
    }
  }
}

class FixtureInsert {
  private row: Record<string, unknown> = {};

  constructor(private readonly table: string) {}

  values(row: Record<string, unknown>) {
    this.row = row;
    return this;
  }

  returningAll() {
    return this;
  }

  onConflict() {
    return this;
  }

  columns() {
    return this;
  }

  where() {
    return this;
  }

  doNothing() {
    return this;
  }

  async executeTakeFirst() {
    if (this.table === "provider_attempts") {
      const duplicate = providerAttempts.find((attempt) =>
        attempt.provider_id === this.row.provider_id &&
        attempt.idempotency_key === this.row.idempotency_key &&
        this.row.idempotency_key !== null,
      );
      if (duplicate) {
        return null;
      }
    }

    return this.executeTakeFirstOrThrow();
  }

  async executeTakeFirstOrThrow() {
    if (this.table === "provider_attempts") {
      const attempt = {
        id: providerAttempts.length + 500,
        ...this.row,
        created_at: date,
        updated_at: date,
      };
      providerAttempts.push(attempt);
      return attempt;
    }

    if (this.table !== "messages") {
      throw new Error(`Unsupported fixture insert: ${this.table}`);
    }

    const message = {
      id: messages.length + 301,
      public_id: String(this.row.public_id),
      conversation_id: Number(this.row.conversation_id),
      sender_type: String(this.row.sender_type),
      sender_name: this.row.sender_name as string | null,
      body: this.row.body as string | null,
      external_message_id: this.row.external_message_id as string | null,
      is_read: Boolean(this.row.is_read),
      sent_at: this.row.sent_at as Date,
      raw_payload: this.row.raw_payload,
      created_at: date,
    };
    messages.push(message);
    return message;
  }
}

class FixtureUpdate {
  private readonly valuesToSet: Record<string, unknown> = {};
  private readonly whereValues = new Map<string, unknown>();

  constructor(private readonly table: string) {}

  set(values: Record<string, unknown>) {
    Object.assign(this.valuesToSet, values);
    return this;
  }

  where(column: string, _operator?: string, value?: unknown) {
    this.whereValues.set(column, value);
    return this;
  }

  returningAll() {
    return this;
  }

  async executeTakeFirst() {
    if (this.table === "orders") {
      const order = orders.find((item) => item.public_id === this.whereValues.get("public_id"));
      if (!order) return null;
      Object.assign(order, this.valuesToSet);
      return order;
    }
    if (this.table !== "shipments") {
      throw new Error(`Unsupported fixture returning update: ${this.table}`);
    }
    Object.assign(shipments[0], this.valuesToSet);
    return shipments[0];
  }

  async execute() {
    if (this.table === "messages") {
      for (const message of messages) {
        if (message.conversation_id === this.whereValues.get("conversation_id")) {
          Object.assign(message, this.valuesToSet);
        }
      }
      return [];
    }
    if (this.table !== "conversations") {
      throw new Error(`Unsupported fixture update: ${this.table}`);
    }
    Object.assign(conversation, this.valuesToSet);
    if (conversation.assigned_user_id === user.id) {
      conversation.assigned_user_email = user.email;
    }
    if (conversation.assigned_user_id === null) {
      conversation.assigned_user_email = null;
    }
    return [];
  }
}

function createFixtureDatabase(): AppDatabase {
  const fixtureDatabase = {
    selectFrom(table: string) {
      return new FixtureQuery(table);
    },
    insertInto(table: string) {
      return new FixtureInsert(table);
    },
    updateTable(table: string) {
      return new FixtureUpdate(table);
    },
    transaction() {
      return {
        execute: async <T>(callback: (transaction: typeof fixtureDatabase) => Promise<T>) =>
          callback(fixtureDatabase),
      };
    },
  };
  return fixtureDatabase as unknown as AppDatabase;
}

const encryptor: SecretEncryptor = {
  encryptJson(value: unknown) {
    return { value };
  },
  decryptJson(value: unknown) {
    return value === "encrypted-sip-password" ? "sip-secret" : value;
  },
};

async function startFixtureApi() {
  const token = await signAccessToken(
    {
      user_public_id: user.public_id,
      session_public_id: session.public_id,
      role: "admin",
    },
    config,
  );
  const cargoToken = await signAccessToken(
    {
      user_public_id: user.public_id,
      session_public_id: session.public_id,
      role: "kargo_operatoru",
    },
    config,
  );
  const ownerToken = await signAccessToken(
    {
      user_public_id: user.public_id,
      session_public_id: session.public_id,
      role: "owner",
    },
    config,
  );
  const staffToken = await signAccessToken(
    {
      user_public_id: user.public_id,
      session_public_id: session.public_id,
      role: "calisan",
    },
    config,
  );
  const viewerToken = await signAccessToken(
    {
      user_public_id: user.public_id,
      session_public_id: session.public_id,
      role: "viewer",
    },
    config,
  );
  const publishedRealtime: Array<{ room: RealtimeRoom; envelope: RealtimeEnvelope }> = [];
  const providerDeliveryJobs: JobEnvelope[] = [];
  const server = serve({
    fetch: createApp({
      config,
      db: createFixtureDatabase(),
      encryptor,
      realtimePublisher: {
        publish: (room, envelope) => publishedRealtime.push({ room, envelope }),
        publishToUser: (userPublicId, envelope) =>
          publishedRealtime.push({ room: `user:${userPublicId}` as RealtimeRoom, envelope }),
        publishToConversation: (conversationPublicId, envelope) =>
          publishedRealtime.push({ room: `conversation:${conversationPublicId}` as RealtimeRoom, envelope }),
        broadcast: (envelope) => publishedRealtime.push({ room: "broadcast", envelope }),
      },
      providerDeliveryQueuePublisher: {
        publish: async (job) => {
          providerDeliveryJobs.push(job);
          return job.job_id;
        },
      },
    }).fetch,
    port: 0,
  });
  const address = server.address() as AddressInfo;
  const baseURL = `http://127.0.0.1:${address.port}`;
  const client = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      authorization: `Bearer ${token}`,
      "x-request-id": "playwright_domain_flows_1",
    },
  });
  const cargoClient = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      authorization: `Bearer ${cargoToken}`,
      "x-request-id": "playwright_domain_flows_cargo",
    },
  });
  const ownerClient = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      authorization: `Bearer ${ownerToken}`,
      "x-request-id": "playwright_domain_flows_owner",
    },
  });
  const staffClient = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      authorization: `Bearer ${staffToken}`,
      "x-request-id": "playwright_domain_flows_staff",
    },
  });
  const viewerClient = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      authorization: `Bearer ${viewerToken}`,
      "x-request-id": "playwright_domain_flows_viewer",
    },
  });

  return {
    client,
    cargoClient,
    ownerClient,
    staffClient,
    viewerClient,
    publishedRealtime,
    providerDeliveryJobs,
    async close() {
      await client.dispose();
      await cargoClient.dispose();
      await ownerClient.dispose();
      await staffClient.dispose();
      await viewerClient.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

test("backend domain flows serve inbox, order, shipment, settings, and webphone contracts over HTTP", async () => {
  const api = await startFixtureApi();

  try {
    const [
      conversationResponse,
      commentModerationResponse,
      balanceSummaryResponse,
      reportSummaryResponse,
      customerResponse,
      messageResponse,
      orderResponse,
      orderSummaryResponse,
      productResponse,
      productSummaryResponse,
      shipmentResponse,
      shipmentPipelineResponse,
      fileOrphansResponse,
      providerCatalogResponse,
      providerDebugSummaryResponse,
      settingsResponse,
      webphoneResponse,
    ] =
      await Promise.all([
        api.client.get("/api/conversations?limit=10"),
        api.client.get("/api/comments/moderation-summary"),
        api.client.get("/api/balances/summary"),
        api.client.get("/api/reports/summary"),
        api.client.get("/api/customers?limit=10"),
        api.client.get(`/api/conversations/${conversation.public_id}/messages?limit=10`),
        api.client.get("/api/orders?limit=10"),
        api.client.get("/api/orders/summary"),
        api.client.get("/api/products?limit=10"),
        api.client.get("/api/products/summary"),
        api.client.get("/api/shipments?limit=10"),
        api.client.get("/api/shipments/pipeline-summary"),
        api.client.get("/api/files/orphans?limit=10"),
        api.client.get("/admin/integrations/provider-catalog"),
        api.client.get("/admin/integrations/provider-debug-summary"),
        api.client.get("/admin/settings?scope=global"),
        api.client.get("/api/webphone/config"),
      ]);

    expect(conversationResponse.status()).toBe(200);
    expect(await conversationResponse.json()).toMatchObject({
      data: [
        {
          public_id: conversation.public_id,
          channel: "instagram",
          customer: {
            full_name: "Playwright Customer",
          },
        },
      ],
    });

    expect(commentModerationResponse.status()).toBe(200);
    expect(await commentModerationResponse.json()).toMatchObject({
      manual_queue: 1,
      automatic_queue: 0,
      answered: 0,
      instagram: 1,
      facebook: 0,
    });
    const [ownerCommentModerationResponse, staffCommentModerationResponse] = await Promise.all([
      api.ownerClient.get("/api/comments/moderation-summary"),
      api.staffClient.get("/api/comments/moderation-summary"),
    ]);
    expect(ownerCommentModerationResponse.status()).toBe(200);
    expect(staffCommentModerationResponse.status()).toBe(200);

    expect(balanceSummaryResponse.status()).toBe(200);
    expect(await balanceSummaryResponse.json()).toMatchObject({
      total_commission: 20.05,
      total_deduction: 0,
      pending_payment: 12.55,
      available_balance: 7.5,
      pending_request_count: 1,
    });
    const [ownerBalanceSummaryResponse, staffBalanceSummaryResponse] = await Promise.all([
      api.ownerClient.get("/api/balances/summary"),
      api.staffClient.get("/api/balances/summary"),
    ]);
    expect(ownerBalanceSummaryResponse.status()).toBe(200);
    expect(staffBalanceSummaryResponse.status()).toBe(200);

    expect(reportSummaryResponse.status()).toBe(200);
    await expect(reportSummaryResponse.json()).resolves.toMatchObject({
      conversation_count: 1,
      order_count: 2,
      shipment_count: 1,
      total_revenue: 200.5,
      currency: "TRY",
      open_conversation_count: 1,
      pending_confirmation_count: 1,
      active_shipment_count: 1,
      delivered_shipment_count: 0,
      delivered_shipment_rate: 0,
      confirmation_rate: 50,
      active_shipment_rate: 100,
    });

    expect(customerResponse.status()).toBe(200);
    expect(await customerResponse.json()).toMatchObject({
      data: [
        {
          public_id: "cus_playwright",
          full_name: "Playwright Customer",
          phone: "5550000000",
          email: "playwright@example.com",
          username: "playwright_customer",
          notes: "VIP kuluçka müşterisi",
        },
      ],
    });

    const [activeOrdersResponse, pendingConfirmationOrdersResponse] = await Promise.all([
      api.client.get("/api/orders?status=active&limit=10"),
      api.client.get("/api/orders?confirmation_status=pending&limit=10"),
    ]);
    expect(activeOrdersResponse.status()).toBe(200);
    expect(await activeOrdersResponse.json()).toMatchObject({
      data: [{ public_id: "ord_playwright", status: "draft" }],
    });
    expect(pendingConfirmationOrdersResponse.status()).toBe(200);
    expect(await pendingConfirmationOrdersResponse.json()).toMatchObject({
      data: [{ public_id: "ord_playwright", confirmation_status: null }],
    });
    expect(orderSummaryResponse.status()).toBe(200);
    await expect(orderSummaryResponse.json()).resolves.toMatchObject({
      total_count: 2,
      active_count: 1,
      delivered_count: 1,
      pending_confirmation_count: 1,
      total_revenue: 200.5,
      currency: "TRY",
    });
    expect(productSummaryResponse.status()).toBe(200);
    await expect(productSummaryResponse.json()).resolves.toMatchObject({
      total_count: 2,
      active_count: 2,
      critical_count: 1,
      critical_threshold: 3,
      category_counts: {
        incubator: 1,
        spare_part: 1,
        other: 0,
      },
    });

    const [pttShipmentsResponse, otherShipmentsResponse, inTransitShipmentsResponse, missingTrackingShipmentsResponse] = await Promise.all([
      api.client.get("/api/shipments?provider=ptt&limit=10"),
      api.client.get("/api/shipments?provider=other&limit=10"),
      api.client.get("/api/shipments?status=in_transit&limit=10"),
      api.client.get("/api/shipments?tracking_missing=true&limit=10"),
    ]);
    expect(pttShipmentsResponse.status()).toBe(200);
    expect(await pttShipmentsResponse.json()).toMatchObject({
      data: [{ public_id: "shp_playwright", provider: "ptt" }],
    });
    expect(otherShipmentsResponse.status()).toBe(200);
    expect(await otherShipmentsResponse.json()).toMatchObject({ data: [] });
    expect(inTransitShipmentsResponse.status()).toBe(200);
    expect(await inTransitShipmentsResponse.json()).toMatchObject({
      data: [{ public_id: "shp_playwright", status: "in_transit" }],
    });
    expect(missingTrackingShipmentsResponse.status()).toBe(200);
    expect(await missingTrackingShipmentsResponse.json()).toMatchObject({ data: [] });

    expect(shipmentPipelineResponse.status()).toBe(200);
    expect(await shipmentPipelineResponse.json()).toMatchObject({
      counts: {
        all: 1,
        mesaj: 0,
        sms: 0,
        vapi: 1,
        teslim: 0,
        bekliyor: 0,
        isleniyor: 1,
        hata: 0,
      },
      rows: [
        {
          shipment_public_id: "shp_playwright",
          recipient_name: "Playwright Customer",
          step: "vapi",
          pipeline_status: "isleniyor",
        },
      ],
    });
    const [cargoShipmentPipelineResponse, viewerShipmentPipelineResponse] = await Promise.all([
      api.cargoClient.get("/api/shipments/pipeline-summary"),
      api.viewerClient.get("/api/shipments/pipeline-summary"),
    ]);
    expect(cargoShipmentPipelineResponse.status()).toBe(200);
    expect(viewerShipmentPipelineResponse.status()).toBe(403);

    const forbiddenCustomerResponse = await api.cargoClient.get("/api/customers?limit=10");
    expect(forbiddenCustomerResponse.status()).toBe(403);
    expect(await forbiddenCustomerResponse.json()).toMatchObject({
      error: { code: "forbidden" },
    });

    expect(messageResponse.status()).toBe(200);
    expect(await messageResponse.json()).toMatchObject({
      data: [
        {
          public_id: "msg_playwright_1",
          body: "Merhaba",
        },
      ],
    });

    const createdMessageResponse = await api.client.post(
      `/api/conversations/${conversation.public_id}/messages`,
      {
        data: {
          sender_type: "user",
          sender_name: "admin@example.com",
          body: "Realtime kaniti",
          external_message_id: null,
          raw_payload: null,
        },
      },
    );
    expect(createdMessageResponse.status()).toBe(201);
    const createdMessage = await createdMessageResponse.json();
    const expectedMessageEnvelope = expect.objectContaining({
      event: "message.created",
      payload: {
        message_public_id: createdMessage.public_id,
        conversation_public_id: conversation.public_id,
        sender_type: "user",
      },
    });
    expect(api.publishedRealtime).toEqual([
      {
        room: `conversation:${conversation.public_id}`,
        envelope: expectedMessageEnvelope,
      },
      {
        room: "broadcast",
        envelope: expectedMessageEnvelope,
      },
    ]);

    const updatedConversationResponse = await api.client.patch(
      `/api/conversations/${conversation.public_id}/state`,
      {
        data: {
          unread_count: 0,
          human_agent_enabled: true,
          is_in_pool: false,
          assign_to_me: true,
        },
      },
    );
    expect(updatedConversationResponse.status()).toBe(200);
    expect(await updatedConversationResponse.json()).toMatchObject({
      public_id: conversation.public_id,
      unread_count: 0,
      human_agent_enabled: true,
      is_in_pool: false,
      assigned_user_email: "admin@example.com",
    });

    const cancelledOrderResponse = await api.client.patch(
      "/api/orders/ord_playwright/status",
      {
        data: {
          status: "cancelled",
          notes: "API iptal kaniti",
        },
      },
    );
    expect(cancelledOrderResponse.status()).toBe(200);
    const cancelledOrder = await cancelledOrderResponse.json() as {
      updated_at: string;
    };
    expect(cancelledOrder).toMatchObject({
      public_id: "ord_playwright",
      status: "cancelled",
      notes: "API iptal kaniti",
      customer_full_name: "Playwright Customer",
    });
    expect(Date.parse(cancelledOrder.updated_at)).toBeGreaterThan(date.getTime());

    const paymentRequestResponse = await api.client.post("/api/orders/ord_playwright/payment-request", {
      data: {
        amount: "12.55",
        currency: "TRY",
        idempotency_key: "payment_ord_playwright_12.55_TRY",
      },
    });
    expect(paymentRequestResponse.status()).toBe(202);
    const paymentRequest = await paymentRequestResponse.json();
    expect(paymentRequest).toMatchObject({
      provider: "kolaybi",
      operation: "balance.payment_request",
      request_id: "payreq_payment_ord_playwright_12_55_try",
      queued: false,
      live_call_permitted: false,
      replayed: false,
      order_public_id: "ord_playwright",
      amount: "12.55",
      currency: "TRY",
      order: {
        public_id: "ord_playwright",
        notes: "API iptal kaniti",
      },
    });
    const repeatedPaymentRequestResponse = await api.client.post("/api/orders/ord_playwright/payment-request", {
      data: {
        amount: "12.55",
        currency: "TRY",
        idempotency_key: "payment_ord_playwright_12.55_TRY",
      },
    });
    expect(repeatedPaymentRequestResponse.status()).toBe(202);
    await expect(repeatedPaymentRequestResponse.json()).resolves.toMatchObject({
      provider: "kolaybi",
      request_id: "payreq_payment_ord_playwright_12_55_try",
      replayed: true,
    });
    expect(providerAttempts.filter((attempt) => attempt.idempotency_key === "payment_ord_playwright_12.55_TRY")).toHaveLength(1);
    const mismatchedPaymentRequestResponse = await api.client.post("/api/orders/ord_playwright/payment-request", {
      data: {
        amount: "13.00",
        currency: "TRY",
        idempotency_key: "payment_ord_playwright_12.55_TRY",
      },
    });
    expect(mismatchedPaymentRequestResponse.status()).toBe(409);
    await expect(mismatchedPaymentRequestResponse.json()).resolves.toMatchObject({
      error: { code: "idempotency_conflict" },
    });

    const cronTriggerResponse = await api.client.post("/admin/integrations/provider-cron-triggers/ptt", {
      data: {
        idempotency_key: "cron_debug_ptt_playwright",
      },
    });
    expect(cronTriggerResponse.status()).toBe(202);
    await expect(cronTriggerResponse.json()).resolves.toMatchObject({
      provider_key: "ptt",
      request_id: "cron_ptt_cron_debug_ptt_playwright",
      operation: "shipment.track",
      direction: "outbound",
      status: "success",
      retry_decision: "none",
      idempotency_key: "cron_debug_ptt_playwright",
      provider_request_preview: {
        method: "POST",
        path: "/api/ptt/cron-debug",
        live_call_performed: false,
      },
      response_metadata: {
        mode: "dry_run",
        queued: false,
        live_call_permitted: false,
      },
    });
    expect(providerAttempts.filter((attempt) => attempt.idempotency_key === "cron_debug_ptt_playwright")).toHaveLength(1);
    const providerDebugSummaryAfterCronResponse = await api.client.get("/admin/integrations/provider-debug-summary");
    expect(providerDebugSummaryAfterCronResponse.status()).toBe(200);
    await expect(providerDebugSummaryAfterCronResponse.json()).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          provider_key: "ptt",
          total_attempts: 1,
          success_count: 1,
          failure_count: 0,
          retry_count: 0,
          average_duration_ms: 0,
        }),
      ]),
      cron: {
        provider_keys: ["ptt", "surat"],
        operation: "shipment.track",
        total_attempts: 1,
        success_count: 1,
        failure_count: 0,
        retry_count: 0,
        total_duration_ms: 0,
        latest_attempt: expect.objectContaining({
          provider_key: "ptt",
          provider_request_preview: expect.objectContaining({
            path: "/api/ptt/cron-debug",
          }),
        }),
      },
    });

    const instagramPublishResponse = await api.client.post("/admin/integrations/instagram-publish-previews", {
      data: {
        account_public_id: "iac_instagram",
        image_url: "https://example.com/garanti-kulucka.jpg",
        caption: "Playwright Instagram yayin",
        idempotency_key: "instagram_publish_playwright",
      },
    });
    expect(instagramPublishResponse.status()).toBe(202);
    const instagramPublishPayload = await instagramPublishResponse.json();
    expect(instagramPublishPayload).toMatchObject({
      provider_key: "instagram",
      account_public_id: "iac_instagram",
      request_id: "igpub_instagram_publish_playwright",
      operation: "message.send",
      direction: "outbound",
      status: "success",
      retry_decision: "none",
      idempotency_key: "instagram_publish_playwright",
      provider_request_preview: {
        method: "POST",
        path: "/v18.0/ig_main/media",
        live_call_performed: false,
      },
      response_metadata: {
        mode: "dry_run",
        queued: false,
        live_call_permitted: false,
      },
    });
    expect(providerAttempts.filter((attempt) => attempt.idempotency_key === "instagram_publish_playwright")).toHaveLength(1);
    const repeatedInstagramPublishResponse = await api.client.post("/admin/integrations/instagram-publish-previews", {
      data: {
        account_public_id: "iac_instagram",
        image_url: "https://example.com/garanti-kulucka.jpg",
        caption: "Playwright Instagram yayin",
        idempotency_key: "instagram_publish_playwright",
      },
    });
    expect(repeatedInstagramPublishResponse.status()).toBe(202);
    await expect(repeatedInstagramPublishResponse.json()).resolves.toMatchObject({
      public_id: instagramPublishPayload.public_id,
      provider_key: "instagram",
      account_public_id: "iac_instagram",
      request_id: "igpub_instagram_publish_playwright",
      provider_request_preview: {
        method: "POST",
        path: "/v18.0/ig_main/media",
        live_call_performed: false,
      },
    });
    expect(providerAttempts.filter((attempt) => attempt.idempotency_key === "instagram_publish_playwright")).toHaveLength(1);
    const mismatchedInstagramPublishResponse = await api.client.post("/admin/integrations/instagram-publish-previews", {
      data: {
        account_public_id: "iac_instagram",
        image_url: "https://example.com/garanti-kulucka.jpg",
        caption: "Changed Instagram caption",
        idempotency_key: "instagram_publish_playwright",
      },
    });
    expect(mismatchedInstagramPublishResponse.status()).toBe(409);
    await expect(mismatchedInstagramPublishResponse.json()).resolves.toMatchObject({
      error: { code: "idempotency_conflict" },
    });

    const vapiTestCallResponse = await api.client.post("/api/webphone/test-call", {
      data: {
        customer_name: "Playwright Customer",
        customer_phone: "05051234567",
        cargo_provider: "PTT",
        tracking_number: "TRK-PLAYWRIGHT",
        last_event_text: "Accepted at branch",
        idempotency_key: "vapi_test_playwright",
      },
    });
    expect(vapiTestCallResponse.status()).toBe(202);
    const vapiTestCallPayload = await vapiTestCallResponse.json();
    expect(vapiTestCallPayload).toMatchObject({
      provider_key: "vapi",
      account_public_id: null,
      request_id: "vapitest_vapi_test_playwright",
      operation: "call.test",
      direction: "outbound",
      status: "success",
      retry_decision: "none",
      idempotency_key: "vapi_test_playwright",
      provider_request_preview: {
        method: "POST",
        path: "/vapi/calls",
        live_call_performed: false,
      },
      response_metadata: {
        mode: "dry_run",
        queued: false,
        live_call_permitted: false,
      },
    });
    expect(JSON.stringify(vapiTestCallPayload)).toContain("[redacted]");
    expect(providerAttempts.filter((attempt) => attempt.idempotency_key === "vapi_test_playwright")).toHaveLength(1);
    const repeatedVapiTestCallResponse = await api.client.post("/api/webphone/test-call", {
      data: {
        customer_name: "Playwright Customer",
        customer_phone: "05051234567",
        cargo_provider: "PTT",
        tracking_number: "TRK-PLAYWRIGHT",
        last_event_text: "Accepted at branch",
        idempotency_key: "vapi_test_playwright",
      },
    });
    expect(repeatedVapiTestCallResponse.status()).toBe(202);
    await expect(repeatedVapiTestCallResponse.json()).resolves.toMatchObject({
      public_id: vapiTestCallPayload.public_id,
      request_id: "vapitest_vapi_test_playwright",
    });
    expect(providerAttempts.filter((attempt) => attempt.idempotency_key === "vapi_test_playwright")).toHaveLength(1);
    const mismatchedVapiTestCallResponse = await api.client.post("/api/webphone/test-call", {
      data: {
        customer_name: "Changed Customer",
        customer_phone: "05051234567",
        cargo_provider: "PTT",
        tracking_number: "TRK-PLAYWRIGHT",
        last_event_text: "Accepted at branch",
        idempotency_key: "vapi_test_playwright",
      },
    });
    expect(mismatchedVapiTestCallResponse.status()).toBe(409);
    await expect(mismatchedVapiTestCallResponse.json()).resolves.toMatchObject({
      error: { code: "idempotency_conflict" },
    });

    const smsResponse = await api.client.post("/api/sms/send", {
      data: {
        recipient_phone: "5550000000",
        message: "Playwright SMS kaniti",
        shipment_public_id: "shp_playwright",
        idempotency_key: "manual_sms_shp_playwright",
      },
    });
    expect(smsResponse.status()).toBe(202);
    await expect(smsResponse.json()).resolves.toMatchObject({
      provider: "netgsm",
      operation: "sms.send",
      job_id: "job_manual_sms_shp_playwright",
      queued: true,
      recipient_phone: "5550000000",
      live_call_permitted: false,
    });
    expect(api.providerDeliveryJobs.at(-1)).toMatchObject({
      queue: "provider-delivery",
      name: "netgsm.sms.send",
      payload: {
        envelope: {
          provider: "netgsm",
          operation: "sms.send",
          direction: "outbound",
          channel: "sms",
          payload: {
            recipient_phone: "5550000000",
            message: "Playwright SMS kaniti",
            shipment_public_id: "shp_playwright",
            idempotency_key: "manual_sms_shp_playwright",
          },
        },
      },
    });
    const forbiddenSmsResponse = await api.viewerClient.post("/api/sms/send", {
      data: {
        recipient_phone: "5550000000",
        message: "Yetkisiz SMS",
        shipment_public_id: "shp_playwright",
        idempotency_key: "manual_sms_forbidden",
      },
    });
    expect(forbiddenSmsResponse.status()).toBe(403);

    expect(orderResponse.status()).toBe(200);
    expect((await orderResponse.json()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          order_number: "ORD-PLAYWRIGHT",
          total_amount: "125.50",
        }),
        expect.objectContaining({
          order_number: "ORD-DELIVERED",
          status: "delivered",
        }),
      ]),
    );

    expect(productResponse.status()).toBe(200);
    const productBody = await productResponse.json();
    expect(productBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          public_id: "prd_incubator",
          sku: "SKU-KUL-56",
          name: "Kuluçka Pro 56",
          category: "incubator",
          unit_price: "1250.00",
          stock_quantity: 7,
          is_active: true,
          external_product_id: "kb_prd_56",
        }),
      ]),
    );

    expect(shipmentResponse.status()).toBe(200);
    expect(await shipmentResponse.json()).toMatchObject({
      data: [
        {
          provider: "ptt",
          tracking_number: "TRK-PLAYWRIGHT",
          order_number: "ORD-PLAYWRIGHT",
        },
      ],
    });

    expect(fileOrphansResponse.status()).toBe(200);
    expect(await fileOrphansResponse.json()).toMatchObject({
      data: [
        {
          public_id: "fil_orphan",
          object_key: "uploads/orphan-proof.txt",
          byte_size: 42,
        },
      ],
    });
    const orphanCleanupDryRunResponse = await api.client.post("/api/files/fil_orphan/orphan-cleanup-dry-run", {
      data: {
        reason: "playwright-orphan-review",
      },
    });
    expect(orphanCleanupDryRunResponse.status()).toBe(200);
    expect(await orphanCleanupDryRunResponse.json()).toMatchObject({
      mode: "dry_run",
      request_id: "orphan_cleanup_fil_orphan",
      deletion_performed: false,
      eligible_for_cleanup: true,
      reason: "playwright-orphan-review",
      file: {
        public_id: "fil_orphan",
        object_key: "uploads/orphan-proof.txt",
      },
      storage_action: {
        provider: "garage",
        bucket: "media",
        object_key: "uploads/orphan-proof.txt",
        operation: "delete_object",
      },
    });
    const malformedOrphanCleanupDryRunResponse = await api.client.post("/api/files/fil_orphan/orphan-cleanup-dry-run", {
      data: "{",
      headers: {
        "content-type": "application/json",
      },
    });
    expect(malformedOrphanCleanupDryRunResponse.status()).toBe(400);
    expect(await malformedOrphanCleanupDryRunResponse.json()).toMatchObject({
      error: { code: "invalid_request" },
    });
    const forbiddenFileOrphansResponse = await api.cargoClient.get("/api/files/orphans?limit=10");
    expect(forbiddenFileOrphansResponse.status()).toBe(403);
    expect(await forbiddenFileOrphansResponse.json()).toMatchObject({
      error: { code: "forbidden" },
    });
    const forbiddenCommentModerationResponse = await api.cargoClient.get("/api/comments/moderation-summary");
    expect(forbiddenCommentModerationResponse.status()).toBe(403);
    expect(await forbiddenCommentModerationResponse.json()).toMatchObject({
      error: { code: "forbidden" },
    });
    const forbiddenBalanceSummaryResponse = await api.cargoClient.get("/api/balances/summary");
    expect(forbiddenBalanceSummaryResponse.status()).toBe(403);
    expect(await forbiddenBalanceSummaryResponse.json()).toMatchObject({
      error: { code: "forbidden" },
    });
    const forbiddenReportSummaryResponse = await api.cargoClient.get("/api/reports/summary");
    expect(forbiddenReportSummaryResponse.status()).toBe(403);
    const forbiddenOrphanCleanupDryRunResponse = await api.cargoClient.post("/api/files/fil_orphan/orphan-cleanup-dry-run", {
      data: {
        reason: "forbidden",
      },
    });
    expect(forbiddenOrphanCleanupDryRunResponse.status()).toBe(403);

    expect(providerCatalogResponse.status()).toBe(200);
    const providerCatalogBody = await providerCatalogResponse.json();
    expect(providerCatalogBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "ptt",
          contract_mode: "fixture_only",
          live_feature_flag_key: "providers.ptt.live_mode",
          live_call_permitted: false,
          live_block_reason: "fixture_replay_contract_required",
        }),
        expect.objectContaining({
          provider: "vapi",
          supported_operations: ["call.webhook"],
          live_call_permitted: false,
        }),
        expect.objectContaining({
          provider: "sip",
          supported_operations: ["sip.config.sync"],
          live_call_permitted: false,
        }),
      ]),
    );
    expect(providerDebugSummaryResponse.status()).toBe(200);
    await expect(providerDebugSummaryResponse.json()).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ provider_key: "ptt" }),
        expect.objectContaining({ provider_key: "surat" }),
      ]),
      cron: expect.objectContaining({
        provider_keys: ["ptt", "surat"],
        operation: "shipment.track",
      }),
    });
    const instagramAnalyticsSummaryResponse = await api.client.get(
      "/admin/integrations/accounts/iac_instagram/analytics-summary",
    );
    expect(instagramAnalyticsSummaryResponse.status()).toBe(200);
    await expect(instagramAnalyticsSummaryResponse.json()).resolves.toMatchObject({
      followers: 2240,
      reach: 1980,
      impressions: 2450,
      profile_views: 187,
      engagement_rate: 8,
    });
    const forbiddenProviderCatalogResponse = await api.cargoClient.get("/admin/integrations/provider-catalog");
    expect(forbiddenProviderCatalogResponse.status()).toBe(403);
    expect(await forbiddenProviderCatalogResponse.json()).toMatchObject({
      error: { code: "forbidden" },
    });
    const forbiddenProviderDebugSummaryResponse = await api.cargoClient.get("/admin/integrations/provider-debug-summary");
    expect(forbiddenProviderDebugSummaryResponse.status()).toBe(403);
    const forbiddenInstagramAnalyticsSummaryResponse = await api.cargoClient.get(
      "/admin/integrations/accounts/iac_instagram/analytics-summary",
    );
    expect(forbiddenInstagramAnalyticsSummaryResponse.status()).toBe(403);
    const forbiddenPaymentRequestResponse = await api.viewerClient.post("/api/orders/ord_playwright/payment-request", {
      data: {
        amount: "12.55",
        currency: "TRY",
        idempotency_key: "payment_ord_playwright_forbidden",
      },
    });
    expect(forbiddenPaymentRequestResponse.status()).toBe(403);
    const forbiddenCronTriggerResponse = await api.cargoClient.post("/admin/integrations/provider-cron-triggers/ptt", {
      data: {
        idempotency_key: "cron_debug_ptt_forbidden",
      },
    });
    expect(forbiddenCronTriggerResponse.status()).toBe(403);
    const forbiddenInstagramPublishResponse = await api.cargoClient.post("/admin/integrations/instagram-publish-previews", {
      data: {
        account_public_id: null,
        image_url: "https://example.com/garanti-kulucka.jpg",
        caption: "forbidden",
        idempotency_key: "instagram_publish_forbidden",
      },
    });
    expect(forbiddenInstagramPublishResponse.status()).toBe(403);
    const forbiddenVapiTestCallResponse = await api.cargoClient.post("/api/webphone/test-call", {
      data: {
        customer_name: "Cargo User",
        customer_phone: "05051234567",
        idempotency_key: "vapi_test_forbidden",
      },
    });
    expect(forbiddenVapiTestCallResponse.status()).toBe(403);

    expect(settingsResponse.status()).toBe(200);
    const settingsBody = await settingsResponse.json();
    expect(settingsBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "instagram.access_token",
          value: null,
          is_secret: true,
        }),
      ]),
    );

    expect(webphoneResponse.status()).toBe(200);
    expect(await webphoneResponse.json()).toMatchObject({
      enabled: true,
      sip_websocket_url: "wss://sip.example.com/ws",
      sip_domain: "sip.example.com",
      sip_username: "1001",
      sip_password: "sip-secret",
      transport: "direct_sip_over_webrtc",
    });
  } finally {
    await api.close();
  }
});
