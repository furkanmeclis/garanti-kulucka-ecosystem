import { z } from "zod";

export const callDirectionSchema = z.enum(["inbound", "outbound", "internal"]);
export const callStatusSchema = z.enum([
  "answered",
  "missed",
  "busy",
  "timeout",
  "failed",
  "cancelled",
]);
export const callLogClientEventRequestSchema = z
  .object({
    direction: z.enum(["outbound", "inbound"]),
    phone: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[+\d\s()-]+$/),
    order_public_id: z.string().min(1).max(100).nullable().optional(),
    customer_public_id: z.string().min(1).max(100).nullable().optional(),
    started_at: z.string().datetime({ offset: true }),
    ended_at: z.string().datetime({ offset: true }),
    client_status: z.enum([
      "answered",
      "failed",
      "busy",
      "no_answer",
      "cancelled",
    ]),
    talk_seconds: z.number().int().min(0).max(86400),
  })
  .refine((v) => Date.parse(v.ended_at) >= Date.parse(v.started_at), {
    message: "ended_at precedes started_at",
  });
export type CallLogClientEventRequest = z.infer<
  typeof callLogClientEventRequestSchema
>;
export interface CallLogClientEventResponse {
  call_log: CallLog;
}
export interface CallLog {
  public_id: string;
  direction: z.infer<typeof callDirectionSchema> | null;
  status: z.infer<typeof callStatusSchema> | null;
  caller: string | null;
  callee: string | null;
  internal_number: string | null;
  customer_number: string | null;
  talk_seconds: number | null;
  hold_seconds: number | null;
  initiated_at: string | null;
  connected_at: string | null;
  ended_at: string | null;
  user_public_id: string | null;
  user_name: string | null;
  customer_public_id: string | null;
  order_public_id: string | null;
  has_recording: boolean;
  source: "netgsm_webhook" | "netgsm_report" | "softphone" | "legacy";
}
export interface CallLogListResponse {
  data: CallLog[];
  total_count: number;
  limit: number;
  offset: number;
}
export const callLogListQuerySchema = z.object({
  direction: callDirectionSchema.optional(),
  status: callStatusSchema.optional(),
  user: z.string().min(1).optional(),
  date_from: z.string().datetime({ offset: true }).optional(),
  date_to: z.string().datetime({ offset: true }).optional(),
  customer_public_id: z.string().min(1).optional(),
  order_public_id: z.string().min(1).optional(),
  missed_only: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type CallLogListQuery = z.infer<typeof callLogListQuerySchema>;
