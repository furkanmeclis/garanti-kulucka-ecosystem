# Migrator Design

## Runtime

The migrator is a separate container and CLI. It is never part of the API feature surface.

Commands:

```bash
garanti-migrator migrate --dry-run
garanti-migrator migrate --apply
garanti-migrator verify
```

## Responsibilities

- Read legacy Supabase/PostgreSQL data.
- Transform legacy naming and shape into canonical English schema.
- Write to target PostgreSQL.
- Maintain `legacy_id_map`.
- Produce reports.
- Verify referential integrity and important business totals.

## Idempotency

Every migrated entity must have a stable legacy source key.

`legacy_id_map` records:

```text
source_system
source_table
source_id
target_table
target_id
checksum
migrated_at
```

Re-running the migrator must not duplicate data.

## Reports

The migrator writes:

- `migration-summary.json`
- `migration-errors.json`
- `unmapped-fields.json`
- `row-counts.json`
- `verification-report.json`

## Foundation Modules

The migrator is split into testable ports before any live legacy connection is added:

- `LegacySource`: read-only source interface for counts and paged batches.
- `MigrationTarget`: target interface for canonical writes and `legacy_id_map` lookups/upserts.
- `createMigrationPlan`: builds deterministic batch plans for dry-run and apply modes.
- `upsertLegacyIdMap`: enforces idempotency around `(source_system, source_table, source_id)`.
- `createDryRunReport` and `createVerificationReport`: report models used by manual CLI commands.

Synthetic fixtures cover the foundation. Live Supabase access is intentionally not part of this slice.

## Verification

Checks include:

- Row counts by mapped table
- Orphan messages
- Orphan orders
- Orphan shipments
- Duplicate customers
- Message chronological ordering
- Order item totals versus order totals
- Shipment tracking references
- Integration account persistence

## Guardrails

- Source database is read-only.
- Dry-run is default for unsafe environments.
- Apply mode requires explicit flag.
- Unknown fields are reported, not silently discarded.
