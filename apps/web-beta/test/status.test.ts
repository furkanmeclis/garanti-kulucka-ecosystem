import { describe, expect, it } from "vitest";
import tr from "../src/i18n/locales/tr.json";
import { statusKey, statusTone } from "../src/lib/status";

describe("status labels", () => {
  it("normalises English and legacy Turkish backend values to translated keys", () => {
    expect(statusKey("teslim_edildi")).toBe("delivered");
    expect(statusKey("delivered")).toBe("delivered");
    expect(statusKey("sevk_edildi")).toBe("shipped");
    expect(statusKey("teyit_bekliyor")).toBe("pending_confirmation");
    expect(statusKey("unknown_value")).toBeNull();
    for (const value of ["draft", "olusturuldu", "hazirlaniyor", "kargoya_verildi", "dagitimda", "iade", "iptal", "ulasilamadi", "open", "closed"]) {
      const key = statusKey(value);
      expect(key && key in tr.status, value).toBe(true);
    }
  });

  it("assigns tones for badges", () => {
    expect(statusTone("teslim_edildi")).toBe("success");
    expect(statusTone("iptal")).toBe("danger");
    expect(statusTone("teyit_bekliyor")).toBe("warning");
    expect(statusTone("in_transit")).toBe("info");
    expect(statusTone("whatever")).toBe("neutral");
  });
});
