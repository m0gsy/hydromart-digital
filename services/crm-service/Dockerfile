# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart crm-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/crm-service/package.json ./services/crm-service/
RUN npm ci --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/crm-service ./services/crm-service
RUN npm run build -w @hydromart/platform \
  && cd services/crm-service && npx prisma generate && npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/crm-service/node_modules ./services/crm-service/node_modules
COPY --from=builder --chown=app:app /app/services/crm-service/dist ./services/crm-service/dist
COPY --from=builder --chown=app:app /app/services/crm-service/prisma ./services/crm-service/prisma
COPY --from=builder --chown=app:app /app/services/crm-service/package.json ./services/crm-service/
USER app
WORKDIR /app/services/crm-service
EXPOSE 3012
CMD ["node", "dist/src/main.js"]
