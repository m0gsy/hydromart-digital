# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart customer-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/customer-service/package.json ./services/customer-service/
RUN npm ci --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/customer-service ./services/customer-service
RUN npm run build -w @hydromart/platform \
  && cd services/customer-service && npx prisma generate && npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
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
