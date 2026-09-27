import { z } from "zod";

export const providerNameSchema = z.enum([
  "ptt",
  "surat",
  "kolaybi",
  "whatsapp",
  "instagram",
  "messenger",
  "netgsm",
  "vapi",
  "sip",
]);

export const providerAttemptSchema = z.object({
  provider: providerNameSchema,
  operation: z.string().min(1),
  request_id: z.string().min(1),
  started_at: z.string().datetime(),
  duration_ms: z.number().int().nonnegative(),
  status: z.enum(["success", "retryable_failure", "terminal_failure"]),
});

export type ProviderName = z.infer<typeof providerNameSchema>;
export type ProviderAttempt = z.infer<typeof providerAttemptSchema>;
