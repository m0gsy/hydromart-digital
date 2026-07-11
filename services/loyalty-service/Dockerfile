# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart loyalty-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/loyalty-service/package.json ./services/loyalty-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/loyalty-service/prisma ./services/loyalty-service/prisma
RUN npm ci --include-workspace-root
COPY services/loyalty-service ./services/loyalty-service
RUN npm run build -w @hydromart/platform \
  && cd services/loyalty-service && npx prisma generate && npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/loyalty-service/node_modules ./services/loyalty-service/node_modules
COPY --from=builder --chown=app:app /app/services/loyalty-service/dist ./services/loyalty-service/dist
COPY --from=builder --chown=app:app /app/services/loyalty-service/prisma ./services/loyalty-service/prisma
COPY --from=builder --chown=app:app /app/services/loyalty-service/package.json ./services/loyalty-service/
USER app
WORKDIR /app/services/loyalty-service
EXPOSE 3009
CMD ["node", "dist/src/main.js"]
