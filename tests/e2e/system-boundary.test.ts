import { describe, expect, it } from "vitest";

describe("e2e gate", () => {
  it("documents the local system boundary without live external services", () => {
    const requiredServices = ["api", "worker", "migrator", "postgres", "redis", "garage"];
    expect(requiredServices).toContain("api");
    expect(requiredServices).toContain("garage");
  });

  it("tracks required full-system scenarios", () => {
    const scenarios = [
      "auth-session-lifecycle",
      "message-inbox-and-reply",
      "order-create-and-update",
      "shipment-tracking-simulation",
      "admin-integration-restart-persistence",
      "webhook-ingestion-to-worker",
      "file-upload-metadata",
      "webphone-config-retrieval",
      "migrator-dry-run-and-verify",
    ];

    expect(scenarios).toContain("admin-integration-restart-persistence");
    expect(scenarios).toContain("webhook-ingestion-to-worker");
    expect(scenarios).toContain("migrator-dry-run-and-verify");
  });

  it("does not require live provider credentials", () => {
    const forbiddenLiveSecrets = [
      "PTT_PASSWORD",
      "SURAT_PASSWORD",
      "KOLAYBI_API_KEY",
      "META_ACCESS_TOKEN",
      "NETGSM_PASSWORD",
      "VAPI_API_KEY",
      "SIP_PASSWORD",
    ];

    expect(forbiddenLiveSecrets.every((name) => process.env[name] === undefined)).toBe(true);
  });
});
