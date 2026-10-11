import { describe, expect, it } from "vitest";
import { applyEnglishState, combine, commentRoutes, inboxRoutes, settingsRoutes } from "./fixtures";
import type { BackendState } from "../playwright-beta/helpers";

const turkish = /[ğüşıöçĞÜŞİÖÇ]/;
const request = (method: string, path: string, body?: unknown) => ({ method, path, url: new URL(`http://127.0.0.1:65531${path}`), body });
const state = () => ({ user: { public_id: "u", email: "", first_name: "", last_name: "", role: "admin", permissions: [] }, password: "", requests: [], orders: [], shipments: [], conversations: [], customers: [], fail: new Set<string>(), bodies: [] }) as unknown as BackendState;

describe("meta-review fixtures", () => {
  it("replaces the default Turkish inbox data with English conversations", () => {
    const s = state();
    applyEnglishState(s);
    expect(s.conversations.map((c) => c.public_id)).toEqual(["cnv_wa", "cnv_ig", "cnv_fb"]);
    expect(JSON.stringify([s.conversations, s.orders, s.customers, s.shipments])).not.toMatch(turkish);
  });

  it("serves a thread and appends incoming customer messages", () => {
    const inbox = inboxRoutes();
    const s = state();
    const before = inbox.route(request("GET", "/api/conversations/cnv_wa/messages"), s)!.body as { data: unknown[] };
    inbox.addIncoming("cnv_wa", "Hi, where is my order?");
    const after = inbox.route(request("GET", "/api/conversations/cnv_wa/messages"), s)!.body as { data: Array<{ body: string }> };
    expect(after.data.length).toBe(before.data.length + 1);
    expect(after.data.at(-1)?.body).toBe("Hi, where is my order?");
  });

  it("hides a comment and reports it as hidden", () => {
    const comments = commentRoutes();
    const s = state();
    comments(request("POST", "/api/comments/cmt_ig_1/hide", {}), s);
    const listRequest = { ...request("GET", "/api/comments"), url: new URL("http://127.0.0.1:65531/api/comments?platform=instagram") };
    const list = comments(listRequest, s)!.body as { data: Array<{ public_id: string; status: string }> };
    expect(list.data.find((c) => c.public_id === "cmt_ig_1")?.status).toBe("hidden");
  });

  it("returns the WhatsApp account snapshot with the production ids", () => {
    const body = settingsRoutes()(request("GET", "/admin/integrations/accounts/acc_whatsapp"), state())!.body as { settings: Array<{ key: string; value: unknown }> };
    expect(body.settings.find((x) => x.key === "phone_number_id")?.value).toBe("1128646770325911");
  });

  it("combine returns the first defined answer", () => {
    const a: Parameters<typeof combine>[0] = () => undefined;
    const b: Parameters<typeof combine>[0] = () => ({ status: 200, body: "b" });
    expect(combine(a, b)(request("GET", "/x"), state())?.body).toBe("b");
  });
});
