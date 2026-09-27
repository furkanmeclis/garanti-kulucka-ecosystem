export interface ParsedWebhookPayload {
  rawBody: string;
  body: unknown;
}

export function parseWebhookBody(rawBody: string, contentType: string | null): unknown {
  if (!rawBody) {
    return {};
  }

  if (contentType?.toLowerCase().includes("application/json")) {
    return JSON.parse(rawBody) as unknown;
  }

  return {
    raw_body: rawBody,
  };
}

export function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

export function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function inferEventType(body: unknown): string {
  return (
    pickFirstString(
      readPath(body, ["event_type"]),
      readPath(body, ["type"]),
      readPath(body, ["event", "type"]),
      readPath(body, ["object"]),
    ) ?? "provider.webhook"
  );
}

export function inferExternalEventId(body: unknown): string | null {
  return pickFirstString(
    readPath(body, ["event_id"]),
    readPath(body, ["id"]),
    readPath(body, ["message", "id"]),
    readPath(body, ["entry", "0", "id"]),
  );
}
