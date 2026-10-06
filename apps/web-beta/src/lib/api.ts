import type {
  AuthSession,
  AuthUser,
  BackendErrorBody,
  ConversationSummary,
  ConversationSummaryStats,
  CustomerSummary,
  CustomerSummaryStats,
  ListEnvelope,
  OrderSummary,
  OrderSummaryStats,
  ShipmentSummary,
  ShipmentSummaryStats,
  TokenPair,
} from "@garanti-kulucka/shared";
import type { StoredTokens } from "./session-storage";

/** VITE_BACKEND_BASE_URL (default "/backend"): same-origin proxy in Docker/nginx and the Vite dev server. */
export const defaultBackendBaseUrl = "/backend";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** True when the request never reached the server (offline, DNS, CORS). */
export function isNetworkError(error: unknown) {
  return error instanceof TypeError || (error instanceof ApiError && error.status === 0);
}

type QueryValue = string | number | boolean | null | undefined;

export interface ApiClientOptions {
  baseUrl?: string;
  getTokens: () => StoredTokens | null;
  setTokens: (tokens: StoredTokens | null) => void;
  /** Called once a request is rejected and the refresh token could not renew the session. */
  onSessionExpired?: () => void;
  fetchImpl?: typeof fetch;
}

export interface OrderListQuery {
  search?: string;
  status?: string;
  cargo_provider?: string;
  sort_by?: "created_at" | "order_number" | "status" | "total_amount";
  sort_direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface ShipmentListQuery {
  search?: string;
  provider?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ConversationListQuery {
  channel?: string;
  status?: string;
  limit?: number;
}

export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>) {
  const base = baseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `${base}${path.startsWith("/") ? path : `/${path}`}${search ? `?${search}` : ""}`;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? defaultBackendBaseUrl;
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  let refreshing: Promise<boolean> | null = null;

  async function send(path: string, init: { method?: string; body?: unknown; query?: Record<string, QueryValue>; auth?: boolean }) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    const tokens = init.auth === false ? null : options.getTokens();
    if (tokens) headers.Authorization = `Bearer ${tokens.access_token}`;
    return fetchImpl(buildUrl(baseUrl, path, init.query), {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  }

  async function refreshSession(): Promise<boolean> {
    const tokens = options.getTokens();
    if (!tokens) return false;
    refreshing ??= (async () => {
      try {
        const response = await send("/auth/refresh", { method: "POST", body: { refresh_token: tokens.refresh_token }, auth: false });
        if (!response.ok) return false;
        const pair = (await response.json()) as TokenPair;
        options.setTokens({ access_token: pair.access_token, refresh_token: pair.refresh_token });
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, QueryValue>; auth?: boolean } = {}): Promise<T> {
    let response = await send(path, init);
    if (response.status === 401 && init.auth !== false && options.getTokens()) {
      if (await refreshSession()) {
        response = await send(path, init);
      }
      if (response.status === 401) {
        options.setTokens(null);
        options.onSessionExpired?.();
      }
    }
    if (!response.ok) {
      let body: BackendErrorBody | null = null;
      try {
        body = (await response.json()) as BackendErrorBody;
      } catch {
        body = null;
      }
      throw new ApiError(response.status, body?.error?.code ?? null, body?.error?.message ?? `HTTP ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    baseUrl,
    async login(email: string, password: string) {
      const session = await request<AuthSession>("/auth/login", { method: "POST", body: { email, password }, auth: false });
      options.setTokens({ access_token: session.access_token, refresh_token: session.refresh_token });
      return session;
    },
    me: () => request<AuthUser>("/auth/me"),
    async logout() {
      try {
        if (options.getTokens()) await request<unknown>("/auth/logout", { method: "POST" });
      } finally {
        options.setTokens(null);
      }
    },
    updateProfile: (input: { first_name: string; last_name?: string }) =>
      request<{ first_name: string; last_name: string }>("/auth/account/profile", { method: "PATCH", body: input }),
    changePassword: (input: { password: string; password_confirmation: string }) =>
      request<{ updated: boolean }>("/auth/account/password", { method: "POST", body: input }),
    orderSummary: () => request<OrderSummaryStats>("/api/orders/summary"),
    conversationSummary: () => request<ConversationSummaryStats>("/api/conversations/summary"),
    customerSummary: () => request<CustomerSummaryStats>("/api/customers/summary"),
    shipmentSummary: () => request<ShipmentSummaryStats>("/api/shipments/summary"),
    listOrders: (query: OrderListQuery = {}) => request<ListEnvelope<OrderSummary>>("/api/orders", { query: { ...query } }),
    listShipments: (query: ShipmentListQuery = {}) => request<ListEnvelope<ShipmentSummary>>("/api/shipments", { query: { ...query } }),
    listConversations: (query: ConversationListQuery = {}) =>
      request<ListEnvelope<ConversationSummary>>("/api/conversations", { query: { ...query } }),
    listCustomers: (limit = 200) => request<ListEnvelope<CustomerSummary>>("/api/customers", { query: { limit } }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
