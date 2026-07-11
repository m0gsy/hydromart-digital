# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart recommendation-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/recommendation-service/package.json ./services/recommendation-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/recommendation-service/prisma ./services/recommendation-service/prisma
RUN npm ci --include-workspace-root
COPY services/recommendation-service ./services/recommendation-service
RUN npm run build -w @hydromart/platform \
  && cd services/recommendation-service && npx prisma generate && npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/recommendation-service/node_modules ./services/recommendation-service/node_modules
COPY --from=builder --chown=app:app /app/services/recommendation-service/dist ./services/recommendation-service/dist
COPY --from=builder --chown=app:app /app/services/recommendation-service/prisma ./services/recommendation-service/prisma
COPY --from=builder --chown=app:app /app/services/recommendation-service/package.json ./services/recommendation-service/
USER app
WORKDIR /app/services/recommendation-service
EXPOSE 3013
CMD ["node", "dist/src/main.js"]
