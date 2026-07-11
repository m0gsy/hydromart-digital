# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart referral-service (deploys to Cloud Run).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY services/referral-service/package.json ./services/referral-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY services/referral-service/prisma ./services/referral-service/prisma
RUN npm ci --include-workspace-root
COPY services/referral-service ./services/referral-service
RUN npm run build -w @hydromart/platform \
  && cd services/referral-service && npx prisma generate && npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/referral-service/node_modules ./services/referral-service/node_modules
COPY --from=builder --chown=app:app /app/services/referral-service/dist ./services/referral-service/dist
COPY --from=builder --chown=app:app /app/services/referral-service/prisma ./services/referral-service/prisma
COPY --from=builder --chown=app:app /app/services/referral-service/package.json ./services/referral-service/
USER app
WORKDIR /app/services/referral-service
EXPOSE 3011
CMD ["node", "dist/src/main.js"]
