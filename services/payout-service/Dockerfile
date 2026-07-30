# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart payout-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY packages/access/package.json ./packages/access/
COPY services/payout-service/package.json ./services/payout-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY packages/access ./packages/access
COPY services/payout-service/prisma ./services/payout-service/prisma
# BuildKit cache mount: every image bakes the whole monorepo, so a cold rebuild used to
# be N x a full `npm ci` download from Indonesia. The mount keeps the npm cache on the
# builder between images and between runs; it never lands in a layer, so images stay the
# same size. `npm ci` still deletes node_modules first, so builds remain reproducible.
# 19 images build at once in CI, each pulling the whole workspace. npm defaults to 2
# retries / 60s, so one stalled socket under that contention kills the entire build
# (seen twice: ECONNRESET, then ETIMEDOUT, on different services each time).
RUN --mount=type=cache,target=/root/.npm npm ci --include-workspace-root \
  --fetch-retries=5 --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000
COPY services/payout-service ./services/payout-service
RUN npm run build -w @hydromart/access \
  && npm run build -w @hydromart/platform \
  && cd services/payout-service && npx prisma generate && npm run build
RUN npm prune --omit=dev && mkdir -p /app/services/payout-service/node_modules

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/payout-service/node_modules ./services/payout-service/node_modules
COPY --from=builder --chown=app:app /app/services/payout-service/dist ./services/payout-service/dist
COPY --from=builder --chown=app:app /app/services/payout-service/prisma ./services/payout-service/prisma
COPY --from=builder --chown=app:app /app/services/payout-service/package.json ./services/payout-service/
USER app
WORKDIR /app/services/payout-service
EXPOSE 3016
CMD ["node", "dist/src/main.js"]
