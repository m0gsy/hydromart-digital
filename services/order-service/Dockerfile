# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart order-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/order-service/package.json ./services/order-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/order-service/prisma ./services/order-service/prisma
RUN npm ci --include-workspace-root
COPY services/order-service ./services/order-service
RUN npm run build -w @hydromart/platform \
  && cd services/order-service && npx prisma generate && npm run build
RUN npm prune --omit=dev && mkdir -p /app/services/order-service/node_modules

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/order-service/node_modules ./services/order-service/node_modules
COPY --from=builder --chown=app:app /app/services/order-service/dist ./services/order-service/dist
COPY --from=builder --chown=app:app /app/services/order-service/prisma ./services/order-service/prisma
COPY --from=builder --chown=app:app /app/services/order-service/package.json ./services/order-service/
USER app
WORKDIR /app/services/order-service
EXPOSE 3004
CMD ["node", "dist/src/main.js"]
