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
  const type = pickFirstString(readPath(body, ["type"]), readPath(body, ["event_type"]));
  const callId = pickFirstString(
    readPath(body, ["call", "id"]),
    readPath(body, ["call_id"]),
    readPath(body, ["message", "call", "id"]),
  );
  if (type && callId) {
    return `${type}:${callId}`;
  }

  const change = ["entry", "0", "changes", "0", "value"];
  const statusId = pickFirstString(readPath(body, [...change, "statuses", "0", "id"]));
  const statusValue = pickFirstString(readPath(body, [...change, "statuses", "0", "status"])) ?? "status";
  const isComment = readPath(body, ["entry", "0", "changes", "0", "field"]) === "comments" || readPath(body, [...change, "item"]) === "comment";
  const commentId = isComment ? pickFirstString(readPath(body, [...change, "id"]), readPath(body, [...change, "comment_id"])) : null;

  // Status receipts and comments use their own ids. Never the entry id: that is the WABA / page / IG account id,
  // identical for every event, so it turned every later receipt or comment into a "replay" that was dropped.
  return pickFirstString(
    readPath(body, ["event_id"]),
    readPath(body, ["id"]),
    readPath(body, ["message", "id"]),
    readPath(body, ["message", "mid"]),
    readPath(body, ["entry", "0", "messaging", "0", "message", "mid"]),
    readPath(body, [...change, "messages", "0", "id"]),
    statusId ? `status:${statusId}:${statusValue}` : null,
    commentId ? `comment:${commentId}` : null,
  );
}
