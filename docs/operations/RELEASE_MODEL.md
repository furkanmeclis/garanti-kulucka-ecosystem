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
- Create annotated tag on the exact passing commit

If checks fail:

- No tag
- No release candidate

## Future Container Publishing

After real Dockerfiles exist, the workflow will publish images tagged with:

```text
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/api:vX.Y.Z
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/worker:vX.Y.Z
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/migrator:vX.Y.Z
ghcr.io/furkanmeclis/garanti-kulucka-ecosystem/web:vX.Y.Z
```

Deployments should use tags, not `latest`.
