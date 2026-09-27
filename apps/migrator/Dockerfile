FROM node:22.20.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/migrator/package.json apps/migrator/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/migrator apps/migrator
COPY packages/shared packages/shared
COPY packages/database packages/database
RUN npm run build -w @garanti-kulucka/shared \
  && npm run build -w @garanti-kulucka/database \
  && npm run build -w @garanti-kulucka/migrator

FROM node:22.20.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/migrator/package.json ./apps/migrator/package.json
COPY --from=build /app/apps/migrator/dist ./apps/migrator/dist
COPY --from=build /app/packages/database/package.json ./packages/database/package.json
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/database/migrations ./packages/database/migrations
USER app
ENTRYPOINT ["node", "apps/migrator/dist/cli.js"]
CMD ["migrate", "--dry-run"]
