# syntax=docker/dockerfile:1
# Multi-stage build for the Hydromart face-service (the face embedder behind hr-service's
# fallback when NEO is down).
#
# Debian bookworm-slim, not alpine like the other services, in BOTH stages: onnxruntime-node
# ships glibc binaries only, and sharp's prebuilt libvips for glibc is the one the self-test
# below was measured with. No apt packages are needed — sharp brings its own libvips, ORT its
# own runtime, and the healthcheck is `node -e fetch(...)`, not curl.

FROM node:22.23.4-bookworm-slim AS builder
# The onnxruntime-node install script fetches GPU builds for linux x64; this is a CPU engine.
ENV ONNXRUNTIME_NODE_INSTALL=skip
WORKDIR /app
# The two models first, so this layer depends on the fetch script alone and stays cached
# through every code change. Pinned by sha256 to opencv_zoo's files at one commit, with
# opencv's Hugging Face mirror behind the LFS host — see the script for why not `ADD`.
COPY services/face-service/scripts/fetch-models.mjs /tmp/fetch-models.mjs
RUN node /tmp/fetch-models.mjs /app/models
COPY package.json package-lock.json ./
COPY packages/platform/package.json ./packages/platform/
COPY packages/access/package.json ./packages/access/
COPY services/face-service/package.json ./services/face-service/
COPY tsconfig.base.json ./
# Same install shape as every other image (see services/hr-service/Dockerfile for the why of
# each line): the helpers `npm ci` runs land first, the cache mount keeps downloads off the
# network between images, and the retries are the last line of defence.
COPY scripts/prisma-generate-if-stale.mjs ./scripts/
COPY scripts/build-shared-if-source.mjs ./scripts/
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --include-workspace-root --prefer-offline \
  --fetch-retries=5 --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000
COPY packages/access ./packages/access
COPY packages/platform ./packages/platform
RUN npm run build --workspace @hydromart/access && npm run build --workspace @hydromart/platform
COPY services/face-service ./services/face-service
RUN cd services/face-service && npm run build

# The image is not built unless the pipeline, with these exact sharp and ORT binaries, still
# matches OpenCV's embeddings of the fixtures (cosine ≥ 0.99, same person ≥ 0.5, different
# people ≤ 0.3, no face found where there is none). See src/selftest.ts.
RUN cd services/face-service && node dist/src/selftest.js /app/models test/fixtures

# Runtime deps only. ORT carries every platform's binaries; this box runs linux only. The
# mkdir keeps the COPY below valid when the service has no nested node_modules.
RUN npm prune --omit=dev \
  && rm -rf node_modules/@types node_modules/typescript \
    node_modules/onnxruntime-node/bin/napi-v*/darwin node_modules/onnxruntime-node/bin/napi-v*/win32 \
  && mkdir -p /app/services/face-service/node_modules

FROM node:22.23.4-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --no-create-home app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages/access/dist ./packages/access/dist
COPY --from=builder --chown=app:app /app/packages/access/package.json ./packages/access/
COPY --from=builder --chown=app:app /app/packages/platform/dist ./packages/platform/dist
COPY --from=builder --chown=app:app /app/packages/platform/package.json ./packages/platform/
COPY --from=builder --chown=app:app /app/services/face-service/node_modules ./services/face-service/node_modules
COPY --from=builder --chown=app:app /app/services/face-service/dist ./services/face-service/dist
COPY --from=builder --chown=app:app /app/services/face-service/package.json ./services/face-service/
# Read-only for the app user: the engine refuses anything but the pinned bytes anyway.
COPY --from=builder /app/models /app/models
USER app
WORKDIR /app/services/face-service
ENV FACE_MODEL_DIR=/app/models
EXPOSE 3019
CMD ["node", "dist/src/main.js"]
