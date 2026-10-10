/** Pure helpers behind the beta Mesajlar page (legacy MesajlarPage): names, channels, list filtering, shortcuts, order form. */
import type { ConversationCustomerRef, ConversationSummary } from "@garanti-kulucka/shared";
import type { Brand } from "@/components/brand-icons";
import { localeFor } from "@/i18n";
import type { MessageShortcut, ThreadMessage } from "./inbox";
import { parseMoney, type ProductOption } from "./orders";

/** Last-resort label for an enum the dictionaries do not know yet: "out_for_delivery" → "Out for delivery". */
export function humanize(value: string | null | undefined) {
  const text = (value ?? "").replace(/[_-]+/g, " ").trim();
  return text ? text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1) : "-";
}

export type ChannelKey = "whatsapp" | "instagram" | "messenger" | "panel";

/** Legacy KANAL_CONFIG; unknown channels fall back to "panel" instead of crashing the header. */
export const channelConfig: Record<ChannelKey, { brand: Brand | null; label: string; avatar: string; text: string }> = {
  whatsapp: { brand: "whatsapp", label: "WhatsApp", avatar: "bg-green-600", text: "text-green-600 dark:text-green-500" },
  messenger: { brand: "messenger", label: "Messenger", avatar: "bg-blue-600", text: "text-blue-600 dark:text-blue-500" },
  instagram: { brand: "instagram", label: "Instagram", avatar: "bg-pink-600", text: "text-pink-600 dark:text-pink-500" },
  panel: { brand: null, label: "Panel", avatar: "bg-slate-500 dark:bg-slate-600", text: "text-msg-muted" },
};

export function channelKey(channel: string | null | undefined): ChannelKey {
  const value = (channel ?? "").toLowerCase();
  if (value === "whatsapp") return "whatsapp";
  if (value === "instagram") return "instagram";
  if (value === "facebook" || value === "messenger") return "messenger";
  return "panel";
}

/** Channel filter (legacy kanal seçici) → `channel` query; "Facebook" covers both stored Messenger names. */
export type ChannelFilter = "all" | "whatsapp" | "instagram" | "messenger";

export function channelQuery(filter: ChannelFilter) {
  if (filter === "all") return {};
  return { channel: filter === "messenger" ? "facebook,messenger" : filter };
}

export const isSocialChannel = (channel: string | null | undefined) => {
  const key = channelKey(channel);
  return key === "instagram" || key === "messenger";
};

const emailName = (value: string | null | undefined) => {
  if (!value || !value.includes("@")) return null;
  return value
    .split("@")[0]!
    .replace(/[._\-+]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
};

export interface DisplayNameLabels {
  instagram: (last4: string) => string;
  messenger: (last4: string) => string;
  other: (last4: string) => string;
  unknown: string;
}

/** Legacy akilliGosterimAdi: real name → name from an e-mail → @username → channel + last 4 digits (WhatsApp: full number). */
export function conversationName(customer: ConversationCustomerRef | null | undefined, channel: string | null | undefined, labels: DisplayNameLabels) {
  const raw = (customer?.full_name ?? "").trim();
  if (raw && !raw.includes("@") && !/^(ig_|fb_|wa_|\d{6,})/.test(raw)) return raw;
  const fromEmail = emailName(raw);
  if (fromEmail) return fromEmail;
  const username = (customer?.username ?? "").trim();
  if (username) return `@${username.replace(/^@/, "")}`;
  const phone = (customer?.phone ?? "").replace(/^(ig_|fb_|wa_)/, "");
  if (phone) {
    const last4 = phone.replace(/\D/g, "").slice(-4) || phone.slice(-4);
    const key = channelKey(channel);
    if (key === "instagram") return labels.instagram(last4);
    if (key === "messenger") return labels.messenger(last4);
    if (key === "whatsapp") return phone.startsWith("+") ? phone : `+${phone}`;
    return labels.other(last4);
  }
  return labels.unknown;
}

/** Legacy basHarfler: first letter of the first two words ("?" when empty). */
export function initialsOf(name: string) {
  const words = name
    .replace(/^[@+]/, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase("tr-TR"))
    .join("");
}

/** A dialable phone (not an Instagram/Messenger PSID) or "". */
export function realPhone(phone: string | null | undefined) {
  const value = (phone ?? "").trim();
  if (!value || /^(ig_|fb_|wa_)/i.test(value)) return "";
  return value.replace(/\D/g, "").length >= 10 ? value : "";
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Legacy zamanFormatla: today → HH:MM, yesterday → "Dün", older → short date. */
export function listTime(value: string | null | undefined, language: string, yesterday: string, now = new Date()) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const locale = localeFor(language);
  if (sameDay(date, now)) return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const before = new Date(now);
  before.setDate(before.getDate() - 1);
  if (sameDay(date, before)) return yesterday;
  return date.toLocaleDateString(locale);
}

export function clockTime(value: string | null | undefined, language: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(localeFor(language), { hour: "2-digit", minute: "2-digit" });
}

const asciiFold = (value: string) =>
  value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");

/** Legacy filtrelenmisKonusmalar: channel, unread (skipped while searching) and local search; newest first, undated last. */
export function visibleConversations(rows: ConversationSummary[], options: { channel: ChannelFilter; unreadOnly: boolean; search: string; extra?: ConversationSummary[] }) {
  const term = options.search.trim().replace(/^@/, "");
  const folded = asciiFold(term);
  // Phone matching only for phone-like terms (legacy matched digits of any term, e.g. "Müşteri 4" hit every phone with a 4).
  const digits = /^[\d\s+()-]+$/.test(term) ? term.replace(/\D/g, "") : "";
  const matchesChannel = (row: ConversationSummary) => options.channel === "all" || channelKey(row.channel) === options.channel;
  const matchesSearch = (row: ConversationSummary) => {
    const fields = [row.customer?.full_name, row.customer?.username, row.last_message_text].map((value) => asciiFold(value ?? ""));
    const phone = (row.customer?.phone ?? "").replace(/\D/g, "");
    return fields.some((value) => value.includes(folded)) || (digits.length > 0 && phone.includes(digits));
  };
  let result = rows.filter((row) => matchesChannel(row) && (term ? matchesSearch(row) : !options.unreadOnly || row.unread_count > 0));
  if (term && options.extra?.length) {
    const seen = new Set(result.map((row) => row.public_id));
    result = [...result, ...options.extra.filter((row) => !seen.has(row.public_id) && matchesChannel(row))];
  }
  const time = (row: ConversationSummary) => new Date(row.last_message_at ?? row.updated_at).getTime();
  return [...result].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    return tb - ta;
  });
}

/**
 * Poll merge for the first batch: server rows win, except an unread count the agent just cleared locally stays
 * cleared until a newer message arrives (legacy realtime guard). Rows loaded by "load more" are kept.
 */
export function mergeConversations(previous: ConversationSummary[], firstBatch: ConversationSummary[]) {
  const before = new Map(previous.map((row) => [row.public_id, row]));
  const merged = firstBatch.map((row) => {
    const local = before.get(row.public_id);
    if (local && local.unread_count < row.unread_count) {
      const serverTime = new Date(row.last_message_at ?? row.updated_at).getTime();
      const localTime = new Date(local.last_message_at ?? local.updated_at).getTime();
      if (serverTime <= localTime) return { ...row, unread_count: local.unread_count };
    }
    return row;
  });
  const fresh = new Set(firstBatch.map((row) => row.public_id));
  return [...merged, ...previous.slice(firstBatch.length).filter((row) => !fresh.has(row.public_id))];
}

/** Legacy sonrakiKonusmayaGec: next row, or the first row when the open one left the filtered list. */
export function nextConversation(list: ConversationSummary[], currentId: string | null) {
  if (!currentId || list.length === 0) return null;
  const index = list.findIndex((row) => row.public_id === currentId);
  if (index === -1) return list[0] ?? null;
  return list[index + 1] ?? null;
}

/** Thread poll merge: keeps already loaded older pages and still-pending optimistic bubbles. */
export function mergeThread<T extends Pick<ThreadMessage, "public_id" | "sent_at">>(previous: T[], latest: T[]) {
  const latestIds = new Set(latest.map((message) => message.public_id));
  const firstLatest = latest[0] ? new Date(latest[0].sent_at).getTime() : Number.POSITIVE_INFINITY;
  const older = previous.filter((message) => !isPending(message) && !latestIds.has(message.public_id) && new Date(message.sent_at).getTime() < firstLatest);
  const pending = previous.filter(isPending);
  return [...older, ...latest, ...pending];
}

export const pendingPrefix = "tmp_";
export const isPending = (message: Pick<ThreadMessage, "public_id">) => message.public_id.startsWith(pendingPrefix);

/** Inline shortcut suggestions: codes starting with the word under the cursor (max 5). */
export function matchShortcuts(text: string, cursor: number, shortcuts: MessageShortcut[]) {
  const words = text.slice(0, cursor).split(/\s+/);
  const current = (words[words.length - 1] ?? "").toLocaleLowerCase("tr-TR");
  if (!current) return [];
  return shortcuts.filter((item) => item.code.toLocaleLowerCase("tr-TR").startsWith(current)).slice(0, 5);
}

/** Replaces the word before the cursor with the shortcut text (legacy Tab/click expansion); returns the new caret. */
export function expandShortcut(text: string, cursor: number, message: string) {
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);
  const start = before.search(/\S+$/);
  const head = start >= 0 ? before.slice(0, start) : before;
  const tail = after.length === 0 ? " " : after;
  return { text: `${head}${message}${tail}`, cursor: head.length + message.length + (after.length === 0 ? 1 : 0) };
}

/** Order panel line (product select + qty + price). */
export interface OrderLine {
  product_public_id: string;
  name: string;
  quantity: string;
  price: string;
  external_product_id: string | null;
}

export interface OrderDraft {
  name: string;
  phone: string;
  lines: OrderLine[];
  city: string;
  district: string;
  address: string;
  notes: string;
  cargo: "" | "ptt" | "surat";
}

export const emptyLine = (): OrderLine => ({ product_public_id: "", name: "", quantity: "1", price: "", external_product_id: null });

export function lineFor(product: ProductOption | undefined): OrderLine {
  if (!product) return emptyLine();
  return { product_public_id: product.public_id, name: product.name, quantity: "1", price: product.unit_price ? String(Number(product.unit_price)) : "", external_product_id: product.external_product_id };
}

/** Legacy ilkVarsayilanUrun: "el yapımı kuluçka" → any kuluçka → first product. */
export function defaultProduct(products: ProductOption[]) {
  const lower = (value: string) => value.toLocaleLowerCase("tr-TR");
  return (
    products.find((item) => lower(item.name).includes("el yapımı") && lower(item.name).includes("kuluçka")) ??
    products.find((item) => lower(item.name).includes("kuluçka")) ??
    products[0]
  );
}

export function orderTotal(lines: OrderLine[]) {
  // The first line always counts (its product check comes later); extra lines only once a product is picked.
  return lines.reduce((sum, line, index) => (index === 0 || line.name.trim() ? sum + parseMoney(line.price) * Math.max(Number.parseInt(line.quantity, 10) || 1, 1) : sum), 0);
}

export type OrderValidationError = "name" | "phone" | "city" | "district" | "address" | "price" | "total" | "product" | "cargo";

/** Legacy handleSiparisOlustur order: isim → telefon → il → ilçe → adres → fiyat → tutar → ürün → kargo. */
export function validateOrder(draft: OrderDraft): OrderValidationError | null {
  const first = draft.lines[0];
  if (!draft.name.trim()) return "name";
  if (!draft.phone.trim()) return "phone";
  if (!draft.city) return "city";
  if (!draft.district) return "district";
  if (!draft.address.trim()) return "address";
  if (!(parseMoney(first?.price ?? "") > 0)) return "price";
  if (orderTotal(draft.lines) <= 0) return "total";
  if (!first?.name.trim()) return "product";
  if (!draft.cargo) return "cargo";
  return null;
}

/** Legacy post-order message: shortcut "2" (or the second one) without the closing question, with {{fiyat}} filled in. */
export function orderFollowUp(shortcuts: MessageShortcut[], total: number) {
  const shortcut = shortcuts.find((item) => item.code === "2") ?? (shortcuts.length >= 2 ? shortcuts[1] : undefined);
  if (!shortcut?.message) return null;
  const amount = total.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return shortcut.message
    .replace(/\s*yardımcı olmamı istediğiniz başka bir konu var mı efendim\??/gi, "")
    .replace(/\s*yardımcı olabileceğim başka bir şey var mı\??/gi, "")
    .replace(/\{\{\s*(?:fiyat|toplam|genel_toplam|tutar)\s*\}\}/gi, `${amount} TL`)
    .trim();
}

/** Legacy "Güncel Stok": in-stock incubator products. */
export function stockBadges(products: ProductOption[]) {
  return products
    .filter((item) => item.stock_quantity > 0 && /kuluçka|kulucka|makine/i.test(item.name))
    .map((item) => ({ name: item.name, quantity: item.stock_quantity }));
}
