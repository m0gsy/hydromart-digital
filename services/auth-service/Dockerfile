# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart auth-service (deploys to Cloud Run).

# ---- Builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies against the lockfile for reproducible builds.
COPY package.json package-lock.json ./
COPY services/auth-service/package.json ./services/auth-service/
RUN npm ci --workspace @hydromart/auth-service --include-workspace-root

COPY tsconfig.base.json ./
COPY services/auth-service ./services/auth-service
WORKDIR /app/services/auth-service
RUN npx prisma generate && npm run build

# Prune dev dependencies for a lean runtime image.
RUN npm prune --omit=dev

# ---- Runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as a non-root user (least privilege).
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/services/auth-service/node_modules ./services/auth-service/node_modules
COPY --from=builder --chown=app:app /app/services/auth-service/dist ./services/auth-service/dist
COPY --from=builder --chown=app:app /app/services/auth-service/prisma ./services/auth-service/prisma
COPY --from=builder --chown=app:app /app/services/auth-service/package.json ./services/auth-service/

USER app
WORKDIR /app/services/auth-service

# Cloud Run provides PORT; the app reads AUTH_SERVICE_PORT — map it at deploy time.
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
