# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart payment-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/payment-service/package.json ./services/payment-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/payment-service/prisma ./services/payment-service/prisma
RUN npm ci --include-workspace-root
COPY services/payment-service ./services/payment-service
RUN npm run build -w @hydromart/platform \
  && cd services/payment-service && npx prisma generate && npm run build
RUN npm prune --omit=dev && mkdir -p /app/services/payment-service/node_modules

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/payment-service/node_modules ./services/payment-service/node_modules
COPY --from=builder --chown=app:app /app/services/payment-service/dist ./services/payment-service/dist
COPY --from=builder --chown=app:app /app/services/payment-service/prisma ./services/payment-service/prisma
COPY --from=builder --chown=app:app /app/services/payment-service/package.json ./services/payment-service/
USER app
WORKDIR /app/services/payment-service
EXPOSE 3005
CMD ["node", "dist/src/main.js"]
