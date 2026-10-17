# Migrator Design

## Runtime Boundary

The migrator is a manual CLI in a separate container. It is not part of the API feature surface and it does not run automatically during application startup.

Commands:

```bash
garanti-migrator migrate --dry-run
garanti-migrator migrate --apply
garanti-migrator verify
```

## Current Behavior

### Dry-run

`migrate --dry-run` requires `SOURCE_DATABASE_URL` and opens the source in a `REPEATABLE READ READ ONLY` transaction. It reads every planned legacy row through the mapping catalog and runs the customer (with address and external identity fan-out), conversation, message, product, order, order item, shipment and shipment tracking event transforms, including enum, FK and schema-gap checks. It never resolves a target URL or writes anything. The report lists blocked rows, warnings and per-entity resolution counts.

The first dry-run against a full copy of the production legacy database passed on 2026-10-11; see `docs/migration/LEGACY_DRYRUN_2026-10-11.md`.

### Apply

`migrate --apply` writes canonical rows, `legacy_id_map` entries and batch state in one transaction per batch, under a PostgreSQL advisory lock, with row-content fingerprints for idempotent resume. It is gated: `MIGRATION_APPLY_ENABLED=true`, a backup evidence file for the target (`MIGRATION_BACKUP_EVIDENCE`), distinct source and target identities and a run-ID-bound approval (`apply-approval.ts`) are all required. Real PostgreSQL E2E tests cover full apply, idempotent rerun and interrupted resume. Apply has not been run against real data yet. The operator procedure is `docs/operations/MIGRATION_APPLY_RUNBOOK.md`.

### Verify

`verify` requires `TARGET_DATABASE_URL`; `DATABASE_URL` is accepted only as a compatibility fallback. It checks that the canonical target exposes the required migration and application tables and returns a structured pass or fail result.

### Command Reports

`--report-file <path>` writes one JSON command report containing the command, status, timestamps, duration, and a sanitized error message when the command fails. Verification failures also include the current verification result. Database URLs and credential values are excluded.

## Implemented Foundations

- `LegacySource` provides read-only count and batch-read ports.
- `MigrationTarget` provides canonical write, migration batch state, and `legacy_id_map` ports.
- `createMigrationPlan` creates deterministic entity and batch plans.
- `applyMigrationBatch` and its per-entity state wrappers implement resumable, idempotent batch writes behind the apply gate.
- `upsertLegacyIdMap` keys migrated records by source system, source table, source ID, target table, and mapping role.
- Source transactions enforce repeatable-read and read-only semantics.
- Error and report serialization remove database URLs and credential parameters.

## Canonical Identity Targets

`customer_external_identities` stores durable customer identifiers under a persisted `integration_account_id`. `(integration_account_id, external_id)` identifies one external customer inside one account, while `(customer_id, integration_account_id)` permits one identity for each canonical customer in that account. Provider ownership is derived through `integration_accounts.provider_id`; no duplicate provider text is stored on the identity. Account deletion cascades to its external identities, and provider-specific attributes remain in object-shaped `metadata`.

`conversations.integration_account_id` links a conversation to the exact persisted integration account that owns its provider thread. The nullable foreign key uses `ON DELETE SET NULL`, so deleting an account does not delete conversation history. This is the canonical resolution target for legacy Instagram account identifiers.

Target verification requires the identity table and snapshots both identity ownership and conversation account links. These schema additions alone do not enable apply; the apply gate and operator approval remain mandatory.

`legacy_id_map.mapping_role` defaults to `primary` and participates in the source-to-target uniqueness key. A single legacy row can therefore retain separate mappings for its canonical customer, synthesized address, and account-scoped external identities without overwriting earlier mappings.

## Migration Roadmap

These were the prerequisites for the apply gate. All of them are implemented and covered by tests; the remaining work before a production apply (synthetic order customers, user creation, media, performance, scope of unmigrated tables) is tracked under Faz B in `docs/roadmap/TAMAMLAMA_YOL_HARITASI.md`.

- A versioned mapping catalog for each real legacy database shape.
- Explicit table, field, enum, and foreign-key transformations into the canonical English schema.
- Dependency-ordered target writes with legacy ID remapping.
- Reconciliation for row counts, unmapped fields, rejected rows, and business totals.
- Operator report artifacts such as migration summaries, row counts, unmapped fields, errors, and final verification results.
- Recovery drills proving that interrupted runs resume without duplicate target records.
- A project-wide PostgreSQL `BIGINT` runtime type policy and corresponding Kysely type migration.
- A source-backed migration manifest that proves source completeness independently of `legacy_id_map`.

## Guardrails

- Source access is read-only.
- Apply is disabled by default and requires explicit operator action when activated.
- Source and target database identities must differ before writes are enabled.
- Unknown fields must be reported rather than silently discarded.
- Every migrated entity must retain a stable legacy source key.
