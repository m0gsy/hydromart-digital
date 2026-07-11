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
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
# Install against the root lockfile (workspaces), then build only @hydromart/web.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
RUN npm ci --include-workspace-root
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
