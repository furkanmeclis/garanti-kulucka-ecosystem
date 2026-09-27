# ADR 0002: Admin Managed Settings Persistence

## Status

Accepted

## Decision

All operational integration settings, connected accounts, prompts, and runtime flags are managed through admin APIs and stored in PostgreSQL.

Only infrastructure-level connection strings and cryptographic root secrets remain environment variables.

## Rationale

The system must survive restarts without losing connected Instagram, Messenger, WhatsApp, NetGSM, KolayBi, PTT, Surat, Vapi, or SIP settings.

Runtime memory can cache settings but cannot be the source of truth.

## Consequences

- Startup must load active settings from PostgreSQL.
- Admin changes require audit logs.
- Secrets require encryption at rest.
- Worker and API need settings cache invalidation.
