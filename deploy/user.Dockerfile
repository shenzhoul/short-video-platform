# syntax=docker/dockerfile:1
#
# User web app (Next.js 16, App Router).
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not `user/`:
#
#   docker build -f deploy/user.Dockerfile .
#
# `user/package.json` declares `@douyin-clone/shared-toast` and
# `@douyin-clone/upload-policy` as `file:../shared/...`, which resolve outside
# `user/` — a context of `user/` cannot see them and the install fails. Same
# constraint as the API image.
#
# WHY STANDALONE
#
# `next.config.js` sets `output: 'standalone'`, so Next traces the modules the
# server actually imports and emits a self-contained `server.js` beside them.
# Measured for this app: 25 MB of standalone output (18 MB of node_modules)
# plus 3 MB static and 3 MB public — against ~1.5 GB for the full dependency
# tree. On a 2 vCPU / 4 GB VM already running MongoDB, Redis, the API and the
# file server, that difference is the deployment.
#
# BUILD-TIME vs RUNTIME ENVIRONMENT — the part that is easy to get wrong
#
# `next.config.js` has an `env:` block, and that is Next's *build-time inlining*:
# each `process.env.X` reference is textually replaced with the value present
# when `next build` ran. So these must be passed as build args and are baked
# into the image:
#
#   NEXT_PUBLIC_API_ENDPOINT   also compiled into the browser bundle
#   NEXT_PUBLIC_SITE_URL       also compiled into the browser bundle
#   API_SERVER_ENDPOINT
#   SITE_URL
#   PROXY_API_TARGET           the rewrite destination, baked into routes-manifest
#
# Changing any of them requires a rebuild, not a restart. None is a secret.
#
# NEXTAUTH_SECRET is deliberately NOT a build arg. It was removed from the
# `env:` block precisely so it stays a runtime lookup; passing it here would
# bake the signing key into the image layers and make rotation a rebuild.
# It arrives as an ordinary container environment variable. Same for
# NEXTAUTH_URL / NEXTAUTH_URL_INTERNAL, which next-auth reads at runtime.

# ---------------------------------------------------------------- build stage
FROM node:22-bookworm-slim AS build

WORKDIR /repo

# The shared packages must exist before `yarn install`: Yarn v1 COPIES a `file:`
# dependency at install time rather than linking it.
COPY shared/ ./shared/

COPY user/package.json user/yarn.lock ./user/
WORKDIR /repo/user
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY user/ ./

ARG NEXT_PUBLIC_API_ENDPOINT
ARG NEXT_PUBLIC_SITE_URL
ARG API_SERVER_ENDPOINT
ARG SITE_URL
ARG PROXY_API_TARGET

ENV NEXT_PUBLIC_API_ENDPOINT=${NEXT_PUBLIC_API_ENDPOINT} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    API_SERVER_ENDPOINT=${API_SERVER_ENDPOINT} \
    SITE_URL=${SITE_URL} \
    PROXY_API_TARGET=${PROXY_API_TARGET} \
    NEXT_TELEMETRY_DISABLED=1

# Fail the build rather than ship an app pointing at localhost. Every one of
# these is compiled in, so a missing value is not recoverable at runtime — it
# produces a deployment whose browser bundle calls http://localhost:8080.
RUN test -n "$NEXT_PUBLIC_API_ENDPOINT" || (echo "NEXT_PUBLIC_API_ENDPOINT build arg is required" && exit 1) \
 && test -n "$NEXT_PUBLIC_SITE_URL"    || (echo "NEXT_PUBLIC_SITE_URL build arg is required" && exit 1) \
 && test -n "$PROXY_API_TARGET"        || (echo "PROXY_API_TARGET build arg is required" && exit 1)

# `.dockerignore` keeps every `.env` out of the context, so the build sees only
# the args above. Next copies a `.env` into the standalone output when one is
# present, so this is also what stops a developer's local environment — and its
# NEXTAUTH_SECRET — from being baked into a production image.
RUN yarn build && rm -f dist/.next/standalone/.env

# -------------------------------------------------------------- runtime stage
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8081 \
    HOSTNAME=0.0.0.0

# `tini` so PID 1 reaps children and forwards SIGTERM: without it Docker's stop
# signal is ignored and the container is SIGKILLed ten seconds later, dropping
# in-flight SSR requests. `curl` is for the healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Standalone puts `server.js` at its root because `outputFileTracingRoot` is the
# app directory, and nests the server files under `dist/.next/` (the custom
# distDir). Static assets and `public/` are NOT traced by Next and must be
# copied alongside, at the paths the standalone server expects.
COPY --from=build --chown=node:node /repo/user/dist/.next/standalone ./
COPY --from=build --chown=node:node /repo/user/dist/.next/static ./dist/.next/static
COPY --from=build --chown=node:node /repo/user/public ./public

USER node

EXPOSE 8081

# Liveness only, and deliberately not a page that calls the API: a healthcheck
# that depends on the backend turns an API blip into a restart loop of a front
# end that was serving fine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS -o /dev/null http://127.0.0.1:8081/ || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
