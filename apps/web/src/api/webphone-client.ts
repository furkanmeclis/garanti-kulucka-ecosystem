import type { BackendHttpClient } from "./http-client.js";

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

export function createWebphoneClient(http: BackendHttpClient) {
  return {
    getConfig: () => http.request<WebphoneConfig>("/api/webphone/config"),
  };
}
