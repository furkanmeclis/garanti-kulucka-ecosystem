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
- Package API, worker, and migrator container images as downloadable workflow artifacts
- Create annotated tag on the exact passing commit
- API, worker, and migrator Dockerfiles must build before tagging.

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
```

The packaged images are tagged internally as:

```text
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/api:vX.Y.Z
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/worker:vX.Y.Z
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/migrator:vX.Y.Z
```

Deployments should use tags, not `latest`.

## Rollback

Rollback is tag-based.

1. Pick the last known-good `vX.Y.Z` tag from GitHub Actions.
2. Download that run's `container-images-vX.Y.Z` artifact.
3. Load images on the target host:

```bash
docker load < garanti-kulucka-api-vX.Y.Z.tar.gz
docker load < garanti-kulucka-worker-vX.Y.Z.tar.gz
docker load < garanti-kulucka-migrator-vX.Y.Z.tar.gz
```

4. Update the deployment image tags to the selected `vX.Y.Z`.
5. Run the migrator manually only when the selected rollback procedure explicitly requires schema verification.
6. Restart API and worker containers.
7. Run `garanti-migrator verify` against the target database and check API `/health/ready`.

Never rollback to an untagged image.
