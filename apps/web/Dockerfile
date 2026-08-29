# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart customer web app (Next.js 15, standalone output).
# Build context MUST be the repo root so npm-workspace deps resolve:
#   docker build -f apps/web/Dockerfile -t hydromart-web .

FROM node:22-alpine AS builder
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
# Shown on the account screen so a support conversation can start from which build the
# user is on. Optional, unlike the URL above: an unset version is a cosmetic annoyance,
# not a broken deployment, so it defaults instead of failing the build.
ARG NEXT_PUBLIC_APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
# N2: the client error reporter is inlined at build time like everything NEXT_PUBLIC_*,
# and nothing ever passed it — so `SentryInit` read an undefined DSN, returned early, and
# never downloaded the SDK in ANY artefact we ship. The server half has been reporting 5xx
# all along, which is exactly why nobody noticed that everything a user actually sees was
# invisible. Optional, and empty means OFF: no DSN, no SDK in the bundle, nothing sent.
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENV=production
ENV NEXT_PUBLIC_SENTRY_ENV=$NEXT_PUBLIC_SENTRY_ENV
# The courier hotline, read at driver/help/page.tsx:37. NEXT_PUBLIC_* is inlined by
# `next build`, so a value that only exists at RUNTIME is a value the bundle never sees:
# the call and WhatsApp buttons on the courier's help screen could not appear no matter
# what anybody put in .env. Same failure shape as NEXT_PUBLIC_SENTRY_DSN above.
# Blank default on purpose — the screen hides both buttons when it is empty, which is the
# correct behaviour for a deployment that has no fleet line yet.
ARG NEXT_PUBLIC_COURIER_HOTLINE=
ENV NEXT_PUBLIC_COURIER_HOTLINE=$NEXT_PUBLIC_COURIER_HOTLINE
# Install against the root lockfile (workspaces), then build the shared RBAC
# package (roles.ts imports @hydromart/access) and only @hydromart/web.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/access/package.json ./packages/access/
COPY apps/web/package.json ./apps/web/
# M14: `prepare` on @hydromart/access calls this, and `npm ci` runs `prepare`, so it has
# to land above the install.
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
# M14. The access source used to sit ABOVE `npm ci` — because `prepare` compiles it and
# needed it there — so one line in @hydromart/access invalidated the install layer here
# too. `prepare` now compiles only when the source is present, so the install runs without
# it and the source arrives here, immediately above the build that consumes it.
COPY packages/access ./packages/access
RUN npm run build -w @hydromart/access
COPY apps/web ./apps/web
RUN npm run build -w @hydromart/web

FROM node:22-alpine AS runtime
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
