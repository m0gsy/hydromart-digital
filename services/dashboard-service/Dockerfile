# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart dashboard-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY packages/access/package.json ./packages/access/
COPY services/dashboard-service/package.json ./services/dashboard-service/
COPY tsconfig.base.json ./
# CI-3: each service's `postinstall` runs this instead of `prisma generate` — it skips
# when the schema hash and CLI version already match what is on disk. It must land
# BEFORE `npm ci`, which is what runs postinstall.
COPY scripts/prisma-generate-if-stale.mjs ./scripts/
# M14: `prepare` on the shared packages calls this, and `npm ci` runs `prepare` — so it
# has to be here, above the install, exactly like the postinstall helper on the line up.
COPY scripts/build-shared-if-source.mjs ./scripts/
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
# M14. Everything above this line depends only on the lockfile and the package.json
# files, so it survives a change to packages/ and to this service's own source. `npm ci`
# used to sit BELOW `COPY packages/*`, so one line in @hydromart/platform invalidated it in
# all nineteen images, and a deploy touching packages/ took ~39 minutes.
#
# What made the move possible is `prepare` learning about the case, not a flag:
# `npm ci --ignore-scripts` was tried first and npm ran `prepare` anyway, dying on
# `TS5058 ... '../access/tsconfig.json'` (measured 2026-08-25). So `prepare` now compiles
# only when the source is present, and here it is not — the source arrives next, and the
# same `tsc` runs explicitly below.
#
# access first: platform imports it, and .dockerignore strips **/dist so nothing is prebuilt.
COPY packages/access ./packages/access
COPY packages/platform ./packages/platform
RUN npm run build --workspace @hydromart/access && npm run build --workspace @hydromart/platform
COPY services/dashboard-service ./services/dashboard-service
# CI-8: @hydromart/access and @hydromart/platform are ALREADY compiled at this point —
# `npm ci` runs their `prepare` scripts. Rebuilding them here compiled access three
# times and platform twice, in every one of the nineteen images.
RUN cd services/dashboard-service && npm run build
# CI-6: `npm prune --omit=dev` alone left three build-only trees in the runtime image.
# The Prisma CLI is the big one (26 MB): `prisma generate` runs in the builder above and
# the generated client lives under prisma/generated/, so the CLI is never loaded again —
# production migrations are run from the host by scripts/migrate-prod.sh, not in here.
# @types and typescript are declaration files a compiled image cannot require at all.
# Measured on order-service: 155 MB -> 126 MB of node_modules, and the whole app module
# graph still resolves. `npm prune --workspace` was tried first and changes nothing —
# npm computes the same tree with or without it.
# The mkdir keeps the COPY below valid for a service with no nested node_modules.
RUN npm prune --omit=dev \
  && rm -rf node_modules/prisma node_modules/.bin/prisma node_modules/@types node_modules/typescript \
  && mkdir -p /app/services/dashboard-service/node_modules

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
# CI-7: only the compiled output and its manifest. The runtime never reads the shared
# packages' src/, test/ or tsconfigs, and shipping them put source in a production image.
COPY --from=builder --chown=app:app /app/packages/access/dist ./packages/access/dist
COPY --from=builder --chown=app:app /app/packages/access/package.json ./packages/access/
COPY --from=builder --chown=app:app /app/packages/platform/dist ./packages/platform/dist
COPY --from=builder --chown=app:app /app/packages/platform/package.json ./packages/platform/
COPY --from=builder --chown=app:app /app/services/dashboard-service/node_modules ./services/dashboard-service/node_modules
COPY --from=builder --chown=app:app /app/services/dashboard-service/dist ./services/dashboard-service/dist
COPY --from=builder --chown=app:app /app/services/dashboard-service/package.json ./services/dashboard-service/
USER app
WORKDIR /app/services/dashboard-service
EXPOSE 3008
CMD ["node", "dist/src/main.js"]
