import { z } from "zod";
import { redactValue } from "./redaction.js";

export const structuredLogLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export const structuredLogSchema = z.object({
  ts: z.string().datetime(),
  level: structuredLogLevelSchema,
  service: z.enum(["api", "worker", "migrator"]),
  event: z.string().min(1),
  request_id: z.string().min(1).nullable(),
  job_id: z.string().min(1).nullable(),
  msg: z.string().min(1),
  context: z.record(z.string(), z.unknown()),
});

export type StructuredLogLevel = z.infer<typeof structuredLogLevelSchema>;
export type StructuredLogService = z.infer<typeof structuredLogSchema>["service"];
export type StructuredLog = z.infer<typeof structuredLogSchema>;

export interface StructuredLogInput {
  level: StructuredLogLevel;
  service: StructuredLogService;
  event: string;
  msg: string;
  request_id?: string | null;
  job_id?: string | null;
  context?: Record<string, unknown>;
  ts?: string;
}

export function createStructuredLog(input: StructuredLogInput): StructuredLog {
  return structuredLogSchema.parse({
    ts: input.ts ?? new Date().toISOString(),
    level: input.level,
    service: input.service,
    event: input.event,
    request_id: input.request_id ?? null,
    job_id: input.job_id ?? null,
    msg: input.msg,
    context: redactValue(input.context ?? {}),
  });
}

