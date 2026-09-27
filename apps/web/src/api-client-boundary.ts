import type { HealthStatus } from "@garanti-kulucka/shared";

export type BackendApiClient = {
  health(): Promise<HealthStatus>;
};

export function createApiClient(baseUrl: string): BackendApiClient {
  return {
    async health() {
      const response = await fetch(new URL("/health/ready", baseUrl));
      if (!response.ok) throw new Error("Backend health check failed");
      return response.json() as Promise<HealthStatus>;
    },
  };
}
