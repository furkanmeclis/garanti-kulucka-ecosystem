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

export function createBackendHttpClient(options: BackendHttpClientOptions): BackendHttpClient {
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
        throw new Error(`Backend request failed: ${response.status}`);
      }

      return response.json() as Promise<T>;
    },
  };
}
