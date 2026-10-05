# Release Model

## Branching

- Single branch: `main`
- No PR workflow
- No feature branches in CI policy

## Commit Rule

Every approved commit lands on `main`.

## Tag Rule

GitHub Actions runs on every `main` push.

If checks pass:

- Find latest `vMAJOR.MINOR.PATCH`
- Increment patch
- Package API, worker, migrator, and web container images as downloadable workflow artifacts
- Create annotated tag on the exact passing commit
- API, worker, migrator, and web Dockerfiles must build before tagging.

If checks fail:

- No tag
- No release candidate

## Container Artifacts

The workflow packages Docker image artifacts before tagging:

```text
container-images-vX.Y.Z/
  garanti-kulucka-api-vX.Y.Z.tar.gz
  garanti-kulucka-worker-vX.Y.Z.tar.gz
  garanti-kulucka-migrator-vX.Y.Z.tar.gz
  garanti-kulucka-web-vX.Y.Z.tar.gz
```

The packaged images are tagged internally as:

```text
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/api:vX.Y.Z
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/worker:vX.Y.Z
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/migrator:vX.Y.Z
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/web:vX.Y.Z
```

Deployments should use tags, not `latest`.

## Release Notes

Release notes are generated from semantic tag diffs:

```bash
npm run release-notes -- vX.Y.Z
```

The default command uses the latest local `vMAJOR.MINOR.PATCH` tag and the previous semantic tag:

```bash
npm run release-notes
```

Use an explicit previous tag when validating a non-standard rollback or hotfix range:

```bash
npm run release-notes -- --tag vX.Y.Z --previous vA.B.C --output docs/releases/vX.Y.Z.md
```

## Rollback

Rollback is tag-based. Rollout order, graceful drain, the pre-migration backup gate and the
forward-fix policy are defined in `DEPLOYMENT_RUNBOOK.md`.

1. Pick the last known-good `vX.Y.Z` tag from GitHub Actions.
2. Download that run's `container-images-vX.Y.Z` artifact.
3. Load images on the target host:

```bash
docker load < garanti-kulucka-api-vX.Y.Z.tar.gz
docker load < garanti-kulucka-worker-vX.Y.Z.tar.gz
docker load < garanti-kulucka-migrator-vX.Y.Z.tar.gz
docker load < garanti-kulucka-web-vX.Y.Z.tar.gz
```

4. Update the deployment image tags to the selected `vX.Y.Z`.
5. Run the migrator manually only when the selected rollback procedure explicitly requires schema verification.
6. Restart API, worker, and web containers.
7. Run `garanti-migrator verify` against the target database and check API `/health/ready`.

Never rollback to an untagged image.
