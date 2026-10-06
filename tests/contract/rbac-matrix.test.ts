import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Role = "anonymous" | "kargo_operatoru" | "calisan" | "admin";
type Outcome = "allow" | "deny";
type Matrix = Record<string, Record<Role, Outcome>>;

interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
}

const document = JSON.parse(readFileSync("contracts/openapi/backend-api.json", "utf8")) as OpenApiDocument;
const matrix = JSON.parse(readFileSync("tests/contract/rbac-matrix.json", "utf8")) as Matrix;

function operationKeys() {
  return Object.entries(document.paths)
    .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`))
    .sort();
}

describe("API RBAC permission matrix", () => {
  it("enumerates every OpenAPI route for anonymous, cargo, staff, and admin roles", () => {
    expect(Object.keys(matrix).sort()).toEqual(operationKeys());

    for (const [operation, expectations] of Object.entries(matrix)) {
      expect(Object.keys(expectations).sort()).toEqual(["admin", "anonymous", "calisan", "kargo_operatoru"]);
      expect(expectations.admin).toBe("allow");
      expect(expectations.anonymous).toBe(
        operation.startsWith("GET /health/") || operation === "POST /auth/login" || operation === "POST /auth/refresh"
          ? "allow"
          : "deny",
      );
    }
  });

  it("pins legacy-role decisions that must stay intentionally restrictive", () => {
    expect(matrix["GET /api/webphone/config"]).toMatchObject({
      kargo_operatoru: "allow",
      calisan: "allow",
      admin: "allow",
    });
    expect(matrix["GET /api/conversations"]).toMatchObject({ kargo_operatoru: "deny", calisan: "allow" });
    expect(matrix["GET /api/products"]).toMatchObject({ kargo_operatoru: "deny", calisan: "allow" });
    expect(matrix["GET /api/reports/analysis"]).toMatchObject({ kargo_operatoru: "deny", calisan: "deny" });
    expect(matrix["POST /api/instagram/publications"]).toMatchObject({ kargo_operatoru: "deny", calisan: "allow" });
    expect(matrix["GET /api/instagram/insights/account"]).toMatchObject({ kargo_operatoru: "deny", calisan: "allow" });
    expect(matrix["GET /api/reports/summary"]).toMatchObject({ kargo_operatoru: "deny", calisan: "deny" });
    expect(matrix["GET /api/files/orphans"]).toMatchObject({ kargo_operatoru: "deny", calisan: "deny" });
    // Legacy App.jsx: /sesli-asistan and /sesli-asistan/vapi are admin only.
    expect(matrix["POST /api/vapi/calls"]).toMatchObject({ kargo_operatoru: "deny", calisan: "deny", admin: "allow" });
    expect(matrix["GET /api/netgsm/cdr"]).toMatchObject({ kargo_operatoru: "deny", calisan: "deny", admin: "allow" });
  });
});
