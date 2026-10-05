import { z } from "zod";

export const healthStatusSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string().min(1),
  timestamp: z.string().datetime(),
  dependencies: z.record(
    z.string().min(1),
    z.object({
      status: z.enum(["ok", "degraded"]),
      latency_ms: z.number().nonnegative().optional(),
      error: z.string().min(1).optional(),
    }),
  ).optional(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
