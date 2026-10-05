import { readFileSync } from "node:fs";
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

  it("blocks private and localhost user-supplied URLs before provider preview storage", () => {
    expect(isAllowedOutboundUserUrl("https://example.com/media.jpg")).toBe(true);
    expect(isAllowedOutboundUserUrl("http://127.0.0.1/admin")).toBe(false);
    expect(isAllowedOutboundUserUrl("http://localhost/admin")).toBe(false);
    expect(isAllowedOutboundUserUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedOutboundUserUrl("http://192.168.1.10/file.jpg")).toBe(false);
    expect(isAllowedOutboundUserUrl("file:///etc/passwd")).toBe(false);
  });

  it("keeps stored message bodies rendered as React text and avoids raw HTML injection", () => {
    const appSource = readFileSync("../../apps/web/src/ui/App.tsx", "utf8");
    const xssPayload = "<img src=x onerror=alert(1)>";

    expect(appSource).not.toContain("dangerouslySetInnerHTML");
    expect(appSource).toContain("{message.body ?? \"Boş mesaj\"}");
    expect(xssPayload).toContain("onerror");
  });
});
