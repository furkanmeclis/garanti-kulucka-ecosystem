import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ProviderRequestEnvelope, providerRequestEnvelopeSchema } from "@garanti-kulucka/shared";
import { buildProviderTransportPayload } from "../src/providers/payloads.js";

const contractsRoot = new URL("../../../contracts/providers", import.meta.url);

function readFixture(provider: string, fixture: string): ProviderRequestEnvelope {
  return providerRequestEnvelopeSchema.parse(
    JSON.parse(
      readFileSync(join(contractsRoot.pathname, provider, "fixtures", fixture), "utf8"),
    ),
  );
}

describe("provider transport payload builder", () => {
  it("builds cargo shipment create bodies from frozen PTT fixtures", () => {
    const envelope = readFixture("ptt", "shipment_create_minimal.json");

    expect(buildProviderTransportPayload(envelope)).toMatchObject({
      provider: "ptt",
      operation: "shipment.create",
      direction: "outbound",
      channel: "cargo",
      body: {
        order_public_id: "ord_fixture_1",
        recipient: {
          recipient_name: "Fixture Customer",
          recipient_phone: "+905550000000",
        },
      },
    });
  });

  it("builds outbound provider bodies without provider credentials", () => {
    expect(buildProviderTransportPayload(readFixture("ptt", "shipment_track_minimal.json")).body).toEqual({
      tracking_number: "PTT fixture tracking",
    });
    expect(buildProviderTransportPayload(readFixture("surat", "shipment_track_minimal.json")).body).toEqual({
      tracking_number: "SR fixture tracking",
    });
    expect(buildProviderTransportPayload(readFixture("surat", "shipment_create_minimal.json")).body).toEqual({
      order_public_id: "ord_fixture_2",
      recipient: {
        recipient_name: "Fixture Customer",
        recipient_phone: "+905550000001",
      },
    });
    expect(buildProviderTransportPayload(readFixture("kolaybi", "invoice_create_minimal.json")).body).toEqual({
      order_public_id: "ord_fixture_1",
      currency: "TRY",
      total_amount: "100.00",
    });
    expect(buildProviderTransportPayload(readFixture("netgsm", "sms_send_minimal.json")).body).toEqual({
      recipient_phone: "+905550000000",
      message: "Fixture SMS",
    });
  });

  it("builds direct messaging send bodies from frozen fixtures", () => {
    expect(buildProviderTransportPayload(readFixture("whatsapp", "message_send_minimal.json")).body).toEqual({
      conversation_public_id: "conv_whatsapp_demo",
      recipient_id: "905551112233",
      message: "Merhaba, talebiniz alindi.",
      idempotency_key: "msg_whatsapp_demo_001",
    });
    expect(buildProviderTransportPayload(readFixture("instagram", "message_send_minimal.json")).body).toEqual({
      conversation_public_id: "conv_instagram_demo",
      recipient_id: "17841400000000000",
      message: "Merhaba, mesajiniz alindi.",
      idempotency_key: "msg_instagram_demo_001",
    });
    expect(buildProviderTransportPayload(readFixture("messenger", "message_send_minimal.json")).body).toEqual({
      conversation_public_id: "conv_messenger_demo",
      recipient_id: "psid_messenger_demo",
      message: "Merhaba, mesajinizi aldik.",
      idempotency_key: "msg_messenger_demo_001",
    });
  });

  it("preserves inbound webhook bodies as fixture-normalized payloads", () => {
    expect(buildProviderTransportPayload(readFixture("meta", "message_webhook_minimal.json")).body).toEqual({
      object: "instagram",
      entry: [],
    });
    expect(buildProviderTransportPayload(readFixture("whatsapp", "message_webhook_minimal.json")).body).toMatchObject({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_fixture_1",
        },
      ],
    });
    expect(buildProviderTransportPayload(readFixture("instagram", "message_webhook_minimal.json")).body).toMatchObject({
      object: "instagram",
      entry: [
        {
          id: "ig_fixture_account_1",
        },
      ],
    });
    expect(buildProviderTransportPayload(readFixture("messenger", "message_webhook_minimal.json")).body).toMatchObject({
      object: "page",
      entry: [
        {
          id: "page_fixture_1",
        },
      ],
    });
    expect(buildProviderTransportPayload(readFixture("vapi", "call_webhook_minimal.json")).body).toEqual({
      type: "call-ended",
      call: {
        id: "call_fixture_1",
      },
    });
  });

  it("keeps SIP config sync durable without exposing raw secrets", () => {
    expect(buildProviderTransportPayload(readFixture("sip", "config_sync_minimal.json")).body).toEqual({
      user_public_id: "usr_fixture_1",
      sip_username: "fixture-extension",
      password_state: "encrypted",
    });
  });

  it("rejects secret-looking payload keys before attempt metadata is persisted", () => {
    const envelope = readFixture("netgsm", "sms_send_minimal.json");

    expect(() =>
      buildProviderTransportPayload({
        ...envelope,
        payload: {
          ...envelope.payload,
          access_token: "never-persist-this",
        },
      }),
    ).toThrow("secret-looking key");
  });

  it("rejects transport payloads for channels outside the provider boundary", () => {
    const envelope = readFixture("ptt", "shipment_create_minimal.json");

    expect(() =>
      buildProviderTransportPayload({
        ...envelope,
        channel: "sms",
      }),
    ).toThrow("Provider channel is not registered");
  });
});
