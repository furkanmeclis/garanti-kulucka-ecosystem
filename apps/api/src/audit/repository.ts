import type { AppDatabase, AuditLogsTable } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";

export type AuditLogRecord = Selectable<AuditLogsTable>;

const secretKeyPattern = /(^|_|\.)((access|refresh|verify)?_?token|authorization|api_?key|password|secret)$/i;

export interface ListAuditLogsInput {
  entityTypes: string[];
  entityId: string | null;
  limit: number;
}

export interface CountAuditLogsInput {
  entityTypes: string[];
  entityId: string | null;
}

export class AuditRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(input: ListAuditLogsInput): Promise<AuditLogRecord[]> {
    let query = this.db
      .selectFrom("audit_logs")
      .selectAll()
      .where("entity_type", "in", input.entityTypes)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(input.limit, 100)));

    if (input.entityId) {
      query = query.where("entity_id", "=", input.entityId);
    }

    return query.execute();
  }

  async count(input: CountAuditLogsInput): Promise<number> {
    let query = this.db
      .selectFrom("audit_logs")
      .select((expression) => [expression.fn.countAll<number>().as("total_count")])
      .where("entity_type", "in", input.entityTypes);

    if (input.entityId) {
      query = query.where("entity_id", "=", input.entityId);
    }

    const row = await query.executeTakeFirst();
    return Number(row?.total_count ?? 0);
  }
}

export function parseAuditLimit(value: string | undefined, fallback = 50) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(parsed, 100));
}

export function serializeAuditLog(record: AuditLogRecord) {
  return {
    id: record.id,
    actor_user_id: record.actor_user_id,
    action: record.action,
    entity_type: record.entity_type,
    entity_id: record.entity_id,
    old_value: redactAuditValue(record.old_value),
    new_value: redactAuditValue(record.new_value),
    ip_address: record.ip_address,
    user_agent: record.user_agent,
    created_at: record.created_at,
  };
}

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactAuditValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      secretKeyPattern.test(key) ? "[redacted]" : redactAuditValue(nestedValue),
    ]),
  );
}
