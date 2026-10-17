export interface WebphoneConfig {
  enabled: boolean;
  sip_websocket_url: string | null;
  sip_domain: string | null;
  sip_username: string | null;
  sip_password: string | null;
  ice_servers: unknown[];
}
export interface CallContext {
  order_public_id?: string | null;
  customer_public_id?: string | null;
}
export interface ClientCallEvent extends CallContext {
  direction: "outbound" | "inbound";
  phone: string;
  started_at: string;
  ended_at: string;
  client_status: "answered" | "failed" | "busy" | "no_answer" | "cancelled";
  talk_seconds: number;
}
