# Codex Handoff - 2026-10-05

## Branch

Target branch for this handoff: `codex/p5-p6-handoff-20261005`.

## Completed In This Session

### Phase 1 - P5 Frontend Migration Closure

- Replaced remaining operational frontend list-count totals with backend-owned summaries:
  - provider attempt count from provider debug summary
  - settings audit count from settings audit summary
  - integration audit count from integration audit summary
  - orphan file count from files orphan summary
- Added backend count support for audit logs and orphan file candidates.
- Updated OpenAPI, Playwright API/domain flow, and browser E2E fixture expectations.
- Added Docker build fallback tooling for this cloud environment:
  - `npm run docker:build` now uses `tools/docker-build-local.sh`
  - normal Docker builds remain supported
  - when Docker cannot reach npm registry but `/workspace/.npm-cache` exists, it uses an offline cache build context
- Phase 1 gate passed, including Docker image builds for API, worker, migrator, and web.

### Phase 2 - Started, Not Complete

- Added controlled Garage orphan object deletion surface:
  - `POST /api/files/{file_public_id}/orphan-cleanup-dry-run` remains no-delete dry-run
  - `POST /api/files/{file_public_id}/orphan-cleanup` is added for controlled apply
  - apply requires `confirmation: "delete_orphan_object"`
  - apply is blocked by default unless `STORAGE_ORPHAN_DELETE_ENABLED=true`
  - apply rechecks orphan eligibility and rejects bucket mismatch against `S3_BUCKET_MEDIA`
- Added `MediaStorageService.deleteObject()` using Garage/S3 `DeleteObjectCommand`.
- Added web API client boundary for controlled cleanup apply, without adding an auto-delete UI button.
- Added object storage operations runbook:
  - `docs/operations/OBJECT_STORAGE_RUNBOOK.md`
- Strengthened readiness health:
  - `/health/ready` now reports dependency detail and returns `503` with `status: "degraded"` when DB is unavailable.
  - OpenAPI and shared health contract were updated.

## Verification Passed

- `npm run build -w @garanti-kulucka/shared`
- `npm run typecheck -w @garanti-kulucka/api`
- `npm run test:unit -w @garanti-kulucka/api -- health file-storage`
- `npm run test:unit -w @garanti-kulucka/web -- file-client api-client-boundary`
- `npm run test:contracts`
- `npx playwright test tests/playwright/api-domain-flows.spec.ts --reporter=list`
- Earlier in the same session, Phase 1 also passed:
  - root lint/typecheck/unit/contract/integration/migrator/worker/ws/e2e/build gates
  - `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright npm run test:e2e`
  - `npm run docker:build`

## Next Local Codex Starting Point

Continue Phase 2. Recommended order:

1. Finish observability/runbook production gates:
   - structured log correlation for orphan cleanup apply with request id, actor, file public id, bucket, object key, cleanup request id, and result code
   - alert/runbook docs for dependency health and storage cleanup failures
   - metrics surface or documented metric contract for orphan candidate count, cleanup apply count, cleanup error count, and Garage capacity/backup age
2. Decide whether file object deletion should remain metadata-preserving or add explicit DB lifecycle columns in a migration.
3. Add restore/reconciliation executable tests or a local Garage integration test if the environment supports object storage containers.
4. Re-run full `npm run check` after Phase 2 is fully closed.

## Known Environment Notes

- Docker inside this cloud environment intermittently cannot fetch npm registry tarballs and Node 22 npm can fail with `Exit handler never called`.
- The committed Docker helper keeps the standard build path, then falls back to offline host cache when `/workspace/.npm-cache` exists.
- Playwright Chromium was satisfied in this environment via local `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright`.
