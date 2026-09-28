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
- current contract gate placeholders
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
docker compose --profile tools run --rm migrator migrate --apply
docker compose --profile tools run --rm migrator verify
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
