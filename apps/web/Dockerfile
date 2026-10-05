FROM node:22.23.3-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm \
  npm ci --prefer-offline --no-audit --no-fund --fetch-retries=2 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=60000 \
  || npm ci --offline --no-audit --no-fund

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN npm run build -w @garanti-kulucka/shared \
  && npm run build -w @garanti-kulucka/web

FROM nginx:1.27.5-alpine AS runtime
COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
