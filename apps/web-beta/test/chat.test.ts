import type { ConversationSummary } from "@garanti-kulucka/shared";
import { describe, expect, it } from "vitest";
import {
  channelKey,
  channelQuery,
  conversationName,
  defaultProduct,
  emptyLine,
  expandShortcut,
  initialsOf,
  lineFor,
  listTime,
  matchShortcuts,
  mergeConversations,
  mergeThread,
  nextConversation,
  orderFollowUp,
  orderTotal,
  realPhone,
  stockBadges,
  validateOrder,
  visibleConversations,
  type OrderDraft,
} from "../src/lib/chat";
import type { MessageShortcut, ThreadMessage } from "../src/lib/inbox";
import type { ProductOption } from "../src/lib/orders";

const labels = { instagram: (n: string) => `IG …${n}`, messenger: (n: string) => `FB …${n}`, other: (n: string) => `M …${n}`, unknown: "Bilinmeyen" };

const conversation = (id: number, patch: Partial<ConversationSummary> = {}): ConversationSummary => ({
  public_id: `cnv_${id}`,
  channel: "instagram",
  status: "open",
  is_in_pool: false,
  human_agent_enabled: false,
  unread_count: 0,
  last_message_text: `mesaj ${id}`,
  last_message_at: new Date(Date.UTC(2026, 9, 1, 9, id)).toISOString(),
  customer: { full_name: `Müşteri ${id}`, phone: `0555000000${id}` },
  updated_at: "2026-10-01T00:00:00.000Z",
  ...patch,
});

const shortcut = (code: string, message: string | null, extra: Partial<MessageShortcut> = {}): MessageShortcut => ({
  public_id: `msc_${code}`,
  code,
  message,
  type: "custom",
  is_active: true,
  sort_order: 0,
  attachments: [],
  updated_at: "2026-10-01T00:00:00.000Z",
  ...extra,
});

const product = (id: string, name: string, price = "100.00", stock = 5): ProductOption => ({ public_id: id, name, unit_price: price, stock_quantity: stock, external_product_id: null });

describe("chat channels and names", () => {
  it("maps stored channels and never crashes on unknown ones", () => {
    expect(channelKey("facebook")).toBe("messenger");
    expect(channelKey("Messenger")).toBe("messenger");
    expect(channelKey("whatsapp")).toBe("whatsapp");
    expect(channelKey("telegram")).toBe("panel");
    expect(channelKey(null)).toBe("panel");
    expect(channelQuery("messenger")).toEqual({ channel: "facebook,messenger" });
    expect(channelQuery("all")).toEqual({});
  });

  it("builds the legacy smart display name", () => {
    expect(conversationName({ full_name: "Ayşe Yılmaz" }, "instagram", labels)).toBe("Ayşe Yılmaz");
    expect(conversationName({ full_name: "ahmet.yilmaz@gmail.com" }, "instagram", labels)).toBe("Ahmet Yilmaz");
    expect(conversationName({ full_name: "ig_123456789", username: "@kulucka" }, "instagram", labels)).toBe("@kulucka");
    expect(conversationName({ full_name: null, phone: "ig_99887766" }, "instagram", labels)).toBe("IG …7766");
    expect(conversationName({ phone: "fb_1234" }, "facebook", labels)).toBe("FB …1234");
    expect(conversationName({ phone: "905551112233" }, "whatsapp", labels)).toBe("+905551112233");
    expect(conversationName(null, "instagram", labels)).toBe("Bilinmeyen");
    expect(initialsOf("ayşe yılmaz")).toBe("AY");
    expect(initialsOf("@kulucka")).toBe("K");
    expect(initialsOf("")).toBe("?");
    expect(realPhone("ig_1234567890")).toBe("");
    expect(realPhone("0555 123 45 67")).toBe("0555 123 45 67");
    expect(realPhone("1234")).toBe("");
  });

  it("formats list times like legacy (today clock, Dün, date)", () => {
    const now = new Date(2026, 9, 7, 15, 0);
    expect(listTime(new Date(2026, 9, 7, 9, 5).toISOString(), "tr", "Dün", now)).toBe("09:05");
    expect(listTime(new Date(2026, 9, 6, 22, 0).toISOString(), "tr", "Dün", now)).toBe("Dün");
    expect(listTime(new Date(2026, 9, 1, 10, 0).toISOString(), "tr", "Dün", now)).toBe("01.10.2026");
    expect(listTime(null, "tr", "Dün", now)).toBe("");
  });
});

describe("conversation list", () => {
  const rows = [conversation(1, { unread_count: 2 }), conversation(2), conversation(3, { channel: "facebook", unread_count: 1, last_message_at: null })];

  it("filters unread / channel and sorts newest first with undated rows last", () => {
    expect(visibleConversations(rows, { channel: "all", unreadOnly: true, search: "" }).map((row) => row.public_id)).toEqual(["cnv_1", "cnv_3"]);
    expect(visibleConversations(rows, { channel: "messenger", unreadOnly: false, search: "" }).map((row) => row.public_id)).toEqual(["cnv_3"]);
    expect(visibleConversations([conversation(5, { last_message_at: "bad", updated_at: "bad" }), ...rows], { channel: "all", unreadOnly: false, search: "" }).at(-1)?.public_id).toBe("cnv_5");
  });

  it("searches name, Turkish-folded text and phone (skipping the unread filter) and merges server hits", () => {
    expect(visibleConversations(rows, { channel: "all", unreadOnly: true, search: "musteri 2" }).map((row) => row.public_id)).toEqual(["cnv_2"]);
    expect(visibleConversations(rows, { channel: "all", unreadOnly: true, search: "00003" }).map((row) => row.public_id)).toEqual(["cnv_3"]);
    expect(visibleConversations(rows, { channel: "all", unreadOnly: true, search: "Müşteri 1" }).map((row) => row.public_id)).toEqual(["cnv_1"]);
    const extra = [conversation(9, { customer: { full_name: "Uzak Müşteri" } })];
    expect(visibleConversations(rows, { channel: "all", unreadOnly: true, search: "uzak", extra }).map((row) => row.public_id)).toEqual(["cnv_9"]);
  });

  it("keeps a locally cleared unread count until a newer message arrives", () => {
    const local = [conversation(1, { unread_count: 0 }), conversation(2), conversation(7)];
    const sameTime = mergeConversations(local, [conversation(1, { unread_count: 3 }), conversation(2)]);
    expect(sameTime[0]!.unread_count).toBe(0);
    expect(sameTime.map((row) => row.public_id)).toEqual(["cnv_1", "cnv_2", "cnv_7"]);
    const newer = mergeConversations(local, [conversation(1, { unread_count: 3, last_message_at: "2026-10-02T00:00:00.000Z" })]);
    expect(newer[0]!.unread_count).toBe(3);
  });

  it("finds the next conversation (first one when the open row left the list)", () => {
    const list = [conversation(1), conversation(2)];
    expect(nextConversation(list, "cnv_1")?.public_id).toBe("cnv_2");
    expect(nextConversation(list, "cnv_2")).toBeNull();
    expect(nextConversation(list, "cnv_9")?.public_id).toBe("cnv_1");
    expect(nextConversation(list, null)).toBeNull();
  });

  it("merges a polled thread page with older pages and pending bubbles", () => {
    const message = (id: string, minute: number): ThreadMessage => ({ public_id: id, sender_type: "customer", sender_name: null, body: id, is_read: true, sent_at: new Date(Date.UTC(2026, 9, 1, 9, minute)).toISOString(), attachments: [] });
    const previous = [message("old", 1), message("a", 5), message("tmp_1", 9)];
    expect(mergeThread(previous, [message("a", 5), message("b", 6)]).map((item) => item.public_id)).toEqual(["old", "a", "b", "tmp_1"]);
  });
});

describe("shortcuts", () => {
  const list = [shortcut("kargo", "Kargonuz yola çıktı."), shortcut("kar", "Kar"), shortcut("iban", "IBAN")];

  it("suggests codes for the word under the cursor (max 5)", () => {
    expect(matchShortcuts("merhaba ka", 10, list).map((item) => item.code)).toEqual(["kargo", "kar"]);
    expect(matchShortcuts("merhaba ", 8, list)).toEqual([]);
    expect(matchShortcuts("KA", 2, list)).toHaveLength(2);
    expect(matchShortcuts("a", 1, Array.from({ length: 8 }, (_, index) => shortcut(`a${index}`, "x")))).toHaveLength(5);
  });

  it("expands in place and places the caret after the text", () => {
    expect(expandShortcut("merhaba ka", 10, "Kargonuz yola çıktı.")).toEqual({ text: "merhaba Kargonuz yola çıktı. ", cursor: 29 });
    expect(expandShortcut("ka devam", 2, "Kargo")).toEqual({ text: "Kargo devam", cursor: 5 });
  });

  it("builds the post-order follow-up from shortcut 2", () => {
    const followUp = orderFollowUp([shortcut("1", "a"), shortcut("2", "Toplam {{fiyat}}. Yardımcı olabileceğim başka bir şey var mı?")], 3500);
    expect(followUp).toBe("Toplam 3.500 TL.");
    expect(orderFollowUp([shortcut("x", "a"), shortcut("y", "İkinci {{ toplam }}")], 10)).toBe("İkinci 10 TL");
    expect(orderFollowUp([shortcut("x", "a")], 10)).toBeNull();
  });
});

describe("order form", () => {
  const products = [product("p1", "Yedek Motor"), product("p2", "Kuluçka Makinesi 96'lı", "2000.00", 3), product("p3", "El Yapımı Kuluçka Makinesi", "3500.00", 12)];
  const draft = (patch: Partial<OrderDraft> = {}): OrderDraft => ({
    name: "Ayşe",
    phone: "05551112233",
    lines: [lineFor(products[2])],
    city: "Adana",
    district: "Seyhan",
    address: "Cd. 1",
    notes: "",
    cargo: "ptt",
    ...patch,
  });

  it("picks the legacy default product", () => {
    expect(defaultProduct(products)?.public_id).toBe("p3");
    expect(defaultProduct([products[0]!, products[1]!])?.public_id).toBe("p2");
    expect(defaultProduct([products[0]!])?.public_id).toBe("p1");
    expect(lineFor(products[2]).price).toBe("3500");
  });

  it("validates in the legacy order", () => {
    expect(validateOrder(draft({ name: " ", phone: "" }))).toBe("name");
    expect(validateOrder(draft({ phone: "" }))).toBe("phone");
    expect(validateOrder(draft({ city: "", district: "" }))).toBe("city");
    expect(validateOrder(draft({ district: "" }))).toBe("district");
    expect(validateOrder(draft({ address: "" }))).toBe("address");
    expect(validateOrder(draft({ lines: [{ ...lineFor(products[2]), price: "" }] }))).toBe("price");
    expect(validateOrder(draft({ lines: [{ ...lineFor(products[2]), name: "", product_public_id: "" }] }))).toBe("product");
    expect(validateOrder(draft({ cargo: "" }))).toBe("cargo");
    expect(validateOrder(draft())).toBeNull();
  });

  it("totals lines (extra lines only once they have a product)", () => {
    expect(orderTotal([{ ...lineFor(products[2]), quantity: "2" }, emptyLine(), { ...lineFor(products[0]) }])).toBe(7100);
  });

  it("lists incubator stock for the top strip", () => {
    expect(stockBadges(products)).toEqual([
      { name: "Kuluçka Makinesi 96'lı", quantity: 3 },
      { name: "El Yapımı Kuluçka Makinesi", quantity: 12 },
    ]);
  });
});
