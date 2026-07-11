# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart forecast-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/forecast-service/package.json ./services/forecast-service/
RUN npm ci --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/forecast-service ./services/forecast-service
RUN npm run build -w @hydromart/platform \
  && cd services/forecast-service && npx prisma generate && npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/forecast-service/node_modules ./services/forecast-service/node_modules
COPY --from=builder --chown=app:app /app/services/forecast-service/dist ./services/forecast-service/dist
COPY --from=builder --chown=app:app /app/services/forecast-service/prisma ./services/forecast-service/prisma
COPY --from=builder --chown=app:app /app/services/forecast-service/package.json ./services/forecast-service/
USER app
WORKDIR /app/services/forecast-service
EXPOSE 3014
CMD ["node", "dist/src/main.js"]
