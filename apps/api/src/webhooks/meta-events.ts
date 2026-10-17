/** One durable receipt per Meta event, so overlapping batches cannot drop new messages or replay old ones. */
export function splitMetaWebhookBody(body: unknown): unknown[] {
  if (!body || typeof body !== "object" || !("entry" in body) || !Array.isArray(body.entry)) return [body];
  const events: unknown[] = [];
  for (const entry of body.entry) {
    if (!entry || typeof entry !== "object") continue;
    const { messaging: _messaging, standby: _standby, changes: _changes, ...entryMetadata } = entry;
    for (const field of ["messaging", "standby", "changes"] as const) {
      if (!Array.isArray(entry[field])) continue;
      for (const item of entry[field]) {
        if (field === "changes" && item?.value && typeof item.value === "object") {
          for (const collection of ["messages", "statuses"] as const) {
            if (!Array.isArray(item.value[collection])) continue;
            const items = item.value[collection].map((value: unknown) => {
              const { messages: _messages, statuses: _statuses, ...rest } = item.value;
              return { ...item, value: { ...rest, [collection]: [value] } };
            });
            for (const value of items) events.push({ ...body, entry: [{ ...entryMetadata, changes: [value] }] });
          }
          if (Array.isArray(item.value.messages) || Array.isArray(item.value.statuses)) continue;
        }
        if (field !== "changes" && Array.isArray(item?.delivery?.mids)) {
          for (const mid of item.delivery.mids) events.push({ ...body, entry: [{ ...entryMetadata, [field]: [{ ...item, delivery: { ...item.delivery, mids: [mid] } }] }] });
        } else {
          events.push({ ...body, entry: [{ ...entryMetadata, [field]: [item] }] });
        }
      }
    }
  }
  return events.length ? events : [body];
}
