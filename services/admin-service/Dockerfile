# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart admin-service (deploys to Cloud Run / VPS).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY packages/access/package.json ./packages/access/
COPY services/admin-service/package.json ./services/admin-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY packages/access ./packages/access
COPY services/admin-service/prisma ./services/admin-service/prisma
RUN npm ci --include-workspace-root
COPY services/admin-service ./services/admin-service
RUN npm run build -w @hydromart/platform \
  && npm run build -w @hydromart/access \
  && cd services/admin-service && npx prisma generate && npm run build
RUN npm prune --omit=dev && mkdir -p /app/services/admin-service/node_modules

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/admin-service/node_modules ./services/admin-service/node_modules
COPY --from=builder --chown=app:app /app/services/admin-service/dist ./services/admin-service/dist
COPY --from=builder --chown=app:app /app/services/admin-service/prisma ./services/admin-service/prisma
COPY --from=builder --chown=app:app /app/services/admin-service/package.json ./services/admin-service/
USER app
WORKDIR /app/services/admin-service
EXPOSE 3017
CMD ["node", "dist/src/main.js"]
