# ADR 0001: Stack And Runtime Split

## Status

Accepted

## Decision

Use:

- Hono + TypeScript for API
- PostgreSQL as canonical database
- Redis + BullMQ for queues and transient coordination
- Garage for S3-compatible object storage
- Socket.IO for application realtime
- Separate API, worker, migrator, and web containers

## Rationale

The legacy system mixes frontend direct database access, Express integration endpoints, webhook processing, runtime memory config, and background work. The rebuild needs strong boundaries while preserving external behavior.

Node/TypeScript keeps migration close to existing integration code and allows contract preservation with lower risk than a language rewrite.

## Consequences

- Business logic must live outside Hono route handlers.
- Worker and API share application use cases, not delivery code.
- Migrator is a first-class container.
- Redis becomes required infrastructure.
- Admin-managed provider config must be durable in PostgreSQL.
