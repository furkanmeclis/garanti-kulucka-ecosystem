# Master Roadmap

This roadmap is the execution source of truth for the Garanti Kulucka ecosystem rebuild.

## Non-Negotiables

- Keep the customer-facing frontend experience stable.
- Remove direct Supabase usage from the frontend.
- Preserve external provider payloads, webhook responses, callback paths, and operational behavior.
- Use English `snake_case` for every new database identifier.
- Store admin-managed integration settings in PostgreSQL, not process memory.
- Keep database connection strings and core secrets outside the admin UI.
- Split runtime responsibilities into API, worker, migrator, web, PostgreSQL, Redis, and object storage containers.
- Treat tests as full-system checks: contract-first, e2e-style, repeatable without live provider credentials.

## Target Runtime

```text
apps/web       Browser UI, preserving existing workflows
apps/api       Hono + TypeScript HTTP API
apps/worker    BullMQ workers, webhooks, retries, scheduled jobs
apps/migrator  Manual one-shot data migration and verification container
postgres       Canonical operational database
redis          Queue backend, cache, rate limit, websocket fanout
garage         S3-compatible object storage
socket.io      Realtime application channel
jssip          Browser SIP/WebRTC webphone client boundary
```

## Phase 0 - Discovery And Contract Freeze

Goal: create the frozen compatibility surface before replacing internals.

Tasks:

- Extract every legacy `/api/*`, `/auth/*`, webhook, and cron endpoint.
- Extract frontend direct Supabase calls by page and service.
- Extract provider request/response examples for PTT, Surat, KolayBi, Meta, WhatsApp, Messenger, Instagram, NetGSM, Vapi, and SIP config.
- Create provider fixture files under `contracts/providers/*`.
- Create OpenAPI drafts for backend-facing frontend APIs.
- Create websocket event catalog.
- Create database naming map from legacy Turkish/mixed names to canonical English names.

Verification:

- `tests/contract` can replay fixture expectations without provider credentials.
- Grep report proves no unclassified legacy integration endpoint remains.
- Migration map covers every legacy table currently used by frontend or backend.

Anti-pattern guards:

- Do not infer contracts from memory.
- Do not call live providers in CI.
- Do not preserve legacy table names in the canonical schema.

## Phase 1 - Foundation

Goal: create the deployable skeleton with real boundaries.

Tasks:

- Scaffold TypeScript config shared across workspaces.
- Implement Hono API bootstrap with request IDs, structured logging, health checks, and centralized error handling.
- Implement worker bootstrap with BullMQ, structured job logging, graceful shutdown, and retry policy.
- Implement migrator CLI with `migrate --dry-run`, `migrate --apply`, and `verify`.
- Add Dockerfiles for `api`, `worker`, `migrator`, and `web`.
- Add local `compose.yaml` for PostgreSQL, Redis, Garage, API, worker, migrator, and web.

Verification:

- `npm run check` passes locally and in GitHub Actions.
- Containers boot locally with health checks.
- API, worker, and migrator Docker images build successfully.
- API `/health/live` and `/health/ready` pass.
- Worker starts without processing jobs when no queues exist.
- Migrator dry-run exits successfully against empty/stub databases.

Anti-pattern guards:

- Do not place migration execution inside the API server.
- Do not make worker import Hono route handlers.
- Do not log secrets.

## Phase 2 - Canonical PostgreSQL Schema

Goal: replace Supabase tables with a clean PostgreSQL model.

Tasks:

- Build schema modules for users, roles, sessions, customers, conversations, messages, orders, shipments, balance, products, integrations, files, audit logs, worker jobs, and settings.
- Use English `snake_case`; reject Turkish or mixed-case identifiers.
- Add FK indexes explicitly.
- Use `timestamptz`, `numeric` for money, `text` for strings, and `jsonb` only for optional provider payloads.
- Add audit tables for admin-managed integration changes.
- Add durable integration account/token/settings tables.

Verification:

- Schema lint rejects quoted identifiers, Turkish table names, `timestamp without time zone`, `varchar`, `serial`, and missing FK indexes.
- Migration tests create a fresh database from zero.
- Seed data creates the first admin without Supabase.

Anti-pattern guards:

- Do not encode business status as unstable Postgres enums.
- Do not use JSONB for core relations.
- Do not let provider config live only in `.env` or memory.

## Phase 3 - Auth And Admin Configuration

Goal: make backend-owned auth and persistent admin-managed settings production-safe.

Tasks:

- Implement email/password auth with Argon2id.
- Implement refresh-token rotation using httpOnly secure cookies.
- Implement access tokens for API and websocket authorization.
- Implement role and permission checks in API and worker paths.
- Implement admin settings APIs for integrations, AI prompts, webhook configuration, SIP/webphone config, feature flags, rate limits, and provider credentials.
- Store encrypted provider secrets in PostgreSQL using application-managed encryption keys from environment.

Verification:

- E2E auth test covers login, refresh, logout, revoked token, disabled user, and role-denied cases.
- Restart test proves Instagram/Messenger/WhatsApp accounts survive API and worker restarts.
- Audit log test proves admin setting changes are recorded.

Anti-pattern guards:

- Do not expose provider secrets to the frontend.
- Do not keep connected accounts in module-level variables as source of truth.
- Do not let websocket connections bypass auth.

## Phase 4 - Frontend Data Access Migration

Goal: remove direct Supabase calls while preserving UI.

Tasks:

- Introduce typed API clients in `apps/web`.
- Replace direct Supabase auth calls with backend auth endpoints.
- Replace direct Supabase table queries with backend endpoints by domain.
- Replace Supabase realtime subscriptions with Socket.IO subscriptions.
- Keep page components visually and behaviorally stable.

Verification:

- Grep check finds no frontend `supabase.from`, `supabase.auth`, or Supabase channel usage outside temporary migration shims.
- Playwright e2e tests cover message inbox, order flow, shipment flow, admin settings, and webphone config.
- API contract tests ensure frontend receives the same response shapes it expects.

Anti-pattern guards:

- Do not redesign UI while replacing data access.
- Do not call PostgreSQL from frontend.
- Do not create feature-specific fetch logic inside page components.

## Phase 5 - Provider Integrations

Goal: port working legacy integrations behind adapter interfaces.

Tasks:

- Implement provider ports in domain/application code.
- Implement adapters for PTT, Surat, KolayBi, Meta Instagram/Messenger/WhatsApp, NetGSM, Vapi, and SIP config providers.
- Preserve request payloads and response normalization from legacy working code.
- Store every outbound attempt with request metadata, response metadata, duration, status, and retry decision.
- Route slow/retryable work to worker queues.

Verification:

- Provider contract tests compare generated payloads to frozen fixtures.
- Worker retry tests cover timeout, 429, 5xx, malformed response, and provider success after retry.
- No CI test requires live credentials.

Anti-pattern guards:

- Do not "improve" provider payloads during migration.
- Do not mix provider adapters with HTTP controllers.
- Do not retry non-idempotent calls without idempotency keys.

## Phase 6 - Realtime And Webphone

Goal: replace Supabase realtime and preserve webphone behavior.

Tasks:

- Implement Socket.IO gateway with authenticated namespaces.
- Define event catalog for conversations, messages, orders, shipments, personnel presence, and settings reload.
- Use Redis for multi-instance websocket fanout.
- Keep SIP/WebRTC separate from application realtime.
- Keep JsSIP/SIP.js boundary in frontend; API only serves config and records call events.

Verification:

- Websocket tests cover auth reject, reconnect, room membership, event fanout, and stale session disconnect.
- Webphone tests cover config retrieval, permission gating, and call-log persistence without real SIP calls.

Anti-pattern guards:

- Do not tunnel SIP media through the API.
- Do not use Socket.IO as a job queue.
- Do not store realtime state only in memory.

## Phase 7 - Migrator

Goal: migrate legacy data safely and repeatably.

Tasks:

- Implement source readers for legacy Supabase/Postgres.
- Implement canonical writers for new PostgreSQL.
- Implement mapping tables for legacy IDs to canonical IDs.
- Implement resumable batches and idempotent upserts.
- Implement post-migration verification reports.
- Support dry-run, apply, and verify modes.

Verification:

- Migration tests run against synthetic legacy fixtures.
- Verification checks row counts, referential integrity, orphan records, duplicate customers, message ordering, order totals, and shipment references.
- Migrator can be re-run without duplicating data.

Anti-pattern guards:

- Do not run migrator automatically on API startup.
- Do not mutate source data.
- Do not silently drop unmapped fields; report them.

## Phase 8 - Deployment And Release

Goal: make one-branch, no-PR delivery safe.

Tasks:

- Keep GitHub Actions on `main` only.
- Build and test every committed change.
- Auto-tag every passing commit with incrementing `vMAJOR.MINOR.PATCH`.
- Publish build artifacts and container images after successful checks.
- Add rollback docs for previous tag deploy.

Verification:

- A green commit creates exactly one tag.
- A failing commit creates no tag.
- Release notes can be generated from tag diff.

Anti-pattern guards:

- Do not create branch-based workflow rules.
- Do not tag before tests pass.
- Do not deploy untagged images to production.
