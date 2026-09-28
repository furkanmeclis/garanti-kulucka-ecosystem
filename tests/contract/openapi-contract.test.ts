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
  ["/api/conversations/{conversation_public_id}/messages", ["get", "post"]],
  ["/api/orders", ["get", "post"]],
  ["/api/shipments", ["get"]],
  ["/api/shipments/{shipment_public_id}/status", ["patch"]],
  ["/api/files/uploads", ["post"]],
  ["/api/files/{file_public_id}", ["get"]],
  ["/api/webphone/config", ["get"]],
  ["/admin/settings", ["get"]],
  ["/admin/settings/{key}", ["put"]],
  ["/admin/integrations/providers", ["get"]],
  ["/admin/integrations/accounts", ["get", "post"]],
  ["/admin/integrations/accounts/{account_public_id}", ["get"]],
  ["/admin/integrations/accounts/{account_public_id}/settings/{key}", ["put"]],
  ["/admin/integrations/accounts/{account_public_id}/tokens/{token_type}", ["put"]],
  ["/admin/integrations/provider-attempts", ["get"]],
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
        "ConversationList",
        "Message",
        "Order",
        "Shipment",
        "FileUpload",
        "WebphoneConfig",
        "Setting",
        "IntegrationAccountSnapshot",
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
