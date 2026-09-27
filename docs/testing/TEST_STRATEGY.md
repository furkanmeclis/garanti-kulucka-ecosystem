# Test Strategy

Tests are designed as full-system confidence checks, not only unit tests.

## Layers

### Static Checks

- TypeScript type checks
- Lint
- Dependency boundary checks
- Forbidden import checks
- Schema naming checks

### Unit Tests

- Domain entities
- Use cases
- Validation helpers
- Provider payload builders
- Token/session helpers

### Integration Tests

- API + PostgreSQL
- Worker + Redis/BullMQ
- Garage S3 adapter against local container
- Auth session lifecycle
- Settings persistence and cache invalidation

### Contract Tests

- Provider fixtures
- Webhook fixtures
- Frontend API schema compatibility
- Socket.IO event payloads

### E2E Tests

Playwright scenarios should run against local compose services:

- Login, refresh, logout
- Message inbox and reply
- Conversation assignment and presence
- Order creation and status transitions
- Shipment creation and tracking update simulation
- Admin integration settings edit and restart persistence
- Webphone config retrieval and call-log persistence
- Migrator dry-run and verify flow

## CI Rule

`npm run check` is the minimum gate and now runs:

```text
npm run verify:structure
npm run lint
npm run typecheck
npm run test:unit
npm run test:contracts
npm run test:integration
npm run test:migrator
npm run test:worker
npm run test:ws
npm run test:e2e
npm run build
npm run docker:build
```

Only a passing `main` commit can receive an automatic tag.

## No Live Provider Credentials

CI must never require live PTT, Surat, KolayBi, Meta, NetGSM, Vapi, or SIP credentials.

Provider behavior is tested through:

- Frozen fixtures
- Mock HTTP servers
- Nock/MSW-style request assertions
- Local webhook payload replay

## Required Regression Greps

- No final frontend `supabase.from`
- No final frontend `supabase.auth`
- No final frontend Supabase channel subscriptions
- No provider tokens logged
- No Turkish identifiers in new schema migrations
- No migrator call from API startup
