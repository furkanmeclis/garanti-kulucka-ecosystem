import { describe, expect, it } from "vitest";
import { createApiClient } from "../src/api-client-boundary.js";
import { createBackendHttpClient } from "../src/api/http-client.js";

describe("web API client boundary", () => {
  it("creates a typed API client", () => {
    expect(createApiClient("http://localhost:3000")).toHaveProperty("health");
    expect(createApiClient("http://localhost:3000")).toHaveProperty("auth");
    expect(createApiClient("http://localhost:3000")).toHaveProperty("admin");
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
});
