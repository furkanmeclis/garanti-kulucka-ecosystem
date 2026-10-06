import { describe, expect, it, vi } from "vitest";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { canonicalShipmentStatus, shipmentWritebackFrom } from "../src/shipment-writeback.js";

const handler = vi.hoisted(() => ({ result: null as unknown }));

vi.mock("../src/providers/handlers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/providers/handlers.js")>();
  return { ...actual, handleProviderDeliveryJobWithTransport: vi.fn(async () => handler.result) };
});

const { createWorkerProcessorRegistry } = await import("../src/processors.js");

const now = "2026-10-06T09:00:00.000Z";

function envelope(provider: "ptt" | "surat" | "whatsapp", operation: ProviderRequestEnvelope["operation"], payload: Record<string, unknown> = { shipment_public_id: "shp_1" }): ProviderRequestEnvelope {
  return { request_id: `req_${provider}_${operation}`, provider, operation, direction: "outbound", channel: provider === "whatsapp" ? "whatsapp" : "cargo", occurred_at: now, payload };
}

describe("shipment write-back mapping", () => {
  it("maps legacy kargo codes to canonical statuses", () => {
    expect(canonicalShipmentStatus("teslim_edildi")).toBe("delivered");
    expect(canonicalShipmentStatus("dagitimda")).toBe("out_for_delivery");
    expect(canonicalShipmentStatus("kargoya_verildi")).toBe("shipped");
    expect(canonicalShipmentStatus("delivered")).toBe("delivered");
    expect(canonicalShipmentStatus("bilinmiyor")).toBeNull();
    expect(canonicalShipmentStatus(null)).toBeNull();
  });

  it("stores the PTT barcode from shipment.create but never the parse-failure placeholder", () => {
    expect(shipmentWritebackFrom(envelope("ptt", "shipment.create"), { success: true, takipNo: "KP123456789TR", barkodNo: "KP123456789TR" })).toEqual({
      shipmentPublicId: "shp_1",
      trackingNumber: "KP123456789TR",
      status: null,
      lastEventText: null,
    });
    expect(shipmentWritebackFrom(envelope("ptt", "shipment.create"), { takipNo: "PTT-1700000000", barkodParseFailed: true })).toBeNull();
  });

  it("maps PTT tracking to status + last movement", () => {
    expect(
      shipmentWritebackFrom(envelope("ptt", "shipment.track"), {
        barkodNo: "KP1",
        shipment_status: "dagitimda",
        durum: "DAGITIMDA",
        hareketler: [{ islem: "KABUL", merkez: "KONYA" }, { islem: "DAĞITIMA ÇIKARILDI", merkez: "SELÇUKLU" }],
      }),
    ).toEqual({ shipmentPublicId: "shp_1", trackingNumber: "KP1", status: "out_for_delivery", lastEventText: "DAĞITIMA ÇIKARILDI — SELÇUKLU" });
  });

  it("maps Sürat create and tracking responses", () => {
    expect(shipmentWritebackFrom(envelope("surat", "shipment.create"), { success: true, data: { kargoTakipNo: "SRT900" } })?.trackingNumber).toBe("SRT900");
    expect(
      shipmentWritebackFrom(envelope("surat", "shipment.track"), {
        success: true,
        data: { gonderiler: [{ kargoTakipNo: "SRT900", shipment_status: "teslim_edildi", sonHareket: "Teslim edildi — Bornova", kargonunDurumu: "Teslim Edildi" }] },
      }),
    ).toEqual({ shipmentPublicId: "shp_1", trackingNumber: "SRT900", status: "delivered", lastEventText: "Teslim edildi — Bornova" });
    expect(shipmentWritebackFrom(envelope("surat", "shipment.track"), { data: { gonderiler: [] } })).toBeNull();
  });

  it("ignores other providers, operations and envelopes without a shipment id", () => {
    expect(shipmentWritebackFrom(envelope("whatsapp", "message.send"), { ok: true })).toBeNull();
    expect(shipmentWritebackFrom(envelope("ptt", "shipment.create", {}), { takipNo: "KP1" })).toBeNull();
    expect(shipmentWritebackFrom(envelope("ptt", "shipment.create"), undefined)).toBeNull();
  });
});

describe("provider-delivery processor write-back", () => {
  const job = (env: ProviderRequestEnvelope) => ({
    id: env.request_id,
    name: `${env.provider}.${env.operation}`,
    data: { job_id: `job_${env.request_id}`, queue: "provider-delivery" as const, name: `${env.provider}.${env.operation}`, requested_at: now, payload: { envelope: env } },
  });
  const attempt = { provider: "ptt", operation: "shipment.create", status: "success" } as never;

  it("writes live carrier results back and never fails the job when the write-back fails", async () => {
    const apply = vi.fn(async () => true);
    const registry = createWorkerProcessorRegistry({
      providerAccountConfigRepository: { getAccountConfig: async () => null },
      shipmentWritebackRepository: { apply },
    });
    handler.result = { provider: "ptt", request_id: "r", queue: "provider-delivery", status: "accepted_live", live_call_performed: true, attempt, response_payload: { takipNo: "KP77", barkodNo: "KP77" } };
    const env = envelope("ptt", "shipment.create");
    await expect(registry.dispatch("provider-delivery", job(env) as never)).resolves.toMatchObject({ shipment_writeback: "applied" });
    expect(apply).toHaveBeenCalledWith({ shipmentPublicId: "shp_1", trackingNumber: "KP77", status: null, lastEventText: null });

    apply.mockRejectedValueOnce(new Error("db down"));
    await expect(registry.dispatch("provider-delivery", job(env) as never)).resolves.toMatchObject({ shipment_writeback: "failed" });

    handler.result = { provider: "ptt", request_id: "r", queue: "provider-delivery", status: "accepted_fixture", live_call_performed: false, attempt };
    apply.mockClear();
    const dry = await registry.dispatch("provider-delivery", job(env) as never);
    expect(dry).not.toHaveProperty("shipment_writeback");
    expect(apply).not.toHaveBeenCalled();
  });
});
