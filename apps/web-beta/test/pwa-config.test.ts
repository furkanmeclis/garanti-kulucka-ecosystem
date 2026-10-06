import { describe, expect, it } from "vitest";
import { backendPathDenylist } from "../vite.config";

describe("PWA service worker scope", () => {
  it("never serves backend paths from the navigation fallback", () => {
    for (const path of ["/backend/auth/me", "/api/orders", "/auth/login", "/admin/settings", "/healthz"]) {
      expect(backendPathDenylist.some((pattern) => pattern.test(path)), path).toBe(true);
    }
    for (const path of ["/", "/siparisler", "/mesajlar", "/ayarlar"]) {
      expect(backendPathDenylist.some((pattern) => pattern.test(path)), path).toBe(false);
    }
  });
});
