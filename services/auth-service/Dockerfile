# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart auth-service (deploys to Cloud Run).

# ---- Builder ----
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

# Install dependencies against the lockfile for reproducible builds.
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY packages/access/package.json ./packages/access/
COPY services/auth-service/package.json ./services/auth-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY packages/access ./packages/access
COPY services/auth-service/prisma ./services/auth-service/prisma
# BuildKit cache mount: every image bakes the whole monorepo, so a cold rebuild used to
# be N x a full `npm ci` download from Indonesia. The mount keeps the npm cache on the
# builder between images and between runs; it never lands in a layer, so images stay the
# same size. `npm ci` still deletes node_modules first, so builds remain reproducible.
# 19 images build at once in CI, each pulling the whole workspace. npm defaults to 2
# retries / 60s, so one stalled socket under that contention kills the entire build
# (seen twice: ECONNRESET, then ETIMEDOUT, on different services each time).
RUN --mount=type=cache,target=/root/.npm npm ci --include-workspace-root \
  --fetch-retries=5 --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000

COPY services/auth-service ./services/auth-service
RUN npm run build -w @hydromart/access \
  && npm run build -w @hydromart/platform \
  && cd services/auth-service && npx prisma generate && npm run build

# Prune dev dependencies for a lean runtime image.
RUN npm prune --omit=dev && mkdir -p /app/services/auth-service/node_modules

# ---- Runtime ----
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app

# Run as a non-root user (least privilege).
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/auth-service/node_modules ./services/auth-service/node_modules
COPY --from=builder --chown=app:app /app/services/auth-service/dist ./services/auth-service/dist
COPY --from=builder --chown=app:app /app/services/auth-service/prisma ./services/auth-service/prisma
COPY --from=builder --chown=app:app /app/services/auth-service/package.json ./services/auth-service/

USER app
WORKDIR /app/services/auth-service

# Cloud Run provides PORT; the app reads AUTH_SERVICE_PORT — map it at deploy time.
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
