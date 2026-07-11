# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart promo-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/promo-service/package.json ./services/promo-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/promo-service/prisma ./services/promo-service/prisma
RUN npm ci --include-workspace-root
COPY services/promo-service ./services/promo-service
RUN npm run build -w @hydromart/platform \
  && cd services/promo-service && npx prisma generate && npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/promo-service/node_modules ./services/promo-service/node_modules
COPY --from=builder --chown=app:app /app/services/promo-service/dist ./services/promo-service/dist
COPY --from=builder --chown=app:app /app/services/promo-service/prisma ./services/promo-service/prisma
COPY --from=builder --chown=app:app /app/services/promo-service/package.json ./services/promo-service/
USER app
WORKDIR /app/services/promo-service
EXPOSE 3010
CMD ["node", "dist/src/main.js"]
