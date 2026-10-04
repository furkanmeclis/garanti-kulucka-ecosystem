import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { expect, request, test } from "@playwright/test";
import type { AppDatabase } from "../../packages/database/src/index.js";
import { createApp } from "../../apps/api/src/app.js";
import type { ApiConfig } from "../../apps/api/src/config.js";
import { signAccessToken } from "../../apps/api/src/auth/tokens.js";
import type { SecretEncryptor } from "../../apps/api/src/security/encryption.js";
import type { RealtimeEnvelope, RealtimeRoom } from "../../packages/shared/src/index.js";

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
        return orders;
      case "products":
        return products;
      case "shipments":
        return shipments;
      case "settings":
        return settings.filter((setting) => this.whereValues.get("scope") === undefined || setting.scope === this.whereValues.get("scope"));
      case "roles":
        return [{ id: 1 }];
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
        return this.whereValues.get("public_id") === conversation.public_id ? { id: conversation.id } : null;
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

  async executeTakeFirstOrThrow() {
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
  constructor(private readonly table: string) {}

  set() {
    return this;
  }

  where() {
    return this;
  }

  async execute() {
    if (this.table !== "conversations") {
      throw new Error(`Unsupported fixture update: ${this.table}`);
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
  const publishedRealtime: Array<{ room: RealtimeRoom; envelope: RealtimeEnvelope }> = [];
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

  return {
    client,
    cargoClient,
    publishedRealtime,
    async close() {
      await client.dispose();
      await cargoClient.dispose();
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
      customerResponse,
      messageResponse,
      orderResponse,
      productResponse,
      shipmentResponse,
      settingsResponse,
      webphoneResponse,
    ] =
      await Promise.all([
        api.client.get("/api/conversations?limit=10"),
        api.client.get("/api/customers?limit=10"),
        api.client.get(`/api/conversations/${conversation.public_id}/messages?limit=10`),
        api.client.get("/api/orders?limit=10"),
        api.client.get("/api/products?limit=10"),
        api.client.get("/api/shipments?limit=10"),
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

    expect(orderResponse.status()).toBe(200);
    expect(await orderResponse.json()).toMatchObject({
      data: [
        {
          order_number: "ORD-PLAYWRIGHT",
          total_amount: "125.50",
        },
      ],
    });

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
