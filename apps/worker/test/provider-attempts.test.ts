import { describe, expect, it } from "vitest";
import type { AppDatabase } from "@garanti-kulucka/database";
import type { ProviderAttempt } from "@garanti-kulucka/shared";
import {
  DatabaseProviderAttemptRepository,
  mapProviderAttemptToInsert,
  sanitizeProviderAttemptMetadata,
  type NewProviderAttempt,
} from "../src/providers/attempts.js";

const attempt: ProviderAttempt = {
  provider: "meta",
  operation: "message.webhook",
  direction: "inbound",
  request_id: "req_meta_1",
  account_public_id: "iac_meta_1",
  started_at: "2026-01-01T00:00:00.000Z",
  duration_ms: 25,
  status: "success",
  status_code: 202,
  retry_decision: "none",
  next_retry_at: null,
  idempotency_key: "idem_1",
  request_metadata: {
    channel: "instagram",
    authorization: "Bearer live-token",
    nested: {
      access_token: "secret-access-token",
    },
  },
  response_metadata: {
    accepted: true,
    refresh_token: "secret-refresh-token",
  },
  error: null,
};

class FakeSelectBuilder {
  private readonly clauses: Array<{ column: string; value: unknown }> = [];

  constructor(
    private readonly table: "integration_providers" | "integration_accounts" | "provider_attempts",
    private readonly state: FakeDatabaseState,
  ) {}

  select(_columns: readonly string[]): this {
    return this;
  }

  selectAll(): this {
    return this;
  }

  forUpdate(): this {
    return this;
  }

  where(column: string, _operator: string, value: unknown): this {
    this.clauses.push({ column, value });
    return this;
  }

  async executeTakeFirst() {
    // No earlier successful attempt for the idempotency key in these fixtures.
    if (this.table === "provider_attempts") return undefined;
    if (this.table === "integration_providers") {
      const providerKey = this.clauses.find((clause) => clause.column === "key")?.value;
      return providerKey === this.state.provider.key && this.state.provider.is_active
        ? { id: this.state.provider.id, key: this.state.provider.key }
        : undefined;
    }

    const providerId = this.clauses.find((clause) => clause.column === "provider_id")?.value;
    const publicId = this.clauses.find((clause) => clause.column === "public_id")?.value;
    return providerId === this.state.account.provider_id &&
      publicId === this.state.account.public_id &&
      this.state.account.status === "active"
      ? { id: this.state.account.id, public_id: this.state.account.public_id }
      : undefined;
  }
}

class FakeInsertBuilder {
  private valuesInput: NewProviderAttempt | null = null;

  constructor(private readonly state: FakeDatabaseState) {}

  values(input: NewProviderAttempt): this {
    this.valuesInput = input;
    return this;
  }

  returningAll(): this {
    return this;
  }

  async executeTakeFirstOrThrow() {
    if (!this.valuesInput) {
      throw new Error("Missing insert values");
    }

    this.state.inserted = this.valuesInput;
    return {
      id: 1001,
      created_at: new Date("2026-01-01T00:00:01.000Z"),
      updated_at: new Date("2026-01-01T00:00:01.000Z"),
      ...this.valuesInput,
    };
  }
}

interface FakeDatabaseState {
  provider: {
    id: number;
    key: string;
    is_active: boolean;
  };
  account: {
    id: number;
    provider_id: number;
    public_id: string;
    status: string;
  };
  inserted: NewProviderAttempt | null;
}

function createFakeDatabase(state: FakeDatabaseState): AppDatabase {
  const transaction = {
    selectFrom: (table: "integration_providers" | "integration_accounts" | "provider_attempts") =>
      new FakeSelectBuilder(table, state),
    insertInto: (table: "provider_attempts") => {
      expect(table).toBe("provider_attempts");
      return new FakeInsertBuilder(state);
    },
  };

  return {
    transaction: () => ({
      execute: async <T>(callback: (transactionContext: typeof transaction) => Promise<T>) =>
        callback(transaction),
    }),
  } as unknown as AppDatabase;
}

describe("provider attempt persistence", () => {
  it("maps ProviderAttempt objects into canonical provider_attempts inserts", () => {
    const mapped = mapProviderAttemptToInsert(
      attempt,
      {
        providerId: 10,
        accountId: 20,
      },
      "pat_test_1",
    );

    expect(mapped).toMatchObject({
      public_id: "pat_test_1",
      provider_id: 10,
      account_id: 20,
      request_id: "req_meta_1",
      operation: "message.webhook",
      direction: "inbound",
      status: "success",
      status_code: 202,
      duration_ms: 25,
      retry_decision: "none",
      next_retry_at: null,
      idempotency_key: "idem_1",
      error_code: null,
      error_message: null,
      started_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("redacts secret-looking metadata before persistence", () => {
    expect(
      sanitizeProviderAttemptMetadata({
        Authorization: "Bearer live-token",
        nested: {
          api_key: "secret-api-key",
          safe: "visible",
        },
      }),
    ).toEqual({
      Authorization: "[redacted]",
      nested: {
        api_key: "[redacted]",
        safe: "visible",
      },
    });
  });

  it("persists attempts by resolving provider key and account public id", async () => {
    const state: FakeDatabaseState = {
      provider: {
        id: 10,
        key: "meta",
        is_active: true,
      },
      account: {
        id: 20,
        provider_id: 10,
        public_id: "iac_meta_1",
        status: "active",
      },
      inserted: null,
    };
    const repository = new DatabaseProviderAttemptRepository(
      createFakeDatabase(state),
      () => "pat_fake_1",
    );

    const stored = await repository.persist(attempt);

    expect(stored.public_id).toBe("pat_fake_1");
    expect(state.inserted).toMatchObject({
      public_id: "pat_fake_1",
      provider_id: 10,
      account_id: 20,
      request_id: "req_meta_1",
      request_metadata: {
        authorization: "[redacted]",
        nested: {
          access_token: "[redacted]",
        },
      },
      response_metadata: {
        accepted: true,
        refresh_token: "[redacted]",
      },
    });
  });

  it("fails when an explicit account public id cannot be resolved", async () => {
    const state: FakeDatabaseState = {
      provider: {
        id: 10,
        key: "meta",
        is_active: true,
      },
      account: {
        id: 20,
        provider_id: 10,
        public_id: "iac_other",
        status: "active",
      },
      inserted: null,
    };
    const repository = new DatabaseProviderAttemptRepository(createFakeDatabase(state));

    await expect(repository.persist(attempt)).rejects.toThrow(
      "Unknown provider account for attempt persistence",
    );
    expect(state.inserted).toBeNull();
  });
});
