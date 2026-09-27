import type { HealthStatus } from "@garanti-kulucka/shared";
import { createAdminClient } from "./api/admin-client.js";
import { createAuthClient } from "./api/auth-client.js";
import { createDomainClient } from "./api/domain-client.js";
import { createFileClient } from "./api/file-client.js";
import { createBackendHttpClient, type BackendHttpClientOptions } from "./api/http-client.js";
import { createWebphoneClient } from "./api/webphone-client.js";

export type BackendApiClient = {
  health(): Promise<HealthStatus>;
  auth: ReturnType<typeof createAuthClient>;
  admin: ReturnType<typeof createAdminClient>;
  domain: ReturnType<typeof createDomainClient>;
  files: ReturnType<typeof createFileClient>;
  webphone: ReturnType<typeof createWebphoneClient>;
};

export function createApiClient(baseUrl: string, options: Omit<BackendHttpClientOptions, "baseUrl"> = {}): BackendApiClient {
  const http = createBackendHttpClient({ baseUrl, ...options });

  return {
    async health() {
      return http.request<HealthStatus>("/health/ready");
    },
    auth: createAuthClient(http),
    admin: createAdminClient(http),
    domain: createDomainClient(http),
    files: createFileClient(http),
    webphone: createWebphoneClient(http),
  };
}
