export interface MetaGraphTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface MetaGraphErrorBody {
  code: number | null;
  message: string | null;
  type: string | null;
  subcode: number | null;
  fbtrace_id: string | null;
}

export function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

export function stringValue(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "number" && Number.isFinite(input)) return String(input);
  return "";
}

export function stringSetting(settings: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = stringValue(settings[key]);
    if (value.length > 0) return value;
  }
  return fallback;
}

export function stringToken(tokens: Record<string, unknown>, keys: string[], fallback = ""): string {
  return stringSetting(tokens, keys, fallback);
}

export function payloadString(payload: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = stringValue(payload[key]);
    if (value.length > 0) return value;
  }
  return fallback;
}

export function parseMetaJson(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function metaGraphError(parsed: Record<string, unknown> | null): MetaGraphErrorBody | null {
  const error = isRecord(parsed?.error) ? parsed.error : null;
  if (!error) return null;
  const code = Number(error.code);
  const subcode = Number(error.error_subcode);
  return {
    code: Number.isFinite(code) ? code : null,
    message: typeof error.message === "string" ? error.message : null,
    type: typeof error.type === "string" ? error.type : null,
    subcode: Number.isFinite(subcode) ? subcode : null,
    fbtrace_id: typeof error.fbtrace_id === "string" ? error.fbtrace_id : null,
  };
}

export function hasMetaGraphError(parsed: Record<string, unknown> | null): boolean {
  return metaGraphError(parsed) !== null;
}

export function metaGraphErrorCode(parsed: Record<string, unknown> | null): number | null {
  return metaGraphError(parsed)?.code ?? null;
}

export function isMetaTokenError(response: MetaGraphTransportResponse, parsed: Record<string, unknown> | null): boolean {
  return response.status === 401 || metaGraphErrorCode(parsed) === 190;
}

export function isMetaRateLimitError(response: MetaGraphTransportResponse, parsed: Record<string, unknown> | null): boolean {
  const code = metaGraphErrorCode(parsed);
  return code === 4 || code === 17 || code === 613;
}

export function redactMetaHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) =>
      key.toLowerCase() === "authorization" ? [key, "[redacted]"] : [key, value],
    ),
  );
}

export function metaGraphResponseMetadata(response: MetaGraphTransportResponse): Record<string, unknown> {
  const parsed = parseMetaJson(response.body);
  const error = metaGraphError(parsed);
  const bodyPreview = error
    ? JSON.stringify({
        ...parsed,
        error: {
          ...((isRecord(parsed?.error) ? parsed.error : {}) as Record<string, unknown>),
          message: "[redacted]",
        },
      }).slice(0, 800)
    : response.body.slice(0, 800);
  return {
    live_call_performed: true,
    accepted: response.status >= 200 && response.status < 300 && !error,
    status_code: response.status,
    headers: response.headers,
    body_bytes: Buffer.byteLength(response.body, "utf8"),
    body_preview: bodyPreview,
    ...(error
      ? {
          graph_error: {
            code: error.code,
            subcode: error.subcode,
            type: error.type,
            fbtrace_id: error.fbtrace_id,
          },
        }
      : {}),
  };
}
