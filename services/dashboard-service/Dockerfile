# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart dashboard-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY packages/access/package.json ./packages/access/
COPY services/dashboard-service/package.json ./services/dashboard-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY packages/access ./packages/access
# BuildKit cache mount: every image bakes the whole monorepo, so a cold rebuild used to
# be N x a full `npm ci` download from Indonesia. The mount keeps the npm cache on the
# builder between images and between runs; it never lands in a layer, so images stay the
# same size. `npm ci` still deletes node_modules first, so builds remain reproducible.
# 19 images build at once in CI, each pulling the whole workspace. npm defaults to 2
# retries / 60s, so one stalled socket under that contention kills the entire build
# (seen twice: ECONNRESET, then ETIMEDOUT, on different services each time).
RUN --mount=type=cache,target=/root/.npm npm ci --include-workspace-root \
  --fetch-retries=5 --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000
COPY services/dashboard-service ./services/dashboard-service
RUN npm run build -w @hydromart/access \
  && npm run build -w @hydromart/platform \
  && cd services/dashboard-service && npm run build
RUN mkdir -p /app/services/dashboard-service/node_modules
RUN npm prune --omit=dev && mkdir -p /app/services/dashboard-service/node_modules

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/dashboard-service/node_modules ./services/dashboard-service/node_modules
COPY --from=builder --chown=app:app /app/services/dashboard-service/dist ./services/dashboard-service/dist
COPY --from=builder --chown=app:app /app/services/dashboard-service/package.json ./services/dashboard-service/
USER app
WORKDIR /app/services/dashboard-service
EXPOSE 3008
CMD ["node", "dist/src/main.js"]
