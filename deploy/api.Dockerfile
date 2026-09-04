# syntax=docker/dockerfile:1
#
# API image.
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not `api/`:
#
#   docker build -f deploy/api.Dockerfile .
#
# That is not a preference. `api/package.json` declares
# `"@douyin-clone/upload-policy": "file:../shared/upload-policy"`, which resolves
# outside the `api/` directory — a build context of `api/` cannot see it and the
# install fails. `deploy/docker-compose.yml` sets the context accordingly.

# ---------------------------------------------------------------- build stage
FROM node:22-bookworm-slim AS build

WORKDIR /repo

# The shared package must be present *before* `yarn install`, because Yarn v1
# copies a `file:` dependency at install time rather than linking it.
COPY shared/ ./shared/

COPY api/package.json api/yarn.lock ./api/
WORKDIR /repo/api
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY api/ ./
RUN yarn build

# Drop dev dependencies from the tree that gets copied into the runtime image.
RUN yarn install --frozen-lockfile --production --network-timeout 600000

# -------------------------------------------------------------- runtime stage
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

# `tini` so PID 1 reaps children and forwards SIGTERM. Without it the graceful
# shutdown handler in `main.ts` is never reached: Docker's stop signal goes to a
# shell that ignores it, and the container is SIGKILLed ten seconds later with
# in-flight requests dropped and Redis connections left open.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /repo/api/node_modules ./node_modules
COPY --from=build /repo/api/dist ./dist
COPY --from=build /repo/api/package.json ./package.json
# Locale files are genuinely read from disk. `app.module.ts` resolves them
# against `process.cwd()/i18n` first, and WORKDIR is /app, so this path is the
# one it finds. Email templates need no COPY: they are TypeScript modules
# imported through `src/templates/emails`, so `nest build` has already compiled
# them into dist/. (`TEMPLATE_DIR` in main.ts points at a directory that does
# not exist and is read by nothing — vestigial, left alone here.)
COPY --from=build /repo/api/i18n ./i18n

# The migration runner ships with the image so migrations execute against the
# same code that is being deployed, via `docker compose run --rm api yarn migrate`.
COPY --from=build /repo/api/migrations ./migrations
COPY --from=build /repo/api/migrate.js ./migrate.js
# `demo/` is included so the dataset can be seeded from the deployed image; its
# production guards refuse to run without an explicit opt-in.
COPY --from=build /repo/api/demo ./demo

# `scripts/` is NOT optional tooling — the migration runner reaches into it.
#
#   1735228800000-settings.js          require('../scripts/migrate-settings')
#   1756258634605-create-admin-account require('../scripts/reset-admin-pw')
#   1787810000000-auth-token-ttl       execFileSync(.../scripts/repair-auth-token-ttl-index.js)
#
# The third is spawned as a CHILD PROCESS by path, so it is invisible to any
# require-graph analysis and to the load check below. Copying the whole 284 KB
# directory rather than the three named files is deliberate: a future migration
# that reaches for another script would otherwise fail in production, and the
# audit/repair scripts are worth having on the box for diagnostics anyway.
COPY --from=build /repo/api/scripts ./scripts

# Fail the BUILD if a migration cannot be loaded, rather than discovering it
# against a production database halfway through a run.
#
# This exists because the omission above shipped: `migrations/` was copied but
# `scripts/` was not, so `node migrate.js` died on MODULE_NOT_FOUND at the first
# migration. Requiring each module opens no connection -- `migrations/lib`
# exports `mongoose.connection`, which is an unconnected object until something
# calls `connect()`.
RUN node -e "const fs=require('fs');const m=fs.readdirSync('migrations').filter(f=>f.endsWith('.js'));m.forEach(f=>require('/app/migrations/'+f));const s=fs.readdirSync('scripts').filter(f=>f.endsWith('.js'));if(!s.length)throw new Error('scripts/ is empty');console.log('migration load check: '+m.length+' migrations, '+s.length+' scripts');"

# Never run as root. The image writes nothing outside /tmp.
USER node

EXPOSE 8080

# Liveness only — it must not depend on Mongo or Redis. A readiness failure
# should take this container out of rotation, not restart it in a loop while the
# database it is waiting for is already under strain. The proxy polls
# /health/ready separately for that.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
