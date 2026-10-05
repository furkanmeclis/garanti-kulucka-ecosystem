# ADR 0006: Storage Orphan Cleanup Lifecycle

## Status

Accepted

## Context

Garage orphan object cleanup can delete object bytes while the canonical `files` row remains useful for audit, reconciliation, and restore evidence. The cleanup surface already requires admin authorization, a dry-run review, `confirmation: "delete_orphan_object"`, the `STORAGE_ORPHAN_DELETE_ENABLED` production gate, orphan eligibility recheck, and configured bucket matching.

Adding lifecycle columns such as `deleted_at` or `object_deleted_at` would create a second source of truth before the product has a restore/reconciliation workflow that needs to query that state. It would also require a migration and backfill policy for historical file rows.

## Decision

Keep orphan object cleanup metadata-preserving. The API deletes only the Garage object and keeps the canonical `files` metadata row unchanged.

The operational lifecycle state is represented by:

- structured cleanup logs with `cleanup_request_id` and `result_code`;
- `storage_orphan_cleanup_apply_total` and `storage_orphan_cleanup_error_total` metrics;
- the preserved `files.bucket` and `files.object_key` metadata for backup restore and incident investigation.

No database migration is added for this phase.

## Consequences

- Operators can reconcile, audit, and restore deleted orphan objects using preserved metadata.
- Cleanup does not imply application-level file deletion; it is an object-storage lifecycle operation.
- Future restore/reconciliation automation may add explicit lifecycle columns when it has a concrete query path and retention policy.
