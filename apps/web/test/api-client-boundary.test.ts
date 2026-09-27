import { describe, expect, it } from "vitest";
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

  it("maps domain conversation reads to backend routes", async () => {
    const requests: Request[] = [];
    const client = createApiClient("http://localhost:3000", {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ data: [] });
      },
    });

    await client.domain.listConversations({ channel: "instagram", limit: 25 });
    await client.domain.listMessages("cnv_test");

    expect(requests[0]?.url).toBe("http://localhost:3000/api/conversations?channel=instagram&limit=25");
    expect(requests[1]?.url).toBe("http://localhost:3000/api/conversations/cnv_test/messages?limit=100");
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
});
