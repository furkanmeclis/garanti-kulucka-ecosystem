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
- TypeScript checks
- unit tests
- current contract gate placeholders
- workspace builds
- Docker builds for API, worker, and migrator

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

## Services

```bash
docker compose up api worker
```

API health:

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

## Notes

- The migrator is intentionally manual.
- Provider credentials are not required for local CI gates.
- Admin-managed provider configuration will be persisted in PostgreSQL, not `.env`.
