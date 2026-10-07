import { createTransport } from "nodemailer";
import type { JobEnvelope, ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptSchema } from "@garanti-kulucka/shared";
import type { ProviderAccountConfig } from "./account-config.js";
import { providerAttemptCorrelationMetadata } from "./correlation.js";
import { decideProviderRetry, type ProviderRetryDecision } from "./retry.js";
import type { LiveProviderTransportPolicy } from "./transport-policy.js";

/**
 * Transactional e-mail over SMTP (legacy Supabase auth e-mails such as the password reset link).
 * The account carries host / port / secure / from_address / from_name / username settings and the
 * `password` token. The message body is never written to the attempt (it can carry one-time links).
 */

export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SmtpConnection {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  timeout_ms: number;
}

export interface SmtpSendResult {
  message_id: string | null;
  accepted: string[];
  rejected: string[];
}

export type SmtpTransport = (connection: SmtpConnection, message: SmtpMessage) => Promise<SmtpSendResult>;

export interface SmtpLiveAdapterInput {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  accountConfig: ProviderAccountConfig;
  policy: LiveProviderTransportPolicy;
  attemptNumber: number;
  maxAttempts: number;
  transport?: SmtpTransport;
  now?: Date;
}

export interface SmtpLiveAdapterResult {
  attempt: ProviderAttempt;
  response_payload: Record<string, unknown>;
}

export class SmtpLiveTransportError extends Error {
  constructor(
    message: string,
    readonly attempt: ProviderAttempt,
  ) {
    super(message);
    this.name = "SmtpLiveTransportError";
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function setting(settings: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = text(settings[key]);
    if (value) return value;
  }
  return "";
}

function maskEmail(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return domain ? `${local.slice(0, 2)}***@${domain}` : "***";
}

export const defaultSmtpTransport: SmtpTransport = async (connection, message) => {
  const transporter = createTransport({
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    auth: connection.username ? { user: connection.username, pass: connection.password } : undefined,
    connectionTimeout: connection.timeout_ms,
    greetingTimeout: connection.timeout_ms,
    socketTimeout: connection.timeout_ms,
  });
  const info = await transporter.sendMail(message);
  return {
    message_id: typeof info.messageId === "string" ? info.messageId : null,
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
  };
};

function connectionFor(input: SmtpLiveAdapterInput): SmtpConnection {
  const settings = input.accountConfig.settings;
  const host = setting(settings, ["host", "smtp.host"]);
  if (!host) throw new Error("SMTP host is not configured");
  const port = Number.parseInt(setting(settings, ["port", "smtp.port"]) || "587", 10);
  const secureSetting = settings.secure ?? settings["smtp.secure"];
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: secureSetting === true || secureSetting === "true" || port === 465,
    username: setting(settings, ["username", "user", "smtp.username"]),
    password: text(input.accountConfig.tokens.password ?? input.accountConfig.tokens.smtp_password),
    timeout_ms: input.policy.timeout_ms,
  };
}

function messageFor(input: SmtpLiveAdapterInput): SmtpMessage {
  const payload = input.envelope.payload;
  const to = text(payload.to);
  if (!to.includes("@")) throw new Error("SMTP recipient is missing");
  const fromAddress = setting(input.accountConfig.settings, ["from_address", "from", "smtp.from_address"]);
  if (!fromAddress) throw new Error("SMTP from_address is not configured");
  const fromName = setting(input.accountConfig.settings, ["from_name", "smtp.from_name"]);
  const html = text(payload.html);
  return {
    from: fromName ? `"${fromName.replace(/"/g, "")}" <${fromAddress}>` : fromAddress,
    to,
    subject: text(payload.subject) || "Garanti Kuluçka",
    text: text(payload.text),
    ...(html ? { html } : {}),
  };
}

function retryDecision(input: SmtpLiveAdapterInput, endedAt: Date, errorCode: string): ProviderRetryDecision {
  return decideProviderRetry(
    {
      operation: input.envelope.operation,
      error_code: errorCode,
      attempt_number: input.attemptNumber,
      max_attempts: input.maxAttempts,
      idempotency_key: typeof input.envelope.payload.idempotency_key === "string" ? input.envelope.payload.idempotency_key : null,
    },
    endedAt,
  );
}

function createAttempt(input: {
  adapter: SmtpLiveAdapterInput;
  startedAt: Date;
  endedAt: Date;
  status: ProviderAttempt["status"];
  retryDecision: ProviderAttempt["retry_decision"];
  nextRetryAt: string | null;
  connection: Pick<SmtpConnection, "host" | "port" | "secure"> | null;
  recipient: string;
  response: Record<string, unknown>;
  error: ProviderAttempt["error"];
}): ProviderAttempt {
  const { envelope, job } = input.adapter;
  return providerAttemptSchema.parse({
    provider: envelope.provider,
    operation: envelope.operation,
    direction: envelope.direction,
    request_id: envelope.request_id,
    account_public_id: envelope.account_public_id,
    started_at: input.startedAt.toISOString(),
    duration_ms: Math.max(0, input.endedAt.getTime() - input.startedAt.getTime()),
    status: input.status,
    status_code: null,
    retry_decision: input.retryDecision,
    next_retry_at: input.nextRetryAt,
    idempotency_key: typeof envelope.payload.idempotency_key === "string" ? envelope.payload.idempotency_key : null,
    request_metadata: {
      ...providerAttemptCorrelationMetadata(job, envelope),
      queue: job.queue,
      channel: envelope.channel,
      live_call_performed: true,
      transport: "smtp",
      request: {
        host: input.connection?.host ?? null,
        port: input.connection?.port ?? null,
        secure: input.connection?.secure ?? null,
        to: maskEmail(input.recipient),
        template: text(envelope.payload.template) || null,
      },
    },
    response_metadata: input.response,
    error: input.error,
  });
}

export async function sendSmtpLiveRequest(input: SmtpLiveAdapterInput): Promise<SmtpLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  if (input.envelope.operation !== "email.send") throw new Error(`Unsupported SMTP operation: ${input.envelope.operation}`);
  const recipient = text(input.envelope.payload.to);
  let connection: SmtpConnection | null = null;
  try {
    connection = connectionFor(input);
    const message = messageFor(input);
    const result = await (input.transport ?? defaultSmtpTransport)(connection, message);
    if (result.accepted.length === 0) throw Object.assign(new Error("SMTP server rejected the recipient"), { code: "recipient_rejected" });
    const endedAt = input.now ? new Date(input.now) : new Date();
    return {
      response_payload: { success: true, message_sent: true, message_id: result.message_id },
      attempt: createAttempt({
        adapter: input,
        startedAt,
        endedAt,
        status: "success",
        retryDecision: "none",
        nextRetryAt: null,
        connection,
        recipient,
        response: { live_call_performed: true, accepted: true, message_id: result.message_id, accepted_count: result.accepted.length, rejected_count: result.rejected.length },
        error: null,
      }),
    };
  } catch (error) {
    const endedAt = input.now ? new Date(input.now) : new Date();
    const code = typeof (error as { code?: unknown }).code === "string" ? String((error as { code: string }).code).toLowerCase() : "smtp_error";
    const decision = retryDecision(input, endedAt, code);
    const message = error instanceof Error ? error.message : "SMTP send failed";
    const attempt = createAttempt({
      adapter: input,
      startedAt,
      endedAt,
      status: decision.status,
      retryDecision: decision.retry_decision,
      nextRetryAt: decision.next_retry_at,
      connection,
      recipient,
      response: { live_call_performed: true, accepted: false },
      error: { code, message },
    });
    throw new SmtpLiveTransportError(message, attempt);
  }
}
