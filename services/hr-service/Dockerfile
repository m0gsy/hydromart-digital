# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart hr-service (HRIS Lite).

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY packages/access/package.json ./packages/access/
COPY services/hr-service/package.json ./services/hr-service/
COPY tsconfig.base.json ./
COPY packages/platform ./packages/platform
COPY packages/access ./packages/access
COPY services/hr-service/prisma ./services/hr-service/prisma
RUN npm ci --include-workspace-root
COPY services/hr-service ./services/hr-service
RUN npm run build -w @hydromart/platform \
  && npm run build -w @hydromart/access \
  && cd services/hr-service && npx prisma generate && npm run build
RUN npm prune --omit=dev && mkdir -p /app/services/hr-service/node_modules

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/services/hr-service/node_modules ./services/hr-service/node_modules
COPY --from=builder --chown=app:app /app/services/hr-service/dist ./services/hr-service/dist
COPY --from=builder --chown=app:app /app/services/hr-service/prisma ./services/hr-service/prisma
COPY --from=builder --chown=app:app /app/services/hr-service/package.json ./services/hr-service/
USER app
WORKDIR /app/services/hr-service
EXPOSE 3018
CMD ["node", "dist/src/main.js"]
