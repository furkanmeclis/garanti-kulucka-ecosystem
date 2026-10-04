import { describe, expect, it } from "vitest";
import { toProviderAttemptViewModel } from "../src/api/admin-client.js";
import { createApiClient } from "../src/api-client-boundary.js";
import { createBackendHttpClient } from "../src/api/http-client.js";

describe("web API client boundary", () => {
  it("creates a typed API client", () => {
    expect(createApiClient("http://localhost:3000")).toHaveProperty("health");
    expect(createApiClient("http://localhost:3000")).toHaveProperty("auth");
    expect(createApiClient("http://localhost:3000")).toHaveProperty("admin");
    expect(createApiClient("http://localhost:3000")).toHaveProperty("domain");
    expect(createApiClient("http://localhost:3000")).toHaveProperty("files");
    expect(createApiClient("http://localhost:3000")).toHaveProperty("webphone");
  });

  it("rejects direct Supabase or provider origins as backend URLs", () => {
    expect(() => createApiClient("https://project.supabase.co")).toThrow(
      "Web clients must talk to the backend API",
    );
    expect(() => createApiClient("https://graph.instagram.com")).toThrow(
      "Web clients must talk to the backend API",
    );
  });

  it("sends bearer tokens through the backend HTTP client", async () => {
    const requests: Request[] = [];
    const http = createBackendHttpClient({
      baseUrl: "http://localhost:3000",
      getAccessToken: () => "access-token",
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ status: "ok" });
      },
    });

    await http.request("/health/live");

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer access-token");
  });

  it("maps auth login to the backend route", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          access_token: "access",
          refresh_token: "refresh",
          token_type: "Bearer",
          expires_in: 900,
          user: {
            public_id: "usr_test",
            email: "admin@example.com",
            first_name: "Admin",
            last_name: "User",
            role: "admin",
          },
        });
      },
    });

    await client.auth.login("admin@example.com", "password");

    expect(requests[0]?.url).toBe("http://localhost:3000/auth/login");
    await expect(requests[0]?.json()).resolves.toEqual({
      email: "admin@example.com",
      password: "password",
    });
  });

  it("maps admin integration token updates without expecting token echo", async () => {
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async () =>
        Response.json({
          public_id: "itk_test",
          token_type: "access_token",
          value: null,
        }),
    });

    await expect(
      client.admin.upsertIntegrationToken("iac_test", "access_token", "secret"),
    ).resolves.toMatchObject({
      token_type: "access_token",
      value: null,
    });
  });

  it("maps admin integration setting updates to backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          public_id: "ias_webhook",
          key: "webhook.enabled",
          value: true,
          is_secret: false,
          updated_at: "2026-01-01T00:00:00.000Z",
        });
      },
    });

    await expect(
      client.admin.upsertIntegrationSetting("iac_instagram", "webhook.enabled", true),
    ).resolves.toMatchObject({
      key: "webhook.enabled",
      value: true,
      is_secret: false,
    });
    expect(requests[0]?.method).toBe("PUT");
    expect(requests[0]?.url).toBe(
      "http://localhost:3000/admin/integrations/accounts/iac_instagram/settings/webhook.enabled",
    );
  });

  it("maps admin integration account snapshots to backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          account: {
            public_id: "iac_instagram",
            provider_key: "instagram",
            provider_name: "Instagram Graph API",
            display_name: "Instagram Main",
            external_account_id: "17841400000000000",
            status: "active",
            metadata: {},
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          settings: [],
          tokens: [{ public_id: "itk_test", token_type: "access_token", value: null }],
        });
      },
    });

    await expect(client.admin.getIntegrationAccount("iac_instagram")).resolves.toMatchObject({
      account: {
        provider_key: "instagram",
      },
      tokens: [{ token_type: "access_token", value: null }],
    });
    expect(requests[0]?.url).toBe("http://localhost:3000/admin/integrations/accounts/iac_instagram");
  });

  it("maps Instagram analytics summaries to the backend admin route", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          followers: 2240,
          reach: 1980,
          impressions: 2450,
          profile_views: 187,
          engagement_rate: 8,
        });
      },
    });

    await expect(client.admin.getInstagramAnalyticsSummary("iac_instagram")).resolves.toMatchObject({
      followers: 2240,
      reach: 1980,
      profile_views: 187,
      engagement_rate: 8,
    });
    expect(requests[0]?.url).toBe(
      "http://localhost:3000/admin/integrations/accounts/iac_instagram/analytics-summary",
    );
  });

  it("maps admin audit trail reads to backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ data: [] });
      },
    });

    await client.admin.listSettingsAudit({ entity_id: "set_global", limit: 10 });
    await client.admin.listIntegrationAudit({ entity_id: "iac_instagram", limit: 25 });

    expect(requests[0]?.url).toBe(
      "http://localhost:3000/admin/settings/audit?entity_id=set_global&limit=10",
    );
    expect(requests[1]?.url).toBe(
      "http://localhost:3000/admin/integrations/audit?entity_id=iac_instagram&limit=25",
    );
  });

  it("maps provider attempt reads to backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          data: [
            {
              public_id: "pat_instagram",
              provider_key: "instagram",
              account_public_id: "iac_instagram",
              request_id: "req_123",
              operation: "send_message",
              direction: "outbound",
              status: "queued",
              status_code: null,
              duration_ms: 0,
              retry_decision: "none",
              next_retry_at: null,
              idempotency_key: "idem_123",
              request_metadata: {
                dry_run_request: {
                  headers: { authorization: "[redacted]" },
                },
              },
              provider_request_preview: {
                method: "POST",
                path: "/v18.0/me/messages",
                headers: { authorization: "[redacted]" },
                body: { recipient: { id: "17841400000000000" } },
                live_call_performed: false,
              },
              response_metadata: {},
              error_code: null,
              error_message: null,
              started_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      },
    });

    const response = await client.admin.listProviderAttempts({
      provider_key: "instagram",
      account_public_id: "iac_instagram",
      limit: 20,
    });

    expect(requests[0]?.url).toBe(
      "http://localhost:3000/admin/integrations/provider-attempts?provider_key=instagram&account_public_id=iac_instagram&limit=20",
    );
    expect(response.data[0]?.provider_request_preview).toMatchObject({
      method: "POST",
      path: "/v18.0/me/messages",
      headers: { authorization: "[redacted]" },
      live_call_performed: false,
    });
    expect(JSON.stringify(response)).not.toContain("plain-token");
  });

  it("maps provider debug summary reads to the backend route", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          providers: [
            {
              provider_key: "surat",
              total_attempts: 2,
              success_count: 1,
              failure_count: 1,
              retry_count: 1,
              average_duration_ms: 725,
              latest_attempt: null,
            },
          ],
          cron: {
            provider_keys: ["ptt", "surat"],
            operation: "shipment.track",
            total_attempts: 3,
            success_count: 2,
            failure_count: 1,
            retry_count: 1,
            total_duration_ms: 2320,
            latest_attempt: null,
          },
        });
      },
    });

    const response = await client.admin.getProviderDebugSummary();

    expect(requests[0]?.url).toBe("http://localhost:3000/admin/integrations/provider-debug-summary");
    expect(response.cron.total_duration_ms).toBe(2320);
    expect(response.providers[0]?.provider_key).toBe("surat");
  });

  it("maps report summary reads to the backend route", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          conversation_count: 7,
          order_count: 4,
          shipment_count: 5,
          total_revenue: 345.67,
          currency: "TRY",
          open_conversation_count: 3,
          pending_confirmation_count: 2,
          active_shipment_count: 4,
          delivered_shipment_count: 1,
          delivered_shipment_rate: 20,
          confirmation_rate: 50,
          active_shipment_rate: 80,
        });
      },
    });

    await expect(client.domain.getReportSummary()).resolves.toMatchObject({
      total_revenue: 345.67,
      currency: "TRY",
      delivered_shipment_rate: 20,
      confirmation_rate: 50,
    });
    expect(requests[0]?.url).toBe("http://localhost:3000/api/reports/summary");
  });

  it("maps provider catalog reads to backend routes without live-call enablement", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          data: [
            {
              provider: "ptt",
              channels: ["cargo"],
              supported_operations: ["shipment.create", "shipment.track"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.ptt.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
          ],
        });
      },
    });

    const response = await client.admin.listProviderCatalog();

    expect(requests[0]?.url).toBe("http://localhost:3000/admin/integrations/provider-catalog");
    expect(response.data[0]).toMatchObject({
      provider: "ptt",
      contract_mode: "fixture_only",
      live_call_permitted: false,
    });
  });

  it("maps provider cron debug triggers to fixture-safe backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          public_id: "pat_ptt_cron",
          provider_key: "ptt",
          account_public_id: null,
          request_id: "cron_ptt_cron_debug_ptt_manual",
          operation: "shipment.track",
          direction: "outbound",
          status: "success",
          status_code: 202,
          duration_ms: 0,
          retry_decision: "none",
          next_retry_at: null,
          idempotency_key: "cron_debug_ptt_manual",
          request_metadata: {},
          provider_request_preview: {
            method: "POST",
            path: "/api/ptt/cron-debug",
            headers: { authorization: "[redacted]" },
            body: { action: "cron-takip-guncelle" },
            live_call_performed: false,
          },
          response_metadata: { live_call_permitted: false },
          error_code: null,
          error_message: null,
          started_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        });
      },
    });

    await expect(
      client.admin.triggerProviderCronDebug("ptt", { idempotency_key: "cron_debug_ptt_manual" }),
    ).resolves.toMatchObject({
      provider_key: "ptt",
      provider_request_preview: {
        live_call_performed: false,
      },
    });
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://localhost:3000/admin/integrations/provider-cron-triggers/ptt");
    await expect(requests[0]?.json()).resolves.toEqual({
      idempotency_key: "cron_debug_ptt_manual",
    });
  });

  it("maps Instagram publish previews to fixture-safe backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          public_id: "pat_instagram_publish",
          provider_key: "instagram",
          account_public_id: "iac_instagram",
          request_id: "igpub_instagram_publish_iac_instagram",
          operation: "message.send",
          direction: "outbound",
          status: "success",
          status_code: 202,
          duration_ms: 0,
          retry_decision: "none",
          next_retry_at: null,
          idempotency_key: "instagram_publish_iac_instagram",
          request_metadata: {},
          provider_request_preview: {
            method: "POST",
            path: "/v18.0/ig_main/media",
            headers: { authorization: "[redacted]" },
            body: { image_url: "https://example.com/garanti-kulucka.jpg", caption: "caption" },
            live_call_performed: false,
          },
          response_metadata: { live_call_permitted: false },
          error_code: null,
          error_message: null,
          started_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        });
      },
    });

    await expect(
      client.admin.createInstagramPublishPreview({
        account_public_id: "iac_instagram",
        image_url: "https://example.com/garanti-kulucka.jpg",
        caption: "caption",
        idempotency_key: "instagram_publish_iac_instagram",
      }),
    ).resolves.toMatchObject({
      provider_key: "instagram",
      provider_request_preview: {
        live_call_performed: false,
      },
    });
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://localhost:3000/admin/integrations/instagram-publish-previews");
    await expect(requests[0]?.json()).resolves.toMatchObject({
      account_public_id: "iac_instagram",
      image_url: "https://example.com/garanti-kulucka.jpg",
      caption: "caption",
      idempotency_key: "instagram_publish_iac_instagram",
    });
  });

  it("normalizes provider request previews for admin view models", () => {
    const attempt = {
      public_id: "pat_ptt",
      provider_key: "ptt_kargo",
      account_public_id: "iac_ptt",
      request_id: "req_123",
      operation: "create_shipment",
      direction: "outbound",
      status: "queued",
      status_code: null,
      duration_ms: 0,
      retry_decision: "none",
      next_retry_at: null,
      idempotency_key: null,
      request_metadata: {},
      provider_request_preview: {
        method: "POST",
        path: "/services/Sorgu",
        headers: {
          authorization: "[redacted]",
          "content-type": "application/json",
          "x-invalid": 123,
        },
        body: { barcode: "KP123" },
        live_call_performed: false,
      },
      response_metadata: {},
      error_code: null,
      error_message: null,
      started_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    expect(toProviderAttemptViewModel(attempt).provider_request_preview).toEqual({
      method: "POST",
      path: "/services/Sorgu",
      headers: {
        authorization: "[redacted]",
        "content-type": "application/json",
      },
      body: { barcode: "KP123" },
      live_call_performed: false,
    });

    expect(
      toProviderAttemptViewModel({
        ...attempt,
        provider_request_preview: {
          ...attempt.provider_request_preview,
          live_call_performed: true,
        },
      }).provider_request_preview,
    ).toBeNull();
  });

  it("maps domain conversation reads to backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ data: [] });
      },
    });

    await client.domain.listConversations({ channel: "instagram", limit: 25 });
    await client.domain.getCommentModerationSummary();
    await client.domain.getBalanceSummary();
    await client.domain.getOrderSummary();
    await client.domain.listMessages("cnv_test");

    expect(requests[0]?.url).toBe("http://localhost:3000/api/conversations?channel=instagram&limit=25");
    expect(requests[1]?.url).toBe("http://localhost:3000/api/comments/moderation-summary");
    expect(requests[2]?.url).toBe("http://localhost:3000/api/balances/summary");
    expect(requests[3]?.url).toBe("http://localhost:3000/api/orders/summary");
    expect(requests[4]?.url).toBe("http://localhost:3000/api/conversations/cnv_test/messages?limit=100");
  });

  it("maps domain order filters to backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ data: [] });
      },
    });

    await client.domain.listOrders({ status: "active", limit: 20 });
    await client.domain.listOrders({ confirmation_status: "pending", limit: 20 });

    expect(requests[0]?.url).toBe("http://localhost:3000/api/orders?status=active&limit=20");
    expect(requests[1]?.url).toBe("http://localhost:3000/api/orders?confirmation_status=pending&limit=20");
  });

  it("maps domain order status updates to backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          public_id: "ord_test",
          order_number: "ORD-TEST",
          status: "cancelled",
          source: "manual",
          total_amount: "125.50",
          currency: "TRY",
          confirmation_status: null,
          notes: "cancel proof",
          customer_full_name: "Test Customer",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        });
      },
    });

    await client.domain.updateOrderStatus("ord_test", {
      status: "cancelled",
      notes: "cancel proof",
    });

    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.url).toBe("http://localhost:3000/api/orders/ord_test/status");
    await expect(requests[0]?.json()).resolves.toEqual({
      status: "cancelled",
      notes: "cancel proof",
    });
  });

  it("maps domain shipment filters to backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ data: [] });
      },
    });

    await client.domain.listShipments({ provider: "surat", limit: 20 });
    await client.domain.listShipments({ status: "delivered", limit: 20 });
    await client.domain.listShipments({ tracking_missing: true, limit: 20 });
    await client.domain.getShipmentPipelineSummary();

    expect(requests[0]?.url).toBe("http://localhost:3000/api/shipments?provider=surat&limit=20");
    expect(requests[1]?.url).toBe("http://localhost:3000/api/shipments?status=delivered&limit=20");
    expect(requests[2]?.url).toBe("http://localhost:3000/api/shipments?tracking_missing=true&limit=20");
    expect(requests[3]?.url).toBe("http://localhost:3000/api/shipments/pipeline-summary");
  });

  it("maps manual SMS sends to backend provider-delivery route", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          provider: "netgsm",
          operation: "sms.send",
          request_id: "req_sms",
          job_id: "job_sms",
          queued: true,
          recipient_phone: "5550000000",
          message_preview: "Merhaba",
          live_call_permitted: false,
        });
      },
    });

    await client.domain.sendSms({
      recipient_phone: "5550000000",
      message: "Merhaba",
      shipment_public_id: "shp_test",
      idempotency_key: "manual_sms_shp_test",
    });

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://localhost:3000/api/sms/send");
    await expect(requests[0]?.json()).resolves.toEqual({
      recipient_phone: "5550000000",
      message: "Merhaba",
      shipment_public_id: "shp_test",
      idempotency_key: "manual_sms_shp_test",
    });
  });

  it("maps balance payment requests to backend order routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          provider: "kolaybi",
          operation: "balance.payment_request",
          request_id: "payreq_payment_ord_test",
          queued: false,
          live_call_permitted: false,
          replayed: false,
          order_public_id: "ord_test",
          amount: "12.55",
          currency: "TRY",
          order: {
            public_id: "ord_test",
            order_number: "ORD-TEST",
            status: "draft",
            source: "manual",
            total_amount: "125.50",
            currency: "TRY",
            confirmation_status: null,
            notes: null,
            customer_full_name: "Test Customer",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:01:00.000Z",
          },
        });
      },
    });

    await client.domain.requestPayment("ord_test", {
      amount: "12.55",
      currency: "TRY",
      idempotency_key: "payment_ord_test",
    });

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://localhost:3000/api/orders/ord_test/payment-request");
    await expect(requests[0]?.json()).resolves.toEqual({
      amount: "12.55",
      currency: "TRY",
      idempotency_key: "payment_ord_test",
    });
  });

  it("maps file orphan cleanup dry-runs to backend file routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          mode: "dry_run",
          request_id: "orphan_cleanup_fil_orphan",
          deletion_performed: false,
          eligible_for_cleanup: true,
          reason: "admin_orphan_lifecycle_review",
          file: {
            public_id: "fil_orphan",
            bucket: "media",
            object_key: "uploads/orphan-proof.txt",
            original_name: "orphan-proof.txt",
            mime_type: "text/plain",
            byte_size: 42,
            checksum: "sha256:orphan-proof",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:01:00.000Z",
          },
          storage_action: {
            provider: "garage",
            bucket: "media",
            object_key: "uploads/orphan-proof.txt",
            operation: "delete_object",
          },
        });
      },
    });

    await client.files.createOrphanCleanupDryRun("fil_orphan");

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://localhost:3000/api/files/fil_orphan/orphan-cleanup-dry-run");
    await expect(requests[0]?.json()).resolves.toEqual({
      reason: "admin_orphan_lifecycle_review",
    });
  });

  it("maps webphone config reads to backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          enabled: true,
          sip_websocket_url: "wss://sip.example.com/ws",
          sip_domain: "sip.example.com",
          sip_username: "agent100",
          sip_password: "secret",
          ice_servers: [],
          media_proxy_enabled: false,
          transport: "direct_sip_over_webrtc",
        });
      },
    });

    await client.webphone.getConfig();

    expect(requests[0]?.url).toBe("http://localhost:3000/api/webphone/config");
  });

  it("maps VAPI test calls to fixture-safe webphone backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          public_id: "pat_vapi_test",
          provider_key: "vapi",
          account_public_id: null,
          request_id: "vapitest_vapi_test_05051234567",
          operation: "call.test",
          direction: "outbound",
          status: "success",
          status_code: 202,
          duration_ms: 0,
          retry_decision: "none",
          next_retry_at: null,
          idempotency_key: "vapi_test_05051234567",
          request_metadata: {},
          provider_request_preview: {
            method: "POST",
            path: "/vapi/calls",
            headers: { authorization: "[redacted]" },
            body: { customer_phone: "05051234567" },
            live_call_performed: false,
          },
          response_metadata: { mode: "dry_run", queued: false, live_call_permitted: false },
          error_code: null,
          error_message: null,
          started_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        });
      },
    });

    await client.webphone.createTestCall({
      customer_name: "Test Müşteri",
      customer_phone: "05051234567",
      cargo_provider: "PTT",
      tracking_number: "TRK-PLAYWRIGHT",
      last_event_text: "Accepted at branch",
      idempotency_key: "vapi_test_05051234567",
    });

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://localhost:3000/api/webphone/test-call");
    await expect(requests[0]?.json()).resolves.toEqual({
      customer_name: "Test Müşteri",
      customer_phone: "05051234567",
      cargo_provider: "PTT",
      tracking_number: "TRK-PLAYWRIGHT",
      last_event_text: "Accepted at branch",
      idempotency_key: "vapi_test_05051234567",
    });
  });
});
