# Local Development

## Required Tools

- Node.js 22+
- npm
- Docker Desktop or compatible Docker engine

## Main Commands

```bash
npm ci
npm run check
```

`npm run check` runs:

- repository structure guard
- compose configuration validation
- TypeScript checks
- unit tests
- contract tests for legacy endpoint classification, provider catalog parity, provider fixtures, and fixture replay
- integration, migrator, worker, websocket, and Playwright e2e tests
- workspace builds
- Docker builds for API, worker, migrator, and web

## Infrastructure

```bash
docker compose up postgres redis garage
```

## Database

From the host:

```bash
DATABASE_URL=postgres://garanti:garanti@localhost:5432/garanti npm run db:migrate:up
```

Through the migrator container:

```bash
docker compose --profile tools run --rm migrator migrate --dry-run
docker compose --profile tools run --rm migrator verify
```

Compose, dry-run icin `SOURCE_DATABASE_URL` degerini migrator servisine aktarir. Mevcut dry-run, source veritabanini `REPEATABLE READ READ ONLY` transaction ile acar, canonical tablo adlariyla row count preflight yapar ve batch planini kurar. Target URL cozmez, target baglantisi acmaz ve veri yazmaz.

`verify`, canonical hedefi kontrol eder ve `TARGET_DATABASE_URL` ister. `DATABASE_URL` yalniz target dogrulamasi icin uyumluluk fallback'i olarak desteklenir.

Apply komutu varsayilan olarak kapali kalir ve yalniz explicit iki kapili operasyon akisiyle calisir:

```bash
MIGRATION_APPLY_ENABLED=true \
MIGRATION_BACKUP_EVIDENCE=/secure/migration/backup-evidence.json \
docker compose --profile tools run --rm migrator migrate --apply --report-file /secure/migration/apply-report.json
```

`MIGRATION_APPLY_ENABLED=true` yoksa veya `MIGRATION_BACKUP_EVIDENCE` okunabilir ve guncel bir backup manifest dosyasina isaret etmiyorsa komut veritabanina baglanmadan fail-closed cikar. Ayrintili operasyon adimlari icin `docs/operations/MIGRATION_APPLY_RUNBOOK.md` dosyasini kullanin.

## Real-Postgres Tests (optional)

Repository/SQL tests named `*.pg.test.ts` and `tests/integration/inbound-webhook-pipeline.test.ts` run only when
`TEST_DATABASE_URL` points at a migrated database; otherwise they are skipped. They roll back or clean up their rows.

```bash
TEST_DATABASE_URL=postgres://garanti:garanti@localhost:5432/garanti npm run test:unit
TEST_DATABASE_URL=postgres://garanti:garanti@localhost:5432/garanti npx vitest run tests/integration
```

## First Admin

Run this after database migrations. The command is manual by design and is not exposed as an API feature.

```bash
DATABASE_URL=postgres://garanti:garanti@localhost:5432/garanti \
FIRST_ADMIN_EMAIL=admin@example.com \
FIRST_ADMIN_PASSWORD='change-this-long-password' \
npm run bootstrap:admin -w @garanti-kulucka/api
```

With compose:

```bash
docker compose run --rm \
  -e FIRST_ADMIN_EMAIL=admin@example.com \
  -e FIRST_ADMIN_PASSWORD='change-this-long-password' \
  api node apps/api/dist/bootstrap-admin.js
```

## Services

```bash
docker compose up api worker web
```

API health:

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

Web health:

```bash
curl http://localhost:8080/healthz
```

## Notes

- The migrator is intentionally manual.
- Provider credentials are not required for local CI gates.
- Admin-managed provider configuration will be persisted in PostgreSQL, not `.env`.
