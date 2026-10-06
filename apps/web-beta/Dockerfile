FROM node:22.23.3-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web-beta/package.json apps/web-beta/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm \
  npm ci --prefer-offline --no-audit --no-fund --fetch-retries=2 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=60000 \
  || npm ci --offline --no-audit --no-fund

FROM deps AS build
ARG VITE_BACKEND_BASE_URL=/backend
ENV VITE_BACKEND_BASE_URL=$VITE_BACKEND_BASE_URL
COPY tsconfig.base.json ./
COPY apps/web-beta apps/web-beta
COPY packages/shared packages/shared
RUN npm run build -w @garanti-kulucka/shared \
  && npm run build -w @garanti-kulucka/web-beta

FROM nginx:1.27.5-alpine AS runtime
COPY apps/web-beta/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web-beta/dist /usr/share/nginx/html
RUN nginx -t
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
