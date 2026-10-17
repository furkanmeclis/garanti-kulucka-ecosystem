import { Hono } from "hono";
import type { AppBindings } from "../src/http/types.js";
import { MemoryRateLimitStore } from "../src/http/rate-limit.js";
import { describe, expect, it } from "vitest";
import { Kysely, PostgresDialect } from "kysely";
import {
  normalizeCallPayload,
  callTimestamp,
  type Database,
} from "@garanti-kulucka/database";
import { callLogClientEventRequestSchema } from "@garanti-kulucka/shared";
import {
  callLogQuery,
  createSantralWebhookRoutes,
} from "../src/http/call-log-routes.js";

describe("call log contracts and RBAC query", () => {
  it("maps the documented URL forwarding CDR sample and retains identifiers", () => {
    const sample = {
      bas: "2021-01-27 16:05:38",
      kimlik: 186640000,
      ortakkimlik: 186640000,
      clid: '"NECLA 561523" <05550000000>',
      arayan: "05550000000",
      aranan: "8503000000-queue-MusteriHizmetleri",
      sure: 164,
      sondurum: 3,
      santral: "8503000000",
      yon: 1,
      seskaydi: "https://dosyaindir.netgsm.com.tr/upload.php?tip=1&q=fixture",
      asteriskId: "sip8-1611752738.106785",
      trunk: "3120000000",
      scenario: "cdr",
      timestamp: "1652080580926",
    };
    expect(normalizeCallPayload(sample, "netgsm_webhook")).toMatchObject({
      unique_id: "186640000",
      common_id: "186640000",
      asterisk_id: sample.asteriskId,
      direction: "inbound",
      status: "busy",
      caller: sample.arayan,
      callee: sample.aranan,
      clid: sample.clid,
      talk_seconds: 164,
      initiated_at: "2021-01-27T13:05:38.000Z",
      recording_url: sample.seskaydi,
      trunk: sample.trunk,
    });
    for (const [code, status] of [
      "answered",
      "missed",
      "busy",
      "timeout",
      "failed",
    ].entries())
      expect(
        normalizeCallPayload({ sondurum: code + 1 }, "netgsm_webhook").status,
      ).toBe(status);
  });
  it("maps scenario times, numbers, DTMF, and report direction codes independently", () => {
    expect(
      normalizeCallPayload(
        {
          scenario: "Outbound_call",
          internal_num: "101",
          customer_num: "+905551112233",
          timestamp: "1652080580926",
        },
        "netgsm_webhook",
      ),
    ).toMatchObject({
      direction: "outbound",
      internal_number: "101",
      customer_number: "+905551112233",
      initiated_at: "2022-05-09T07:16:20.926Z",
    });
    expect(
      normalizeCallPayload(
        { scenario: "Answer", holdtime: "3", callConnectedTime: "1652080580" },
        "netgsm_webhook",
      ),
    ).toMatchObject({
      status: "answered",
      hold_seconds: 3,
      connected_at: "2022-05-09T07:16:20.000Z",
    });
    expect(
      normalizeCallPayload(
        { scenario: "DTMF", Digit: "0", Context: "ivr" },
        "netgsm_webhook",
      ),
    ).toMatchObject({ dtmf_digits: "0", context_name: "ivr" });
    for (const [direction, expected] of [
      "outbound",
      "inbound",
      "inbound",
      "outbound",
      "internal",
      "internal",
    ].entries())
      expect(
        normalizeCallPayload({ direction }, "netgsm_report").direction,
      ).toBe(expected);
    expect(callTimestamp("29.07.2019 18:23:23")).toBe(
      "2019-07-29T15:23:23.000Z",
    );
  });
  it("parameterizes staff ownership and permits admin/owner all calls", () => {
    const db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: {} as never }),
    });
    const own = callLogQuery(db, 41, false).compile();
    expect(own.sql).toContain('"call_logs"."user_id" = $1');
    expect(own.parameters).toEqual([41]);
    expect(callLogQuery(db, 41, true).compile().sql).not.toContain(
      'where "call_logs"."user_id"',
    );
  });
  it("validates client events, timestamps and phone values", () => {
    const payload = {
      direction: "outbound",
      phone: "05551112233",
      started_at: "2026-10-17T10:00:00Z",
      ended_at: "2026-10-17T10:01:00Z",
      client_status: "answered",
      talk_seconds: 30,
    };
    expect(callLogClientEventRequestSchema.safeParse(payload).success).toBe(
      true,
    );
    expect(
      callLogClientEventRequestSchema.safeParse({
        ...payload,
        ended_at: "2026-10-16T10:01:00Z",
      }).success,
    ).toBe(false);
    expect(
      callLogClientEventRequestSchema.safeParse({
        ...payload,
        talk_seconds: -1,
      }).success,
    ).toBe(false);
  });
  it("acknowledges without a configured database", async () => {
    const app = new Hono<AppBindings>();
    app.use("*", async (c, next) => {
      c.set("config", { webhookRateLimitPerMinute: 600 } as never);
      c.set("rateLimitStore", new MemoryRateLimitStore());
      await next();
    });
    app.route("/", createSantralWebhookRoutes());
    const response = await app.request("/santral", {
      method: "POST",
      body: "bad",
    });
    expect(response.status).toBe(200);
  });
});
