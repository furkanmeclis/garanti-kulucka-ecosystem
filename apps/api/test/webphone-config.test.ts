import { describe, expect, it } from "vitest";
import { serializeWebphoneConfig, type WebphoneConfigRecord } from "../src/webphone/config.js";

describe("webphone config serialization", () => {
  it("serializes SIP config without enabling backend media proxying", () => {
    const record: WebphoneConfigRecord = {
      user: {
        public_id: "usr_test",
        sip_username: "agent100",
        sip_password_encrypted: "encrypted",
      },
      settings: {
        "webphone.enabled": true,
        "webphone.sip_websocket_url": "wss://sip.example.com/ws",
        "webphone.sip_domain": "sip.example.com",
        "webphone.ice_servers": [{ urls: "stun:stun.example.com:3478" }],
      },
    };

    expect(serializeWebphoneConfig(record, () => "sip-secret")).toEqual({
      enabled: true,
      sip_websocket_url: "wss://sip.example.com/ws",
      sip_domain: "sip.example.com",
      sip_username: "agent100",
      sip_password: "sip-secret",
      ice_servers: [{ urls: "stun:stun.example.com:3478" }],
      media_proxy_enabled: false,
      transport: "direct_sip_over_webrtc",
    });
  });
});
