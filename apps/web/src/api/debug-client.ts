import type { BackendHttpClient } from "./http-client.js";

export interface DebugWebhookEvent {
  public_id: string;
  provider: string;
  event_type: string;
  status: string;
  received_at: string;
  processed_at: string | null;
  preview: string;
}

export interface DebugProviderAttempt {
  request_id: string;
  provider: string;
  operation: string;
  status: string;
  status_code: number | null;
  duration_ms: number;
  error_message: string | null;
  started_at: string;
}

export interface DebugProviderAccount {
  provider: string;
  account_public_id: string;
  display_name: string;
  status: string;
  external_account_id: string | null;
  access_token_configured: boolean;
  verify_token_configured: boolean;
  account_live_mode: boolean | null;
  live_call_permitted: boolean;
  phone_number_id?: string | null;
  waba_id?: string | null;
  display_phone_number?: string | null;
}

export interface ChannelStats {
  conversation_count: number;
  today_inbound: number;
  today_outbound: number;
}

export interface WhatsappDebug {
  live_gate: string;
  provider_live_mode: boolean;
  callback_path: string;
  config: DebugProviderAccount | null;
  stats: ChannelStats;
  webhooks: DebugWebhookEvent[];
  attempts: DebugProviderAttempt[];
}

export interface InstagramDebug {
  live_gates: Record<string, string>;
  provider_live_mode: Record<string, boolean>;
  callback_paths: Record<string, string>;
  accounts: DebugProviderAccount[];
  stats: ChannelStats;
  webhooks: DebugWebhookEvent[];
  attempts: DebugProviderAttempt[];
}

export interface AiDebug {
  config: { provider: string; auto_reply_enabled: boolean; model: string | null; system_prompt_source: "database" | "default"; system_prompt_length: number; live_call_permitted: boolean; dry_run: boolean };
  stats: { today_ai_replies: number; total_ai_replies: number };
  recent: Array<{ public_id: string; body: string | null; sent_at: string; conversation_public_id: string; channel: string; customer_name: string | null; customer_phone: string | null }>;
}

export interface AiTrainingStats {
  total: number;
  by_channel: Record<string, number>;
  answered_only: boolean;
}

export function createDebugClient(http: BackendHttpClient) {
  return {
    whatsapp: () => http.request<WhatsappDebug>("/api/debug/whatsapp"),
    whatsappTestSend: (to: string, idempotencyKey: string) =>
      http.request<{ request_id: string; queued: boolean; live_call_permitted: boolean }>("/api/debug/whatsapp/test-send", {
        method: "POST",
        body: { to, idempotency_key: idempotencyKey },
      }),
    /** Replays Meta's GET verification against the public webhook route and returns the raw body. */
    verifyWebhook: async (path: string, verifyToken: string, challenge: string) => {
      if (!http.requestBlob) throw new Error("Webhook test is not supported by this client");
      const query = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": verifyToken, "hub.challenge": challenge });
      return (await http.requestBlob(`${path}?${query.toString()}`)).text();
    },
    instagram: () => http.request<InstagramDebug>("/api/debug/instagram"),
    ai: () => http.request<AiDebug>("/api/debug/ai"),
    aiTest: (message: string) => http.request<{ reply: string; dry_run: boolean }>("/api/debug/ai/test", { method: "POST", body: { message } }),
    trainingStats: (answeredOnly: boolean) => http.request<AiTrainingStats>(`/api/debug/ai-training/stats?answered_only=${answeredOnly}`),
    trainingExport: async (params: { format: string; channel: string; answeredOnly: boolean; offset: number; limit: number }) => {
      if (!http.requestBlob) throw new Error("Export is not supported by this client");
      const query = new URLSearchParams({ format: params.format, answered_only: String(params.answeredOnly), offset: String(params.offset), limit: String(params.limit) });
      if (params.channel) query.set("channel", params.channel);
      return http.requestBlob(`/api/debug/ai-training/export?${query.toString()}`);
    },
  };
}

export type DebugClient = ReturnType<typeof createDebugClient>;
