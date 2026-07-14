# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart customer-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY packages/access/package.json ./packages/access/
COPY services/customer-service/package.json ./services/customer-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY packages/access ./packages/access
COPY services/customer-service/prisma ./services/customer-service/prisma
RUN npm ci --include-workspace-root
COPY services/customer-service ./services/customer-service
RUN npm run build -w @hydromart/platform \
  && npm run build -w @hydromart/access \
  && cd services/customer-service && npx prisma generate && npm run build
RUN npm prune --omit=dev && mkdir -p /app/services/customer-service/node_modules

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/customer-service/node_modules ./services/customer-service/node_modules
COPY --from=builder --chown=app:app /app/services/customer-service/dist ./services/customer-service/dist
COPY --from=builder --chown=app:app /app/services/customer-service/prisma ./services/customer-service/prisma
COPY --from=builder --chown=app:app /app/services/customer-service/package.json ./services/customer-service/
USER app
WORKDIR /app/services/customer-service
EXPOSE 3002
CMD ["node", "dist/src/main.js"]
