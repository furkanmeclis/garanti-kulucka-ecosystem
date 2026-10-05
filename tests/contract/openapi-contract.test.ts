import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
}

const document = JSON.parse(
  readFileSync("contracts/openapi/backend-api.json", "utf8"),
) as OpenApiDocument;

const expectedOperations = new Map<string, string[]>([
  ["/health/live", ["get"]],
  ["/health/ready", ["get"]],
  ["/auth/login", ["post"]],
  ["/auth/refresh", ["post"]],
  ["/auth/logout", ["post"]],
  ["/auth/me", ["get"]],
  ["/api/conversations", ["get"]],
  ["/api/conversations/summary", ["get"]],
  ["/api/comments/moderation-summary", ["get"]],
  ["/api/conversations/{conversation_public_id}/messages", ["get", "post"]],
  ["/api/conversations/{conversation_public_id}/state", ["patch"]],
  ["/api/customers", ["get"]],
  ["/api/customers/summary", ["get"]],
  ["/api/orders", ["get", "post"]],
  ["/api/orders/summary", ["get"]],
  ["/api/orders/{order_public_id}/status", ["patch"]],
  ["/api/orders/{order_public_id}/payment-request", ["post"]],
  ["/api/balances/summary", ["get"]],
  ["/api/products", ["get"]],
  ["/api/products/summary", ["get"]],
  ["/api/shipments", ["get"]],
  ["/api/shipments/summary", ["get"]],
  ["/api/shipments/pipeline-summary", ["get"]],
  ["/api/shipments/{shipment_public_id}/status", ["patch"]],
  ["/api/reports/summary", ["get"]],
  ["/api/sms/send", ["post"]],
  ["/api/files/uploads", ["post"]],
  ["/api/files/multipart-uploads", ["post"]],
  ["/api/files/{file_public_id}/multipart-uploads/parts", ["post"]],
  ["/api/files/{file_public_id}/multipart-uploads/complete", ["post"]],
  ["/api/files/{file_public_id}/multipart-uploads/abort", ["post"]],
  ["/api/files/orphans", ["get"]],
  ["/api/files/{file_public_id}/orphan-cleanup-dry-run", ["post"]],
  ["/api/files/{file_public_id}/orphan-cleanup", ["post"]],
  ["/api/files/{file_public_id}/download", ["get"]],
  ["/api/files/{file_public_id}", ["get"]],
  ["/api/webphone/config", ["get"]],
  ["/api/webphone/test-call", ["post"]],
  ["/admin/settings", ["get"]],
  ["/admin/settings/{key}", ["put"]],
  ["/admin/settings/{key}/versions", ["get"]],
  ["/admin/settings/{key}/rollback", ["post"]],
  ["/admin/integrations/providers", ["get"]],
  ["/admin/integrations/provider-catalog", ["get"]],
  ["/admin/integrations/accounts", ["get", "post"]],
  ["/admin/integrations/accounts/{account_public_id}", ["get"]],
  ["/admin/integrations/accounts/{account_public_id}/analytics-summary", ["get"]],
  ["/admin/integrations/accounts/{account_public_id}/settings/{key}", ["put"]],
  ["/admin/integrations/accounts/{account_public_id}/tokens/{token_type}", ["put"]],
  ["/admin/integrations/provider-attempts", ["get"]],
  ["/admin/integrations/provider-debug-summary", ["get"]],
  ["/admin/integrations/provider-cron-triggers/{provider_key}", ["post"]],
  ["/admin/integrations/instagram-publish-previews", ["post"]],
]);

describe("backend OpenAPI contract", () => {
  it("pins the backend-owned route surface consumed by the web app", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual([...expectedOperations.keys()].sort());

    for (const [path, methods] of expectedOperations) {
      expect(Object.keys(document.paths[path] ?? {}).sort()).toEqual(methods.sort());
    }
  });

  it("keeps auth, admin, domain, file, and webphone schemas named", () => {
    expect(document.components.securitySchemes?.bearerAuth).toBeDefined();
    expect(Object.keys(document.components.schemas ?? {})).toEqual(
      expect.arrayContaining([
        "AuthSession",
        "AuthUser",
        "Conversation",
        "ListMeta",
        "ConversationList",
        "ConversationSummaryStats",
        "CommentModerationSummary",
        "BalanceSummary",
        "UpdateConversationStateRequest",
        "Message",
        "Customer",
        "CustomerList",
        "CustomerSummaryStats",
        "Order",
        "OrderSummaryStats",
        "Product",
        "ProductList",
        "ProductSummaryStats",
        "CreatePaymentRequest",
        "PaymentRequestResponse",
        "SendSmsRequest",
        "SendSmsResponse",
        "Shipment",
        "ShipmentSummaryStats",
        "ShipmentPipelineSummary",
        "ShipmentPipelineRow",
        "ReportSummary",
        "FileUpload",
        "FileOrphanList",
        "FileOrphanCleanupDryRun",
        "WebphoneConfig",
        "WebphoneTestCallRequest",
        "Setting",
        "SettingVersion",
        "SettingVersionList",
        "SettingRollbackRequest",
        "IntegrationAccountSnapshot",
        "InstagramAnalyticsSummary",
        "InstagramPublishPreviewRequest",
        "ProviderAttempt",
        "ProviderCatalogList",
        "ProviderDebugSummary",
        "ProviderCronTriggerRequest",
      ]),
    );
  });

  it("keeps login and health routes explicitly public", () => {
    expect(document.paths["/auth/login"]?.post).toMatchObject({ security: [] });
    expect(document.paths["/auth/refresh"]?.post).toMatchObject({ security: [] });
    expect(document.paths["/health/live"]?.get).toMatchObject({ security: [] });
    expect(document.paths["/health/ready"]?.get).toMatchObject({ security: [] });
  });
});
