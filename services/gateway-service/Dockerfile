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
RUN npm ci --include-workspace-root
COPY services/gateway-service ./services/gateway-service
RUN npm run build -w @hydromart/platform \
  && npm run build -w @hydromart/access \
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
