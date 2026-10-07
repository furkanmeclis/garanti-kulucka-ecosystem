/**
 * Admin debug read models (web parity: apps/web/src/api/debug-client.ts and the provider-attempt
 * parts of admin-client.ts). Every endpoint is admin-only and never calls a provider live.
 */

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

export type AiTrainingFormat = "text" | "jsonl" | "json";

export interface AiTrainingExportQuery {
  format: AiTrainingFormat;
  channel: string;
  answeredOnly: boolean;
  offset: number;
  limit: number;
}

export interface ProviderCatalogItem {
  provider: string;
  channels: string[];
  supported_operations: string[];
  contract_mode: string;
  live_feature_flag_key: string;
  live_call_permitted: boolean;
  live_block_reason: string | null;
}

export interface ProviderAttempt {
  public_id: string;
  provider_key: string;
  account_public_id: string | null;
  request_id: string;
  operation: string;
  direction: string;
  status: string;
  status_code: number | null;
  duration_ms: number;
  retry_decision: string;
  next_retry_at: string | null;
  idempotency_key: string | null;
  request_metadata: unknown;
  provider_request_preview: unknown;
  response_metadata: unknown;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  updated_at: string;
}

export interface ProviderRequestPreview {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  live_call_performed: false;
}

export type CronProvider = "ptt" | "surat";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only dry-run previews (`live_call_performed: false`) with a method and path are shown. */
export function requestPreview(attempt: ProviderAttempt): ProviderRequestPreview | null {
  const value = attempt.provider_request_preview;
  if (!isRecord(value) || typeof value.method !== "string" || typeof value.path !== "string" || value.live_call_performed !== false) return null;
  const headers = isRecord(value.headers) ? Object.fromEntries(Object.entries(value.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  return { method: value.method, path: value.path, headers, body: value.body ?? null, live_call_performed: false };
}

export type AttemptOutcome = "success" | "error" | "recovered";

export function attemptOutcome(attempt: Pick<ProviderAttempt, "status" | "retry_decision">): AttemptOutcome {
  if (attempt.status === "failed" || attempt.status === "error") return "error";
  if (attempt.retry_decision === "retry" || attempt.retry_decision === "retried") return "recovered";
  return "success";
}

const sensitiveKeyPattern = /authorization|token|secret|password|credential|api[_-]?key/i;

function redacted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redacted);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sensitiveKeyPattern.test(key) ? "[redacted]" : redacted(entry)]));
}

/** Defense in depth: the backend already redacts previews; the UI still masks sensitive keys. */
export function compactJson(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(redacted(value));
  } catch {
    return String(value);
  }
}

/** Counts the conversations in a downloaded training batch (legacy AIEgitimPage message). */
export function countTrainingRecords(format: AiTrainingFormat, text: string) {
  if (format === "jsonl") return text.split("\n").filter(Boolean).length;
  if (format === "json") {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  }
  return text.split("### Konuşma").length - 1;
}
