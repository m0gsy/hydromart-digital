# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart gateway-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY packages/access/package.json ./packages/access/
COPY services/gateway-service/package.json ./services/gateway-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY packages/access ./packages/access
# BuildKit cache mount: every image bakes the whole monorepo, so a cold rebuild used to
# be N x a full `npm ci` download from Indonesia. The mount keeps the npm cache on the
# builder between images and between runs; it never lands in a layer, so images stay the
# same size. `npm ci` still deletes node_modules first, so builds remain reproducible.
# CI builds these in batches of three now (test/integration/run.mjs and the e2e job), so
# the first batch fills this cache and the rest read it — `--prefer-offline` then keeps
# them off the network altogether. Built all at once, each image pulling the whole
# workspace, they were N cold downloads in the same instant: that is what produced EEXIST
# in cacache's tmp dir, and then ECONNRESET and ETIMEDOUT on different services each time.
# sharing=locked stops concurrent writers; it does NOT serialise separate compose builds,
# which is why the batching is what actually removes the burst. The retry flags below are
# the last line of defence for whichever batch does have to fetch.
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --include-workspace-root --prefer-offline \
  --fetch-retries=5 --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000
COPY services/gateway-service ./services/gateway-service
RUN npm run build -w @hydromart/access \
  && npm run build -w @hydromart/platform \
  && cd services/gateway-service && npm run build
RUN mkdir -p /app/services/gateway-service/node_modules
RUN npm prune --omit=dev && mkdir -p /app/services/gateway-service/node_modules

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/gateway-service/node_modules ./services/gateway-service/node_modules
COPY --from=builder --chown=app:app /app/services/gateway-service/dist ./services/gateway-service/dist
COPY --from=builder --chown=app:app /app/services/gateway-service/package.json ./services/gateway-service/
USER app
WORKDIR /app/services/gateway-service
EXPOSE 8080
CMD ["node", "dist/src/main.js"]
