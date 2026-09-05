# syntax=docker/dockerfile:1
#
# Admin web app (Next.js 16, App Router).
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not `admin/`:
#
#   docker build -f deploy/admin.Dockerfile .
#
# `admin/package.json` declares `@douyin-clone/shared-toast` as
# `file:../shared/toast`, which resolves outside `admin/`.
#
# See deploy/user.Dockerfile for the full reasoning on standalone output and on
# the build-time/runtime environment split. The short version:
#
#   build args (baked in, need a rebuild to change, none secret)
#     NEXT_PUBLIC_API_ENDPOINT, API_SERVER_ENDPOINT, PROXY_API_TARGET
#   runtime env (ordinary container variables)
#     NEXTAUTH_URL, NEXTAUTH_SECRET
#
# `admin/next.config.js` never listed NEXTAUTH_SECRET in its `env:` block, so
# unlike the user app it always read the secret at runtime. It is not a build
# arg here and must never become one.
#
# Admin has no NEXT_PUBLIC_SITE_URL or SITE_URL: its config's `env:` block
# declares them but nothing in the app reads them, and NEXTAUTH_URL is what
# actually anchors the session origin.

# ---------------------------------------------------------------- build stage
FROM node:22-bookworm-slim AS build

WORKDIR /repo

COPY shared/ ./shared/

COPY admin/package.json admin/yarn.lock ./admin/
WORKDIR /repo/admin
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY admin/ ./

ARG NEXT_PUBLIC_API_ENDPOINT
ARG API_SERVER_ENDPOINT
ARG PROXY_API_TARGET

ENV NEXT_PUBLIC_API_ENDPOINT=${NEXT_PUBLIC_API_ENDPOINT} \
    API_SERVER_ENDPOINT=${API_SERVER_ENDPOINT} \
    PROXY_API_TARGET=${PROXY_API_TARGET} \
    NEXT_TELEMETRY_DISABLED=1

RUN test -n "$NEXT_PUBLIC_API_ENDPOINT" || (echo "NEXT_PUBLIC_API_ENDPOINT build arg is required" && exit 1) \
 && test -n "$PROXY_API_TARGET"         || (echo "PROXY_API_TARGET build arg is required" && exit 1)

RUN yarn build && rm -f dist/.next/standalone/.env

# -------------------------------------------------------------- runtime stage
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8082 \
    HOSTNAME=0.0.0.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build --chown=node:node /repo/admin/dist/.next/standalone ./
COPY --from=build --chown=node:node /repo/admin/dist/.next/static ./dist/.next/static
COPY --from=build --chown=node:node /repo/admin/public ./public

USER node

EXPOSE 8082

# `/` redirects to `/dashboard` (a permanent redirect declared in
# next.config.js), so the healthcheck accepts the 308 rather than following it
# into an authenticated page.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS -o /dev/null -w "%{http_code}" http://127.0.0.1:8082/ | grep -qE "^(200|30[0-9])$" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
