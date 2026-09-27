# ADR 0003: Contract-First Migration

## Status

Accepted

## Decision

Freeze legacy behavior as contracts before replacing internals.

Contracts include:

- HTTP API paths and response shapes
- Webhook verification and payload handling
- Provider outbound request payloads
- Provider response normalization
- Socket event payloads
- Migrator mapping reports

## Rationale

The project has working integrations but incomplete external credentials in the new environment. Contract fixtures allow migration without live provider access.

## Consequences

- CI never depends on live providers.
- Fixture changes must be intentional.
- "Cleaner" provider payloads are rejected unless explicitly approved by contract update.
