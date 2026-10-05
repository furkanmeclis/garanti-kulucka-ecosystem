import { assertBackendBaseUrl } from "./backend-boundary.js";

export interface BackendHttpClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null;
  fetchImpl?: typeof fetch;
}

export interface BackendRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

export interface BackendHttpClient {
  request: <T>(path: string, options?: BackendRequestOptions) => Promise<T>;
}

export class BackendRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "BackendRequestError";
  }
}

export function createBackendHttpClient(options: BackendHttpClientOptions): BackendHttpClient {
  assertBackendBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    request: async <T>(path: string, requestOptions: BackendRequestOptions = {}) => {
      const headers = new Headers();
      headers.set("accept", "application/json");

      const token = options.getAccessToken?.();
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }

      let body: string | undefined;
      if (requestOptions.body !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(requestOptions.body);
      }

      const requestInit: RequestInit = {
        method: requestOptions.method ?? "GET",
        headers,
      };
      if (body !== undefined) {
        requestInit.body = body;
      }

      const response = await fetchImpl(new URL(path, options.baseUrl), requestInit);

      if (!response.ok) {
        const responseBody = await response.json().catch(() => null);
        throw new BackendRequestError(`Backend request failed: ${response.status}`, response.status, responseBody);
      }

      return response.json() as Promise<T>;
    },
  };
}
