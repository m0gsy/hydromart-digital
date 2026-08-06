# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart customer web app (Next.js 15, standalone output).
# Build context MUST be the repo root so npm-workspace deps resolve:
#   docker build -f apps/web/Dockerfile -t hydromart-web .

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* is inlined into the client bundle at build time, so it must be
# present BEFORE `next build` — and it is FROZEN into the shipped JS (changing it
# on the running container does nothing; only a rebuild moves it). REQUIRED, no
# default: an unset value would silently bake http://localhost:8080 and every
# remote visitor's browser would call THEIR own machine. Fail the build instead.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "ERROR: build arg NEXT_PUBLIC_API_URL is required (the PUBLIC gateway origin, e.g. https://api.example.com or http://<vps-ip>:8080)." >&2 && false)
# Install against the root lockfile (workspaces), then build the shared RBAC
# package (roles.ts imports @hydromart/access) and only @hydromart/web.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/access/package.json ./packages/access/
COPY apps/web/package.json ./apps/web/
# Access source must land BEFORE `npm ci` — @hydromart/access has a `prepare`
# (tsc) that npm runs during install, and it needs its tsconfig + source present.
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
RUN npm run build -w @hydromart/access
COPY apps/web ./apps/web
RUN npm run build -w @hydromart/web

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
# Standalone bundle ships a minimal Node server + traced node_modules, preserving
# the monorepo layout (server.js lands under apps/web/).
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
