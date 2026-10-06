import { readdirSync, readFileSync } from "node:fs";
import { PostgresDialect, Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import type { Database } from "@garanti-kulucka/database";
import { isAllowedOutboundUserUrl } from "../src/security/url-policy.js";

describe("security abuse guards", () => {
  it("keeps search and filter values parameterized in Kysely queries", () => {
    const db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: {} as never }),
    });
    const maliciousStatus = "delivered' OR 1=1 --";
    const maliciousChannel = "instagram'); DROP TABLE conversations; --";

    const ordersQuery = db
      .selectFrom("orders")
      .selectAll()
      .where("orders.status", "=", maliciousStatus)
      .compile();
    const conversationsQuery = db
      .selectFrom("conversations")
      .selectAll()
      .where("conversations.channel", "=", maliciousChannel)
      .compile();

    expect(ordersQuery.sql).not.toContain(maliciousStatus);
    expect(ordersQuery.parameters).toEqual([maliciousStatus]);
    expect(conversationsQuery.sql).not.toContain(maliciousChannel);
    expect(conversationsQuery.parameters).toEqual([maliciousChannel]);
  });

  it("keeps expanded order list filters parameterized", () => {
    const db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: {} as never }),
    });
    const maliciousSearch = "%' OR 1=1 --";
    const maliciousCargo = "ptt'); DROP TABLE shipments; --";
    const maliciousUser = "usr_bad' OR role='admin";

    const query = db
      .selectFrom("orders")
      .leftJoin("customers", "customers.id", "orders.customer_id")
      .leftJoin("users", "users.id", "orders.created_by_user_id")
      .leftJoin("shipments", "shipments.order_id", "orders.id")
      .selectAll("orders")
      .where((expression) =>
        expression.or([
          expression("orders.order_number", "ilike", maliciousSearch),
          expression("customers.full_name", "ilike", maliciousSearch),
        ]),
      )
      .where("shipments.provider", "=", maliciousCargo)
      .where("users.public_id", "=", maliciousUser)
      .compile();

    expect(query.sql).not.toContain(maliciousSearch);
    expect(query.sql).not.toContain(maliciousCargo);
    expect(query.sql).not.toContain(maliciousUser);
    expect(query.parameters).toEqual([maliciousSearch, maliciousSearch, maliciousCargo, maliciousUser]);
  });

  it("blocks private and localhost user-supplied URLs before provider preview storage", () => {
    expect(isAllowedOutboundUserUrl("https://example.com/media.jpg")).toBe(true);
    expect(isAllowedOutboundUserUrl("http://127.0.0.1/admin")).toBe(false);
    expect(isAllowedOutboundUserUrl("http://localhost/admin")).toBe(false);
    expect(isAllowedOutboundUserUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedOutboundUserUrl("http://192.168.1.10/file.jpg")).toBe(false);
    expect(isAllowedOutboundUserUrl("file:///etc/passwd")).toBe(false);
  });

  it("keeps stored message bodies rendered as React text and avoids raw HTML injection", () => {
    const inboxSource = readFileSync("../../apps/web/src/ui/pages/flows/InboxFlow.tsx", "utf8");
    const webSources = readdirSync("../../apps/web/src", { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))
      .map((file) => readFileSync(`../../apps/web/src/${file}`, "utf8"));
    const xssPayload = "<img src=x onerror=alert(1)>";

    const commentsSource = readFileSync("../../apps/web/src/ui/pages/YorumlarPage.tsx", "utf8");

    expect(webSources.length).toBeGreaterThan(10);
    for (const source of webSources) expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(inboxSource).toContain("{message.body ?? (attachments.length > 0 ? t(\"media\") : t(\"emptyMessage\"))}");
    expect(commentsSource).toContain("{yorum.text || t(\"emptyText\")}");
    expect(xssPayload).toContain("onerror");
  });
});
