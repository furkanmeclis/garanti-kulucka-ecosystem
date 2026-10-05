#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DOCKER_CONFIG_DIR=$(mktemp -d)
TMP_DIR=$(mktemp -d)
if [ -n "${GARANTI_DOCKER_NPM_CACHE:-}" ]; then
  NPM_CACHE_DIR=$GARANTI_DOCKER_NPM_CACHE
elif [ -d /workspace/.npm-cache/_cacache ]; then
  NPM_CACHE_DIR=/workspace/.npm-cache
else
  NPM_CACHE_DIR=${NPM_CONFIG_CACHE:-${npm_config_cache:-/workspace/.npm-cache}}
fi
NODE_IMAGE=${GARANTI_DOCKER_NODE_IMAGE:-node:22.23.3-bookworm-slim}
OFFLINE_FIRST=${GARANTI_DOCKER_OFFLINE_CACHE:-}

cleanup() {
  rm -rf "$DOCKER_CONFIG_DIR" "$TMP_DIR"
}

trap cleanup EXIT

export DOCKER_CONFIG=$DOCKER_CONFIG_DIR

cache_is_available() {
  [ -d "$NPM_CACHE_DIR/_cacache" ]
}

registry_is_available_in_docker() {
  docker run --rm "$NODE_IMAGE" getent hosts registry.npmjs.org >/dev/null 2>&1
}

write_offline_dockerfile() {
  dockerfile=$1
  output=$2

  awk '
    /^RUN --mount=type=cache,target=\/root\/.npm/ {
      print "RUN --mount=type=bind,from=npm_cache,target=/root/.npm,ro npm ci --offline --no-audit --no-fund"
      skip=1
      next
    }
    skip == 1 && /^  / {
      next
    }
    {
      skip=0
      print
    }
  ' "$ROOT_DIR/$dockerfile" > "$output"
}

build_with_cache() {
  dockerfile=$1
  image=$2
  safe_name=$(printf "%s" "$dockerfile" | tr '/.' '__')
  offline_dockerfile="$TMP_DIR/$safe_name"

  write_offline_dockerfile "$dockerfile" "$offline_dockerfile"
  docker build \
    --build-context "npm_cache=$NPM_CACHE_DIR" \
    -f "$offline_dockerfile" \
    -t "$image" \
    "$ROOT_DIR"
}

build_image() {
  dockerfile=$1
  image=$2

  if [ "$OFFLINE_FIRST" = "1" ]; then
    build_with_cache "$dockerfile" "$image"
    return
  fi

  if docker build -f "$dockerfile" -t "$image" "$ROOT_DIR"; then
    return
  fi

  if cache_is_available; then
    build_with_cache "$dockerfile" "$image"
    return
  fi

  return 1
}

cd "$ROOT_DIR"

if [ -z "$OFFLINE_FIRST" ] && cache_is_available && [ "$NPM_CACHE_DIR" = /workspace/.npm-cache ]; then
  OFFLINE_FIRST=1
fi

if [ -z "$OFFLINE_FIRST" ] && cache_is_available && ! registry_is_available_in_docker; then
  OFFLINE_FIRST=1
fi

build_image apps/api/Dockerfile garanti-kulucka-api:local
build_image apps/worker/Dockerfile garanti-kulucka-worker:local
build_image apps/migrator/Dockerfile garanti-kulucka-migrator:local
build_image apps/web/Dockerfile garanti-kulucka-web:local
