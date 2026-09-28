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

Apply komutu su anda operasyonel degildir:

```bash
docker compose --profile tools run --rm migrator migrate --apply
```

Komut, explicit `MIGRATION_RUN_ID` kontrolunden sonra target URL cozmeden ve veritabanlarina baglanmadan fail-closed olarak cikar. Gercek legacy tablo, alan ve foreign-key mapping katalogu ile target write akisi tamamlanip incelenene kadar apply acilmayacaktir. Migration summary, row count, unmapped field, rejected row ve final reconciliation raporlari roadmap kapsamindadir; mevcut dry-run bunlari uretmez.

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
