# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart depot-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/depot-service/package.json ./services/depot-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/depot-service/prisma ./services/depot-service/prisma
RUN npm ci --include-workspace-root
COPY services/depot-service ./services/depot-service
RUN npm run build -w @hydromart/platform \
  && cd services/depot-service && npx prisma generate && npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/depot-service/node_modules ./services/depot-service/node_modules
COPY --from=builder --chown=app:app /app/services/depot-service/dist ./services/depot-service/dist
COPY --from=builder --chown=app:app /app/services/depot-service/prisma ./services/depot-service/prisma
COPY --from=builder --chown=app:app /app/services/depot-service/package.json ./services/depot-service/
USER app
WORKDIR /app/services/depot-service
EXPOSE 3007
CMD ["node", "dist/src/main.js"]
