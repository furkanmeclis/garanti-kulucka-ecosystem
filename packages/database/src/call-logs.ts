import { createHash, randomUUID } from "node:crypto";
import { sql, type Selectable, type Insertable } from "kysely";
import type { AppDatabase } from "./index.js";
import type { CallLogsTable } from "./schema.js";

type Call = Selectable<CallLogsTable>;
type Source = Call["source"];
export const santralScenarios = [
  "Inbound_call",
  "Outbound_call",
  "Local_call",
  "Answer",
  "Hangup",
  "Queue",
  "InboundtoPBX",
  "Context",
  "DTMF",
  "QueueLeave",
  "cdr",
];
export function phoneLast10(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "").slice(-10);
}
function text(v: unknown): string | null {
  return (typeof v === "string" || typeof v === "number") && String(v).trim()
    ? String(v).trim()
    : null;
}
function seconds(v: unknown): number | null {
  const n = Number(v);
  return v !== undefined && v !== null && Number.isFinite(n)
    ? Math.max(0, Math.trunc(n))
    : null;
}
/** NetGSM local date strings are Istanbul time. Numeric webhook timestamps are seconds or milliseconds. */
export function callTimestamp(v: unknown): string | null {
  let s = text(v);
  if (!s) return null;
  if (/^\d{10,13}$/.test(s))
    s = new Date(Number(s) * (s.length === 10 ? 1000 : 1)).toISOString();
  if (/^\d{2}\.\d{2}\.\d{4}/.test(s))
    s = s.replace(/^(\d{2})\.(\d{2})\.(\d{4})/, "$3-$2-$1");
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(s))
    s = s.replace(" ", "T") + "+03:00";
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
export function normalizeCallPayload(
  p: Record<string, unknown>,
  source: Source,
) {
  const report = source === "netgsm_report";
  const scenario = text(p.scenario) ?? (report ? "report" : "client");
  const directionCode = text(report ? p.direction : p.yon);
  const direction: Call["direction"] = report
    ? ((
        {
          "0": "outbound",
          "1": "inbound",
          "2": "inbound",
          "3": "outbound",
          "4": "internal",
          "5": "internal",
        } as const
      )[directionCode ?? ""] ?? null)
    : (({ "1": "inbound", "2": "outbound" } as const)[directionCode ?? ""] ??
      (scenario === "Local_call"
        ? "internal"
        : scenario === "Outbound_call"
          ? "outbound"
          : ["Inbound_call", "InboundtoPBX", "Queue"].includes(scenario)
            ? "inbound"
            : null));
  const caller =
    text(p.arayan ?? p.source) ??
    text(
      direction === "outbound" || direction === "internal"
        ? p.internal_num
        : direction === "inbound"
          ? p.customer_num
          : null,
    );
  const callee =
    text(p.aranan ?? p.destination) ??
    text(
      direction === "outbound"
        ? p.customer_num
        : direction === "inbound" || direction === "internal"
          ? p.internal_num
          : null,
    );
  const internal =
    text(p.internal_num) ??
    (direction === "outbound" || direction === "internal"
      ? caller
      : direction === "inbound"
        ? callee
        : null);
  const internalNumber =
    internal && /^\d{1,6}$/.test(internal)
      ? internal
      : scenario === "Inbound_call" && /^\d{1,6}$/.test(String(p.pbx_num))
        ? String(p.pbx_num)
        : null;
  const time = callTimestamp(p.timestamp);
  const initiated =
    callTimestamp(p.callInitiatedTime ?? p.bas ?? p.date) ??
    (["Inbound_call", "Outbound_call", "Local_call", "InboundtoPBX"].includes(
      scenario,
    )
      ? time
      : null);
  const status: Call["status"] = report
    ? ["0", "1", "2", "3", "4", "5"].includes(directionCode ?? "")
      ? ["2", "3", "5"].includes(directionCode ?? "")
        ? "missed"
        : "answered"
      : null
    : ((
        {
          "1": "answered",
          "2": "missed",
          "3": "busy",
          "4": "timeout",
          "5": "failed",
        } as const
      )[text(p.sondurum) ?? ""] ?? (scenario === "Answer" ? "answered" : null));
  return {
    unique_id: text(p.unique_id ?? p.uniqueid ?? p.kimlik),
    common_id: text(p.ortakkimlik ?? p.commonID),
    asterisk_id: text(p.asteriskId),
    direction,
    status: status as Call["status"],
    caller,
    callee,
    clid: text(p.clid ?? p.directory),
    internal_number: internalNumber,
    customer_number:
      text(p.customer_num) ??
      (direction === "inbound"
        ? caller
        : direction === "outbound"
          ? callee
          : null),
    incoming_number:
      text(p.incoming_number ?? p.santral) ??
      ((text(p.pbx_num) ?? "").replace(/\D/g, "").length >= 7
        ? text(p.pbx_num)
        : null),
    trunk: text(p.trunk ?? p.line),
    queue_name: text(p.queue_name),
    context_name: text(p.context_name ?? p.Context),
    dtmf_digits: text(p.digit ?? p.Digit),
    talk_seconds: seconds(p.talktime ?? p.sure ?? p.duration),
    hold_seconds: seconds(p.holdtime),
    initiated_at: initiated,
    queued_at:
      callTimestamp(p.callQueuedTime) ?? (scenario === "Queue" ? time : null),
    connected_at:
      callTimestamp(p.callConnectedTime) ??
      (scenario === "Answer" ? time : null),
    ended_at:
      callTimestamp(p.callEndedTime) ?? (scenario === "Hangup" ? time : null),
    recording_url: text(p.seskaydi ?? p.recording),
  };
}
export interface ClientCallInput {
  direction: "outbound" | "inbound";
  phone: string;
  started_at: string;
  ended_at: string;
  client_status: "answered" | "failed" | "busy" | "no_answer" | "cancelled";
  talk_seconds: number;
  order_public_id?: string | null | undefined;
  customer_public_id?: string | null | undefined;
}
export class CallLinkError extends Error {}

/** Shared API/worker persistence, including serialization of concurrent CDR/client deliveries. */
export class CallLogsRepository {
  constructor(readonly db: AppDatabase) {}
  async webhookToken() {
    const row = await this.db
      .selectFrom("settings")
      .select("value")
      .where("scope", "=", "global")
      .where("key", "=", "netgsm.santral_webhook_token")
      .executeTakeFirst();
    return typeof row?.value === "string" ? row.value : null;
  }
  async recordEvent(payload: Record<string, unknown>, status: string) {
    const provider = await this.db
      .selectFrom("integration_providers")
      .select("id")
      .where("key", "=", "netgsm")
      .executeTakeFirstOrThrow();
    const raw = JSON.stringify(payload);
    return this.db
      .insertInto("webhook_events")
      .values({
        public_id: `whe_${randomUUID()}`,
        provider_id: provider.id,
        account_id: null,
        event_type: `santral.${text(payload.scenario) ?? "unknown"}`,
        external_event_id: null,
        status,
        payload_hash: createHash("sha256").update(raw).digest("hex"),
        raw_payload: raw,
        processed_at: status === "received" ? null : new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }
  async ingest(
    payload: Record<string, unknown>,
    source: Source,
    client?: { userId: number; input: ClientCallInput },
  ) {
    return this.db.transaction().execute(async (db) => {
      // Webhook IDs differ between scenarios and CDR; also serialize opposite arrival orders of browser/CDR.
      await sql`SELECT pg_advisory_xact_lock(734030)`.execute(db);
      let normalized = normalizeCallPayload(payload, source);
      let userId: number | null = client?.userId ?? null;
      if (client) {
        const user = await db
          .selectFrom("users")
          .select("sip_extension")
          .where("id", "=", client.userId)
          .executeTakeFirstOrThrow();
        const i = client.input;
        normalized = {
          ...normalized,
          unique_id: null,
          direction: i.direction,
          status: i.client_status === "no_answer" ? "missed" : i.client_status,
          internal_number: user.sip_extension,
          customer_number: i.phone,
          initiated_at: i.started_at,
          ended_at: i.ended_at,
          talk_seconds: i.talk_seconds,
          caller: i.direction === "outbound" ? user.sip_extension : i.phone,
          callee: i.direction === "outbound" ? i.phone : user.sip_extension,
        };
      } else if (normalized.internal_number) {
        const user = await db
          .selectFrom("users")
          .select("id")
          .where("sip_extension", "=", normalized.internal_number)
          .orderBy("id")
          .executeTakeFirst();
        userId = user?.id ?? null;
      }
      let customerId: number | null = null;
      let orderId: number | null = null;
      if (client?.input.customer_public_id) {
        const c = await db
          .selectFrom("customers")
          .select(["id", "phone"])
          .where("public_id", "=", client.input.customer_public_id)
          .executeTakeFirst();
        if (
          !c ||
          phoneLast10(c.phone) !== phoneLast10(normalized.customer_number)
        )
          throw new CallLinkError("Customer phone does not match");
        customerId = c.id;
      } else if (phoneLast10(normalized.customer_number).length === 10) {
        const c = await db
          .selectFrom("customers")
          .select("id")
          .where(
            sql<string>`right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)`,
            "=",
            phoneLast10(normalized.customer_number),
          )
          .orderBy("id")
          .executeTakeFirst();
        customerId = c?.id ?? null;
      }
      if (client?.input.order_public_id) {
        const order = await db
          .selectFrom("orders")
          .select(["id", "customer_id"])
          .where("public_id", "=", client.input.order_public_id)
          .where("deleted_at", "is", null)
          .executeTakeFirst();
        if (!order || (customerId !== null && order.customer_id !== customerId))
          throw new CallLinkError("Order customer does not match");
        const customer = await db
          .selectFrom("customers")
          .select("phone")
          .where("id", "=", order.customer_id)
          .executeTakeFirst();
        if (
          phoneLast10(customer?.phone) !==
          phoneLast10(normalized.customer_number)
        )
          throw new CallLinkError("Order phone does not match");
        orderId = order.id;
        customerId = order.customer_id;
      }
      let existing: Call | undefined;
      if (normalized.unique_id || normalized.asterisk_id) {
        existing = await db
          .selectFrom("call_logs")
          .selectAll()
          .where((e) =>
            e.or([
              ...(normalized.unique_id
                ? [
                    e("unique_id", "=", normalized.unique_id),
                    e(
                      sql<string>`regexp_replace(asterisk_id, '^sip[0-9]+-', '')`,
                      "=",
                      normalized.unique_id,
                    ),
                  ]
                : []),
              ...(normalized.asterisk_id
                ? [
                    e("asterisk_id", "=", normalized.asterisk_id),
                    e(
                      "unique_id",
                      "=",
                      normalized.asterisk_id.replace(/^sip\d+-/, ""),
                    ),
                  ]
                : []),
            ]),
          )
          .orderBy("id")
          .executeTakeFirst();
      }
      const time =
        normalized.initiated_at ?? existing?.initiated_at?.toISOString();
      // Match only one nearest call; never combine two different NetGSM calls merely because numbers match.
      if (!existing && userId && normalized.customer_number && time) {
        let query = db
          .selectFrom("call_logs")
          .selectAll()
          .where("user_id", "=", userId)
          .where("direction", "=", normalized.direction)
          .where(
            sql<string>`right(regexp_replace(customer_number, '[^0-9]', '', 'g'), 10)`,
            "=",
            phoneLast10(normalized.customer_number),
          )
          .where("initiated_at", ">=", new Date(Date.parse(time) - 120000))
          .where("initiated_at", "<=", new Date(Date.parse(time) + 120000));
        query = client
          ? query.where("source", "in", [
              "softphone",
              "netgsm_webhook",
              "netgsm_report",
            ]).where(sql<boolean>`
              NOT EXISTS (SELECT 1 FROM jsonb_array_elements(events) event WHERE event->>'source' = 'softphone')
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(events) event WHERE event->>'source' = 'softphone'
                AND (event->'payload'->>'started_at')::timestamptz = ${client.input.started_at}::timestamptz)
            `)
          : query
              .where("source", "=", "softphone")
              .where("unique_id", "is", null);
        existing = await query
          .orderBy(
            sql`abs(extract(epoch from (initiated_at - ${time}::timestamptz)))`,
          )
          .executeTakeFirst();
      }
      // An early provider event may lack the extension; consolidate its row once a later CDR identifies the agent.
      const mergeUser = userId ?? existing?.user_id;
      const mergePhone =
        normalized.customer_number ?? existing?.customer_number;
      const mergeDirection = normalized.direction ?? existing?.direction;
      if (
        existing &&
        existing.source !== "softphone" &&
        !(
          Array.isArray(existing.events) &&
          existing.events.some(
            (event: { source?: string }) => event.source === "softphone",
          )
        ) &&
        !client &&
        mergeUser &&
        mergePhone &&
        time &&
        mergeDirection
      ) {
        const soft = await db
          .selectFrom("call_logs")
          .selectAll()
          .where("source", "=", "softphone")
          .where("unique_id", "is", null)
          .where("id", "!=", existing.id)
          .where("user_id", "=", mergeUser)
          .where("direction", "=", mergeDirection)
          .where(
            sql<string>`right(regexp_replace(customer_number, '[^0-9]', '', 'g'), 10)`,
            "=",
            phoneLast10(mergePhone),
          )
          .where("initiated_at", ">=", new Date(Date.parse(time) - 120000))
          .where("initiated_at", "<=", new Date(Date.parse(time) + 120000))
          .orderBy(
            sql`abs(extract(epoch from (initiated_at - ${time}::timestamptz)))`,
          )
          .executeTakeFirst();
        if (soft) {
          existing = {
            ...existing,
            order_id: existing.order_id ?? soft.order_id,
            customer_id: existing.customer_id ?? soft.customer_id,
            events: [
              ...(Array.isArray(soft.events) ? soft.events : []),
              ...(Array.isArray(existing.events) ? existing.events : []),
            ],
          };
          await db.deleteFrom("call_logs").where("id", "=", soft.id).execute();
        }
      }
      const eventHash = createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");
      const events = Array.isArray(existing?.events)
        ? (existing.events as Array<Record<string, unknown>>)
        : [];
      if (events.some((e) => e.hash === eventHash)) return existing!;
      const event = {
        hash: eventHash,
        source,
        received_at: new Date().toISOString(),
        payload,
      };
      const fields = Object.fromEntries(
        Object.entries(normalized).filter(([, v]) => v !== null),
      ) as Partial<Insertable<CallLogsTable>>;
      if (
        existing &&
        source === "netgsm_report" &&
        existing.source === "netgsm_webhook"
      ) {
        // Reconciliation fills gaps without replacing authoritative webhook fields.
        for (const key of Object.keys(fields) as Array<keyof typeof fields>)
          if (existing[key] !== null) delete fields[key];
      }
      if (existing && client && existing.source !== "softphone") {
        for (const key of Object.keys(fields) as Array<keyof typeof fields>)
          if (existing[key] !== null) delete fields[key];
      }
      if (
        existing &&
        source === "netgsm_webhook" &&
        payload.scenario !== "cdr" &&
        events.some(
          (e) => (e.payload as Record<string, unknown>)?.scenario === "cdr",
        )
      ) {
        delete fields.status;
        delete fields.talk_seconds;
        delete fields.direction;
      }
      if (existing && normalized.dtmf_digits && payload.scenario === "DTMF")
        fields.dtmf_digits =
          (existing.dtmf_digits ?? "") + normalized.dtmf_digits;
      if (existing)
        return db
          .updateTable("call_logs")
          .set({
            ...fields,
            user_id: userId ?? existing.user_id,
            customer_id: customerId ?? existing.customer_id,
            order_id: existing.order_id ?? orderId,
            source:
              existing.source === "netgsm_webhook" || client
                ? existing.source
                : source,
            raw_payload: JSON.stringify({
              ...(existing.raw_payload as object),
              ...payload,
            }),
            events: JSON.stringify([...events, event]),
            updated_at: new Date(),
          })
          .where("id", "=", existing.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      return db
        .insertInto("call_logs")
        .values({
          ...normalized,
          public_id: `cal_${randomUUID()}`,
          source,
          user_id: userId,
          customer_id: customerId,
          order_id: orderId,
          recording_file_id: null,
          missed_notified_at: null,
          raw_payload: JSON.stringify(payload),
          events: JSON.stringify([event]),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }
  async claimMissedNotification(id: number) {
    return this.db
      .updateTable("call_logs")
      .set({ missed_notified_at: new Date() })
      .where("id", "=", id)
      .where("direction", "=", "inbound")
      .where("status", "=", "missed")
      .where("missed_notified_at", "is", null)
      .returning("public_id")
      .executeTakeFirst();
  }
}
