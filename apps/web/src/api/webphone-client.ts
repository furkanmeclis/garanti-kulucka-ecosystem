import type { BackendHttpClient } from "./http-client.js";
import type { ProviderAttempt } from "./admin-client.js";

export interface WebphoneConfig {
  enabled: boolean;
  sip_websocket_url: string | null;
  sip_domain: string | null;
  sip_username: string | null;
  sip_password: string | null;
  ice_servers: unknown[];
  media_proxy_enabled: false;
  transport: "direct_sip_over_webrtc";
}

export interface WebphoneTestCallRequest {
  customer_name: string;
  customer_phone: string;
  cargo_provider: string;
  tracking_number: string;
  last_event_text: string;
  idempotency_key: string;
}

export function createWebphoneClient(http: BackendHttpClient) {
  return {
    getConfig: () => http.request<WebphoneConfig>("/api/webphone/config"),
    createTestCall: (input: WebphoneTestCallRequest) =>
      http.request<ProviderAttempt>("/api/webphone/test-call", {
        method: "POST",
        body: input,
      }),
  };
}
