# syntax=docker/dockerfile:1
#
# File server image.
#
# BUILD CONTEXT IS THE REPOSITORY ROOT (see api.Dockerfile for why):
#
#   docker build -f deploy/file-server.Dockerfile .

# ---------------------------------------------------------------- build stage
FROM node:22-bookworm-slim AS build

WORKDIR /repo

COPY shared/ ./shared/

COPY file-server/package.json file-server/yarn.lock ./file-server/
WORKDIR /repo/file-server
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY file-server/ ./
RUN yarn build

RUN yarn install --frozen-lockfile --production --network-timeout 600000

# -------------------------------------------------------------- runtime stage
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

# FFmpeg is a hard runtime dependency, not an optional extra: every video upload
# is probed with ffprobe and transcoded with ffmpeg, and without them uploads
# fail on the queue — minutes after the client was told the transfer succeeded.
#
# Sharp is NOT installed here. It ships prebuilt linux-x64 glibc binaries and
# they come across in node_modules from the build stage; both stages are the
# same bookworm-slim base precisely so those binaries stay valid. Switching
# either stage to Alpine breaks Sharp (musl) and is the usual cause of
# "Could not load the sharp module" at boot.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /repo/file-server/node_modules ./node_modules
COPY --from=build /repo/file-server/dist ./dist
COPY --from=build /repo/file-server/package.json ./package.json
COPY --from=build /repo/file-server/scripts ./scripts

# Working directories. `main.ts` creates and write-tests both at boot, so a
# read-only or missing mount is a startup failure rather than a silent one.
#
# `public/` still exists on an R2 deployment and that is deliberate: media
# uploaded before the cutover is recorded with `storageType: diskStorage` and is
# still read from here. Do not drop this volume when switching to a bucket.
RUN mkdir -p /app/temp /app/public /app/storage/tus-uploads \
 && chown -R node:node /app/temp /app/public /app/storage

ENV FILE_TEMP_DIR=/app/temp \
    FILE_PUBLIC_DIR=/app/public \
    TUS_UPLOAD_DIR=/app/storage/tus-uploads

USER node

EXPOSE 8000

# Liveness only. Readiness (/health/ready) additionally checks Mongo, that the
# temp volume is writable, and that object storage is configured — a container
# that fails those should stop receiving traffic, not be restarted.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
