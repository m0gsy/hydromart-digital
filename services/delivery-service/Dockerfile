# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart delivery-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/delivery-service/package.json ./services/delivery-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/delivery-service/prisma ./services/delivery-service/prisma
RUN npm ci --include-workspace-root
COPY services/delivery-service ./services/delivery-service
RUN npm run build -w @hydromart/platform \
  && cd services/delivery-service && npx prisma generate && npm run build
RUN npm prune --omit=dev && mkdir -p /app/services/delivery-service/node_modules

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/delivery-service/node_modules ./services/delivery-service/node_modules
COPY --from=builder --chown=app:app /app/services/delivery-service/dist ./services/delivery-service/dist
COPY --from=builder --chown=app:app /app/services/delivery-service/prisma ./services/delivery-service/prisma
COPY --from=builder --chown=app:app /app/services/delivery-service/package.json ./services/delivery-service/
USER app
WORKDIR /app/services/delivery-service
EXPOSE 3006
CMD ["node", "dist/src/main.js"]
