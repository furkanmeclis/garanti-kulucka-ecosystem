import { randomUUID } from "node:crypto";
import type { AppDatabase, ProviderAttemptsTable } from "@garanti-kulucka/database";
import { redactValue, type ProviderAttempt } from "@garanti-kulucka/shared";
import type { Insertable, Selectable } from "kysely";

export type StoredProviderAttempt = Selectable<ProviderAttemptsTable>;
export type NewProviderAttempt = Insertable<ProviderAttemptsTable>;

export interface ProviderAttemptRepository {
  persist: (attempt: ProviderAttempt) => Promise<StoredProviderAttempt>;
}

export interface ProviderAttemptResolvedReferences {
  providerId: number;
  accountId: number | null;
}

export type ProviderAttemptPublicIdFactory = () => string;

export function createProviderAttemptPublicId(): string {
  return `pat_${randomUUID().replaceAll("-", "")}`;
}

export function sanitizeProviderAttemptMetadata(value: unknown): unknown {
  return redactValue(value);
}

export function mapProviderAttemptToInsert(
  attempt: ProviderAttempt,
  refs: ProviderAttemptResolvedReferences,
  publicId: string,
): NewProviderAttempt {
  return {
    public_id: publicId,
    provider_id: refs.providerId,
    account_id: refs.accountId,
    request_id: attempt.request_id,
    operation: attempt.operation,
    direction: attempt.direction,
    status: attempt.status,
    status_code: attempt.status_code,
    duration_ms: attempt.duration_ms,
    retry_decision: attempt.retry_decision,
    next_retry_at: attempt.next_retry_at,
    idempotency_key: attempt.idempotency_key,
    request_metadata: sanitizeProviderAttemptMetadata({
      ...attempt.request_metadata,
      provider_attempt_id: publicId,
    }),
    response_metadata: sanitizeProviderAttemptMetadata(attempt.response_metadata),
    error_code: attempt.error?.code ?? null,
    error_message: attempt.error?.message ?? null,
    started_at: attempt.started_at,
  };
}

export class DatabaseProviderAttemptRepository implements ProviderAttemptRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly createPublicId: ProviderAttemptPublicIdFactory = createProviderAttemptPublicId,
  ) {}

  async persist(attempt: ProviderAttempt): Promise<StoredProviderAttempt> {
    return this.db.transaction().execute(async (transaction) => {
      const provider = await transaction
        .selectFrom("integration_providers")
        .select(["id", "key"])
        .where("key", "=", attempt.provider)
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!provider) {
        throw new Error(`Unknown provider for attempt persistence: ${attempt.provider}`);
      }

      const account = attempt.account_public_id
        ? await transaction
            .selectFrom("integration_accounts")
            .select(["id", "public_id"])
            .where("provider_id", "=", provider.id)
            .where("public_id", "=", attempt.account_public_id)
            .where("status", "=", "active")
            .executeTakeFirst()
        : null;

      if (attempt.account_public_id && !account) {
        throw new Error(
          `Unknown provider account for attempt persistence: ${attempt.provider}/${attempt.account_public_id}`,
        );
      }

      return transaction
        .insertInto("provider_attempts")
        .values(
          mapProviderAttemptToInsert(
            attempt,
            {
              providerId: provider.id,
              accountId: account?.id ?? null,
            },
            this.createPublicId(),
          ),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }
}
