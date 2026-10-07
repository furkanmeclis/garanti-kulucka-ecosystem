import { describe, expect, it, vi } from "vitest";
import { defaultCargoPipelineConfig, type CargoPipelineConfig, type JobEnvelope } from "@garanti-kulucka/shared";
import {
  processCargoPipelineItem,
  runCargoPipelineTick,
  vapiFollowUpPatch,
  type CargoPipelineContext,
  type CargoPipelineItem,
  type CargoPipelineStore,
} from "../src/cargo-pipeline.js";

// 12:00 Europe/Istanbul
const now = new Date("2026-10-07T09:00:00.000Z");

function item(overrides: Partial<CargoPipelineItem> = {}): CargoPipelineItem {
  return {
    id: 1,
    public_id: "cpl_test",
    shipment_id: 10,
    conversation_id: 20,
    channel: "whatsapp",
    phone: "05551234567",
    customer_name: "Ayşe Yılmaz",
    tracking_number: "KP123",
    cargo_provider: "ptt",
    last_event_text: "Şubede bekliyor",
    step: "mesaj",
    status: "isleniyor",
    attempt_count: 0,
    max_attempts: 3,
    ...overrides,
  };
}

function store(overrides: Partial<CargoPipelineStore> = {}, context: Partial<CargoPipelineContext> = {}): CargoPipelineStore {
  return {
    loadConfig: vi.fn(async () => ({ ...defaultCargoPipelineConfig, aktif: true })),
    loadVapiPolicy: vi.fn(async () => ({ enabled: true, start: "09:00", end: "18:00" })),
    enqueueCandidates: vi.fn(async () => 0),
    claimDue: vi.fn(async () => []),
    loadContext: vi.fn(async () => ({
      shipment: { public_id: "shp_test", status: "in_transit", last_event_text: "Şubede bekliyor" },
      conversation: { public_id: "cnv_test", channel: "whatsapp", external_thread_id: null, customer_phone: "05551234567" },
      ...context,
    })),
    update: vi.fn(async () => undefined),
    recordConversationMessage: vi.fn(async () => "msg_pipeline"),
    recordSms: vi.fn(async () => undefined),
    createVapiCall: vi.fn(async () => ({ id: 99, public_id: "vcl_pipeline" })),
    markVapiCallQueued: vi.fn(async () => undefined),
    openVapiItems: vi.fn(async () => []),
    ...overrides,
  };
}

const config: CargoPipelineConfig = { ...defaultCargoPipelineConfig, aktif: true, sms_gecikme_dk: 30, vapi_gecikme_dk: 60 };
const vapiPolicy = { enabled: true, start: "09:00", end: "18:00" };

function collect() {
  const jobs: JobEnvelope[] = [];
  return { jobs, publish: vi.fn(async (job: JobEnvelope) => (jobs.push(job), job.job_id)) };
}

describe("cargo pipeline engine", () => {
  it("sends the filled template to the linked conversation and schedules the SMS step", async () => {
    const fake = store();
    const { jobs, publish } = collect();
    const patch = await processCargoPipelineItem(item(), { store: fake, publish, config, vapiPolicy, now });

    expect(fake.recordConversationMessage).toHaveBeenCalledWith("cnv_test", expect.stringContaining("Sayın Ayşe Yılmaz, kargonuz (KP123) Şubede bekliyor"));
    expect(jobs[0]).toMatchObject({
      name: "whatsapp.message.send",
      payload: { envelope: { payload: { to: "905551234567", idempotency_key: "cargo_pipeline_msg_pipeline_0" } } },
    });
    expect(jobs[0]?.payload).toMatchObject({ envelope: { payload: { message: expect.stringContaining("https://gonderitakip.ptt.gov.tr/Track/Verify?q=KP123") } } });
    expect(patch).toEqual({ step: "sms", status: "bekliyor", next_run_at: new Date(now.getTime() + 30 * 60 * 1000), error_message: null });
  });

  it("skips the message step without a conversation and moves to SMS immediately", async () => {
    const { publish } = collect();
    const patch = await processCargoPipelineItem(item(), { store: store({}, { conversation: null }), publish, config, vapiPolicy, now });
    expect(publish).not.toHaveBeenCalled();
    expect(patch).toMatchObject({ step: "sms", status: "bekliyor", next_run_at: now, error_message: "Mesaj atlandı: konusma_yok" });
  });

  it("marks delivered shipments and refreshes the last carrier event", async () => {
    const { publish } = collect();
    const delivered = await processCargoPipelineItem(item(), {
      store: store({}, { shipment: { public_id: "shp_test", status: "in_transit", last_event_text: "Teslim edildi" } }),
      publish,
      config,
      vapiPolicy,
      now,
    });
    expect(delivered).toEqual({ step: "teslim", status: "teslim", error_message: null });

    const refreshed = await processCargoPipelineItem(item({ step: "sms" }), {
      store: store({}, { shipment: { public_id: "shp_test", status: "in_transit", last_event_text: "Adreste yok" } }),
      publish,
      config,
      vapiPolicy,
      now,
    });
    expect(refreshed).toMatchObject({ last_event_text: "Adreste yok", step: "vapi" });
  });

  it("queues an automatic SMS and records it in the SMS log", async () => {
    const fake = store();
    const { jobs, publish } = collect();
    const patch = await processCargoPipelineItem(item({ step: "sms" }), { store: fake, publish, config, vapiPolicy, now });
    expect(jobs[0]).toMatchObject({
      name: "netgsm.sms.send",
      job_id: "job_cargo_pipeline_cpl_test_sms_0",
      payload: { envelope: { payload: { recipient_phone: "05551234567", shipment_public_id: "shp_test" } } },
    });
    expect(fake.recordSms).toHaveBeenCalledWith(expect.objectContaining({ phone: "05551234567", idempotencyKey: "cargo_pipeline_cpl_test_sms_0", jobId: "job_cargo_pipeline_cpl_test_sms_0" }));
    expect(patch).toMatchObject({ step: "vapi", status: "bekliyor", next_run_at: new Date(now.getTime() + 60 * 60 * 1000) });
  });

  it("finishes without a phone and follows the VAPI policy", async () => {
    const { publish } = collect();
    const noPhone = await processCargoPipelineItem(item({ step: "sms", phone: null }), {
      store: store({}, { conversation: null }),
      publish,
      config,
      vapiPolicy,
      now,
    });
    expect(noPhone).toMatchObject({ step: "tamamlandi", status: "tamamlandi", error_message: "SMS atlandı: telefon yok" });

    const off = await processCargoPipelineItem(item({ step: "vapi" }), { store: store(), publish, config, vapiPolicy: { ...vapiPolicy, enabled: false }, now });
    expect(off).toMatchObject({ step: "tamamlandi", error_message: "VAPI atlandı: otomatik arama kapalı" });

    const late = await processCargoPipelineItem(item({ step: "vapi" }), { store: store(), publish, config, vapiPolicy: { ...vapiPolicy, start: "20:00", end: "21:00" }, now });
    expect(late).toMatchObject({ status: "bekliyor", error_message: "VAPI arama saatleri dışında — ertelendi" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("creates a VAPI call and waits for its result", async () => {
    const fake = store();
    const { jobs, publish } = collect();
    const patch = await processCargoPipelineItem(item({ step: "vapi" }), { store: fake, publish, config, vapiPolicy, now });
    expect(jobs[0]).toMatchObject({ name: "vapi.call.create", payload: { envelope: { payload: { call_public_id: "vcl_pipeline", customer_phone: "05551234567" } } } });
    expect(fake.markVapiCallQueued).toHaveBeenCalledWith(99, "job_cargo_pipeline_cpl_test_vapi_0");
    expect(patch).toEqual({ status: "isleniyor", vapi_call_id: 99, error_message: null });

    expect(vapiFollowUpPatch({ item: item({ step: "vapi" }), call_status: "tamamlandi" }, config, now)).toMatchObject({ step: "tamamlandi", status: "tamamlandi" });
    expect(vapiFollowUpPatch({ item: item({ step: "vapi" }), call_status: "basladi" }, config, now)).toBeNull();
    expect(vapiFollowUpPatch({ item: item({ step: "vapi", attempt_count: 2 }), call_status: "cevapsiz" }, config, now)).toMatchObject({ status: "hata", attempt_count: 3 });
    expect(vapiFollowUpPatch({ item: item({ step: "vapi" }), call_status: "cevapsiz" }, config, now)).toMatchObject({ status: "bekliyor", attempt_count: 1, vapi_call_id: null });
  });

  it("stops at max attempts", async () => {
    const { publish } = collect();
    const patch = await processCargoPipelineItem(item({ step: "sms", attempt_count: 3 }), { store: store(), publish, config, vapiPolicy, now });
    expect(patch).toEqual({ status: "hata", error_message: "Maksimum deneme sayısına ulaşıldı" });
  });

  it("only claims forced rows outside working hours and never enqueues while inactive", async () => {
    const inactive = store({ loadConfig: vi.fn(async () => ({ ...defaultCargoPipelineConfig, aktif: false })) });
    await runCargoPipelineTick({ store: inactive, publish: vi.fn(), now });
    expect(inactive.enqueueCandidates).not.toHaveBeenCalled();
    expect(inactive.claimDue).toHaveBeenCalledWith(now, false, 5);

    const claimed = item({ step: "sms" });
    const active = store({ claimDue: vi.fn(async () => [claimed]) });
    const { publish } = collect();
    const result = await runCargoPipelineTick({ store: active, publish, now });
    expect(active.claimDue).toHaveBeenCalledWith(now, true, 5);
    expect(result).toMatchObject({ active: true, processed: 1 });
    expect(active.update).toHaveBeenCalledWith(1, expect.objectContaining({ step: "vapi" }));
  });

  it("marks a row as failed when processing throws", async () => {
    const failing = store({
      claimDue: vi.fn(async () => [item()]),
      recordConversationMessage: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await runCargoPipelineTick({ store: failing, publish: vi.fn(), now });
    expect(failing.update).toHaveBeenCalledWith(1, { status: "hata", error_message: "db down" });
  });
});
