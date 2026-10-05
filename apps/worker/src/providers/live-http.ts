export interface LiveHttpTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface LiveHttpTransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | FormData | null;
  timeout_ms: number;
}

export async function fetchLiveHttpTransport(
  request: LiveHttpTransportRequest,
  providerDisplayName: string,
): Promise<LiveHttpTransportResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeout_ms);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === null || (request.body === "" && (request.method === "GET" || request.method === "DELETE"))
        ? {}
        : { body: request.body }),
      signal: controller.signal,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(`${providerDisplayName} request timed out after ${request.timeout_ms}ms`);
      Object.assign(timeoutError, { code: "timeout" });
      throw timeoutError;
    }
    const networkError = error instanceof Error ? error : new Error(`${providerDisplayName} network error`);
    Object.assign(networkError, { code: "network_error" });
    throw networkError;
  } finally {
    clearTimeout(timeout);
  }
}

export function failureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return "network_error";
}

export function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
