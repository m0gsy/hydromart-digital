# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart dashboard-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/dashboard-service/package.json ./services/dashboard-service/
RUN npm ci --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/dashboard-service ./services/dashboard-service
RUN npm run build -w @hydromart/platform \
  && cd services/dashboard-service && npm run build
RUN npm prune --omit=dev

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
CMD ["node", "dist/main.js"]
