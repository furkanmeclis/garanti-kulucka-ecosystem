import { netgsmTokenMatches } from "../webhooks/security.js";
import { clientIp, rateLimit } from "./rate-limit.js";
import { Hono } from "hono";
import {
  CallLogsRepository,
  CallLinkError,
  santralScenarios,
  sql,
} from "@garanti-kulucka/database";
import {
  callLogClientEventRequestSchema,
  callLogListQuerySchema,
} from "@garanti-kulucka/shared";
import type {
  AppDatabase,
  CallLogsTable,
  Selectable,
} from "@garanti-kulucka/database";
import { isAdminRole } from "../auth/repository.js";
import { authenticate, requireDatabase } from "./middleware.js";
import type { AppBindings } from "./types.js";
import { createMediaStorageFromEnv } from "../files/storage.js";

export function recordingArchiveJob(publicId: string) {
  return {
    job_id: `job_recording_${publicId}`,
    queue: "provider-delivery" as const,
    name: "netgsm.call.recording.archive",
    payload: { call_log_public_id: publicId },
    requested_at: new Date().toISOString(),
  };
}
export function callLogQuery(db: AppDatabase, actorId: number, all: boolean) {
  let query = db
    .selectFrom("call_logs")
    .leftJoin("users", "users.id", "call_logs.user_id")
    .leftJoin("customers", "customers.id", "call_logs.customer_id")
    .leftJoin("orders", "orders.id", "call_logs.order_id")
    .selectAll("call_logs")
    .select([
      "users.public_id as user_public_id",
      "customers.public_id as customer_public_id",
      "orders.public_id as order_public_id",
      sql<string | null>`concat_ws(' ', users.first_name, users.last_name)`.as(
        "user_name",
      ),
    ]);
  if (!all) query = query.where("call_logs.user_id", "=", actorId);
  return query;
}
export function serializeCall(
  row: Selectable<CallLogsTable> & {
    user_public_id?: string | null;
    customer_public_id?: string | null;
    order_public_id?: string | null;
    user_name?: string | null;
  },
) {
  const {
    id: _id,
    user_id: _user,
    customer_id: _customer,
    order_id: _order,
    recording_file_id: _file,
    recording_url: _url,
    raw_payload: _raw,
    events: _events,
    ...call
  } = row;
  return {
    ...call,
    has_recording: row.recording_file_id !== null,
    user_public_id: row.user_public_id ?? null,
    customer_public_id: row.customer_public_id ?? null,
    order_public_id: row.order_public_id ?? null,
    user_name: row.user_name ?? null,
  };
}
export function createSantralWebhookRoutes() {
  const routes = new Hono<AppBindings>();
  routes.post("/santral", rateLimit({ namespace: "webhook:netgsm-santral", limit: (c) => c.get("config").webhookRateLimitPerMinute ?? 600, windowMs: 60_000, key: clientIp, rejectionStatus: 200, rejectionBody: { ok: true, processed: false } }), async (c) => {
    const db = c.get("db");
    if (!db) return c.json({ ok: true, processed: false });
    const repo = new CallLogsRepository(db);
    try {
      const expected = await repo.webhookToken();
      if (!netgsmTokenMatches(expected, c.req.query("token"))) {
        c.get("logger").warn({ event: "netgsm.webhook_rejected", endpoint: "santral", reason: expected ? "invalid_token" : "missing_token_configuration" });
        await repo.recordEvent({}, "rejected");
        return c.json({ ok: true, processed: false });
      }
      let payload: Record<string, unknown>;
      const type = c.req.header("content-type") ?? "";
      try {
        const body: unknown = type.includes("form")
          ? await c.req.parseBody()
          : await c.req.json();
        payload =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
      } catch {
        payload = {
          malformed_body: (await c.req.text().catch(() => "")).slice(0, 10000),
        };
      }
      // Durable receipt precedes applying the call. Errors remain visible for operational replay.
      const event = await repo.recordEvent(payload, "received");
      if (!santralScenarios.includes(String(payload.scenario))) {
        await db
          .updateTable("webhook_events")
          .set({ status: "ignored", processed_at: new Date() })
          .where("id", "=", event.id)
          .execute();
        return c.json({ ok: true, processed: false });
      }
      const row = await repo.ingest(payload, "netgsm_webhook");
      if (row.recording_url && !row.recording_file_id)
        await c
          .get("providerDeliveryQueuePublisher")
          .publish(recordingArchiveJob(row.public_id));
      if (
        payload.scenario === "cdr" &&
        (await repo.claimMissedNotification(row.id))
      ) {
        // Each recipient has the same scope as the read API; no phone data is broadcast to cargo sessions.
        const recipients = await db
          .selectFrom("users")
          .innerJoin("roles", "roles.id", "users.role_id")
          .select("users.public_id")
          .where("users.is_active", "=", true)
          .where((e) =>
            e.or([
              e("users.id", "=", row.user_id ?? -1),
              e("roles.name", "in", ["admin", "owner"]),
            ]),
          )
          .execute();
        for (const user of recipients)
          c.get("realtimePublisher").publishToUser(user.public_id, {
            event: "call.missed",
            id: `evt_missed_${row.public_id}`,
            occurred_at: new Date().toISOString(),
            payload: {
              call_log_public_id: row.public_id,
              phone: row.customer_number,
            },
          });
      }
      await db
        .updateTable("webhook_events")
        .set({ status: "processed", processed_at: new Date() })
        .where("id", "=", event.id)
        .execute();
      return c.json({ ok: true, processed: true });
    } catch (error) {
      c.get("logger").error({
        event: "santral.webhook_failed",
        error: error instanceof Error ? error.message : "unknown",
      });
      return c.json({ ok: true, processed: false });
    }
  });
  return routes;
}
export function createCallLogRoutes() {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireDatabase, authenticate);
  routes.use("*", async (c, next) => {
    if (!["calisan", "admin", "owner"].includes(c.get("auth")?.role ?? ""))
      return c.json(
        { error: { code: "forbidden", message: "Staff role required" } },
        403,
      );
    return next();
  });
  routes.post("/client-events", async (c) => {
    const parsed = callLogClientEventRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "Invalid client call event",
          },
        },
        400,
      );
    const db = c.get("db")!;
    try {
      const call = await new CallLogsRepository(db).ingest(
        parsed.data,
        "softphone",
        { userId: c.get("actorUserId")!, input: parsed.data },
      );
      const row = await callLogQuery(db, c.get("actorUserId")!, false)
        .where("call_logs.id", "=", call.id)
        .executeTakeFirstOrThrow();
      return c.json({ call_log: serializeCall(row) }, 201);
    } catch (error) {
      if (error instanceof CallLinkError)
        return c.json(
          { error: { code: "invalid_link", message: error.message } },
          400,
        );
      throw error;
    }
  });
  routes.get("/", async (c) => {
    const parsed = callLogListQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json(
        { error: { code: "invalid_request", message: "Invalid call filters" } },
        400,
      );
    const f = parsed.data;
    let q = callLogQuery(
      c.get("db")!,
      c.get("actorUserId")!,
      isAdminRole(c.get("auth")!.role),
    );
    if (f.direction) q = q.where("call_logs.direction", "=", f.direction);
    if (f.status) q = q.where("call_logs.status", "=", f.status);
    if (f.user) q = q.where("users.public_id", "=", f.user);
    if (f.date_from)
      q = q.where("call_logs.initiated_at", ">=", new Date(f.date_from));
    if (f.date_to)
      q = q.where("call_logs.initiated_at", "<=", new Date(f.date_to));
    if (f.customer_public_id)
      q = q.where("customers.public_id", "=", f.customer_public_id);
    if (f.order_public_id)
      q = q.where("orders.public_id", "=", f.order_public_id);
    if (f.missed_only === "true")
      q = q
        .where("call_logs.direction", "=", "inbound")
        .where("call_logs.status", "=", "missed");
    const [count, rows] = await Promise.all([
      q
        .clearSelect()
        .select((e) => e.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow(),
      q
        .orderBy("call_logs.initiated_at", "desc")
        .orderBy("call_logs.id", "desc")
        .limit(f.limit)
        .offset(f.offset)
        .execute(),
    ]);
    return c.json({
      data: rows.map(serializeCall),
      total_count: Number(count.total),
      limit: f.limit,
      offset: f.offset,
    });
  });
  routes.get("/:public_id/recording", async (c) => {
    const db = c.get("db")!;
    const call = await callLogQuery(
      db,
      c.get("actorUserId")!,
      isAdminRole(c.get("auth")!.role),
    )
      .where("call_logs.public_id", "=", c.req.param("public_id"))
      .executeTakeFirst();
    if (!call)
      return c.json(
        { error: { code: "not_found", message: "Call not found" } },
        404,
      );
    const file = call.recording_file_id
      ? await db
          .selectFrom("files")
          .selectAll()
          .where("id", "=", call.recording_file_id)
          .where("upload_status", "=", "available")
          .executeTakeFirst()
      : null;
    if (!file)
      return c.json(
        {
          error: {
            code: "recording_pending",
            message: "Recording is not archived yet",
          },
        },
        404,
      );
    return c.json({
      download: await createMediaStorageFromEnv().createDownloadInstruction(
        file.object_key,
      ),
    });
  });
  routes.get("/:public_id", async (c) => {
    const call = await callLogQuery(
      c.get("db")!,
      c.get("actorUserId")!,
      isAdminRole(c.get("auth")!.role),
    )
      .where("call_logs.public_id", "=", c.req.param("public_id"))
      .executeTakeFirst();
    if (!call)
      return c.json(
        { error: { code: "not_found", message: "Call not found" } },
        404,
      );
    return c.json({
      call_log: serializeCall(call),
      raw_payload: call.raw_payload,
      events: call.events,
    });
  });
  return routes;
}
