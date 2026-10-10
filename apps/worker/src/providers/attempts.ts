import { randomUUID } from "node:crypto";
import type { AppDatabase, ProviderAttemptsTable } from "@garanti-kulucka/database";
import { redactValue, type ProviderAttempt } from "@garanti-kulucka/shared";
import type { Insertable, Selectable } from "kysely";

export type StoredProviderAttempt = Selectable<ProviderAttemptsTable>;
export type NewProviderAttempt = Insertable<ProviderAttemptsTable>;

export interface ProviderAttemptRepository {
  persist: (attempt: ProviderAttempt) => Promise<StoredProviderAttempt>;
  /**
   * The successful live attempt already recorded for this idempotency key, if any. Provider-delivery uses it as a
   * replay guard so a retried or re-queued job never repeats a carrier call that went through.
   */
  findLiveSuccess?: (provider: ProviderAttempt["provider"], idempotencyKey: string) => Promise<StoredProviderAttempt | null>;
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "23505");
}

function isLiveResponse(metadata: unknown) {
  return Boolean(metadata && typeof metadata === "object" && (metadata as { live_call_performed?: unknown }).live_call_performed === true);
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

      const row = mapProviderAttemptToInsert(
        attempt,
        {
          providerId: provider.id,
          accountId: account?.id ?? null,
        },
        this.createPublicId(),
      );

      // A key succeeds at most once (provider_attempts_idempotency_success_idx). A live success replaces an
      // earlier dry-run success of the same key; a second live success (two workers raced) keeps the first row.
      if (attempt.status === "success" && attempt.idempotency_key) {
        const existing = await transaction
          .selectFrom("provider_attempts")
          .selectAll()
          .where("provider_id", "=", provider.id)
          .where("idempotency_key", "=", attempt.idempotency_key)
          .where("status", "=", "success")
          .forUpdate()
          .executeTakeFirst();
        if (existing) {
          if (isLiveResponse(existing.response_metadata) || !isLiveResponse(attempt.response_metadata)) return existing;
          await transaction.deleteFrom("provider_attempts").where("id", "=", existing.id).execute();
        }
      }

      return transaction.insertInto("provider_attempts").values(row).returningAll().executeTakeFirstOrThrow();
    }).catch(async (error: unknown) => {
      // Lost an insert race for the same successful key: the other worker's row stands.
      if (!isUniqueViolation(error) || attempt.status !== "success" || !attempt.idempotency_key) throw error;
      const winner = await this.findSuccess(attempt.provider, attempt.idempotency_key);
      if (!winner) throw error;
      return winner;
    });
  }

  private async findSuccess(provider: string, idempotencyKey: string) {
    const row = await this.db
      .selectFrom("provider_attempts")
      .innerJoin("integration_providers", "integration_providers.id", "provider_attempts.provider_id")
      .selectAll("provider_attempts")
      .where("integration_providers.key", "=", provider)
      .where("provider_attempts.idempotency_key", "=", idempotencyKey)
      .where("provider_attempts.status", "=", "success")
      .executeTakeFirst();
    return row ?? null;
  }

  async findLiveSuccess(provider: ProviderAttempt["provider"], idempotencyKey: string): Promise<StoredProviderAttempt | null> {
    const row = await this.findSuccess(provider, idempotencyKey);
    return row && isLiveResponse(row.response_metadata) ? row : null;
  }
}
