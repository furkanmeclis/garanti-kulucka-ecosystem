import { describe, expect, it } from "vitest";
import { carrierLabel, channelLabel, formatMoney } from "../src/lib/format";
import { paginate, pageCount, pageSize } from "../src/lib/list-params";

describe("formatting and paging helpers", () => {
  it("formats money per language with the lira sign", () => {
    expect(formatMoney(154230.5, "TRY", "tr")).toBe("₺154.230,50");
    expect(formatMoney("154230.5", "TRY", "en")).toBe("₺154,230.50");
  });

  it("keeps carrier and channel brand names", () => {
    expect(carrierLabel("ptt", "Diğer")).toBe("PTT");
    expect(carrierLabel("Sürat Kargo", "Diğer")).toBe("Sürat");
    expect(carrierLabel("other", "Other")).toBe("Other");
    expect(channelLabel("messenger")).toBe("Facebook");
  });

  it("pages client-side lists and clamps out-of-range pages", () => {
    const rows = Array.from({ length: 45 }, (_, index) => index);
    expect(pageSize).toBe(20);
    expect(pageCount(45)).toBe(3);
    expect(pageCount(0)).toBe(1);
    expect(paginate(rows, 3).rows).toEqual(rows.slice(40));
    expect(paginate(rows, 9).page).toBe(3);
  });
});
