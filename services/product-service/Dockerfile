# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart product-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/product-service/package.json ./services/product-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/product-service/prisma ./services/product-service/prisma
RUN npm ci --include-workspace-root
COPY services/product-service ./services/product-service
RUN npm run build -w @hydromart/platform \
  && cd services/product-service && npx prisma generate && npm run build
RUN npm prune --omit=dev && mkdir -p /app/services/product-service/node_modules

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/product-service/node_modules ./services/product-service/node_modules
COPY --from=builder --chown=app:app /app/services/product-service/dist ./services/product-service/dist
COPY --from=builder --chown=app:app /app/services/product-service/prisma ./services/product-service/prisma
COPY --from=builder --chown=app:app /app/services/product-service/package.json ./services/product-service/
USER app
WORKDIR /app/services/product-service
EXPOSE 3003
CMD ["node", "dist/src/main.js"]
