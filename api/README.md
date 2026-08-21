# API Service

Core REST API and business logic for the Douyin Clone platform: authentication, users and creator
profiles, posts and feeds, comments, reactions, follows, notifications, search, system settings, and
logging.

Built with NestJS 10, MongoDB/Mongoose, Redis + BullMQ, and Socket.IO.

| Item | Value |
| --- | --- |
| Package | `douyin-clone-api` |
| Default port | `8080` (`HTTP_PORT`) |
| Node | `>= 22` |
| API docs | `http://localhost:8080/apidocs` (only when `NODE_ENV=development`) |

## Routing Model

The API does **not** use a global route prefix. Controllers are mounted at the root, for example
`/auth/login`, `/posts`, `/users`, `/creator/posts`, `/admin/settings`.

The `user/` and `admin/` apps call `/api/v1/*` and their Next.js rewrites strip that prefix before
forwarding, so `/api/v1/posts` in the browser reaches `/posts` here. See
[user/src/PROXY_SETUP.md](../user/src/PROXY_SETUP.md).

Controller filenames are aligned with their route prefix:

| Audience | File pattern | Route prefix |
| --- | --- | --- |
| Admin | `admin-*.controller.ts` | `/admin/...` |
| Creator | `creator-*.controller.ts` | `/creator/...` |
| Public / normal user | plain feature name | `/posts`, `/users`, `/search`, ... |

## Project Structure

The API is organized by domain. Controllers, services, DTOs, payloads, schemas, listeners, and jobs
mirror the same domain names.

```text
src/
├── controllers/            # HTTP adapters only
│   ├── community/          # notifications, social interactions
│   ├── content/            # posts (public + creator), content files, search
│   ├── identity/           # auth, users, admin users, identity files
│   └── system/             # settings (public + admin), setting file uploads
├── services/               # business logic and orchestration
│   ├── community/          # comment, follow, notification, reaction, permissions
│   ├── content/            # post crud/media/search/statistics, tags, search
│   ├── identity/           # auth, tokens, user, creator analytics, user search
│   ├── shared/file-server/ # HTTP client for the file server
│   ├── socket/             # presence, post rooms, stat coalescing
│   └── system/setting/     # settings
├── dtos/                   # response shapes (the privacy boundary)
├── payloads/               # validated controller inputs
├── schemas/                # Mongoose schemas
├── listeners/              # queue/event adapters
├── jobs/                   # scheduled and background work (BullMQ)
├── gateways/socket/        # Socket.IO gateway
├── kernel/                 # shared framework pieces (SearchRequest, guards, etc.)
├── common/                 # exceptions, utils, adapters, logging
├── config/                 # typed configuration
└── migrations/             # timestamped MongoDB migrations
```

### Domain Descriptions

- **identity** — authentication, tokens, user accounts, creator profiles, admin user management.
- **content** — posts, post media, feeds and recommendations, tags, search, content file ownership.
- **community** — comments and replies, reactions, follows, notifications.
- **system** — system settings and log viewers.
- **shared/socket** — file-server integration and real-time presence used across domains.

Domains that are not implemented (payments, subscriptions, messaging, streaming) do not exist here
and must not be added speculatively.

## Requirements

- Node.js 22+
- Yarn
- MongoDB (application data + a separate logger database)
- Redis (BullMQ queues, Socket.IO adapter, caching)
- A running [file server](../file-server/README.md) for any upload flow

FFmpeg and Sharp are **not** used by this service; media processing lives in `file-server/`.

## Setup

```bash
yarn install
cp .env.example .env
```

### Environment

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` also enables Swagger at `/apidocs` |
| `HTTP_PORT` | HTTP port (default `8080`) |
| `MONGO_URI` | Application database |
| `LOGGER_MONGO_URI` | Database used by the log viewers |
| `BASE_URL` | Public base URL of this service |
| `REDIS_QUEUE_*` | Redis host/port/db/credentials for BullMQ and sockets |
| `FILE_SERVER_BASE_URL` | File server base URL (default `http://localhost:8000`) |
| `FILE_SERVER_API_KEY` | Sent as `X-API-Key`; must match the file server `API_SECRET_KEY` |
| `FILE_SERVER_JWT_SECRET` | Loaded into config but not currently used by any API code path — the file server signs upload tokens itself with its own `JWT_SECRET`. Keep the two matching. |
| `INTERNAL_API_KEY` | Sent as `X-Internal-API-Key`; the file server enforces it as the second factor on `/internal/files/*`, so it must match that service's `INTERNAL_API_KEY` |
| `CORS_ORIGIN` | Comma-separated allowed origins; unset means `*` |

Optional tuning: `MONGO_*` pool settings, `FILE_SERVER_TIMEOUT`, `LOG_LEVELS`.

Generate secrets locally and never commit them:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Migrations

Migrations seed system settings, create/reset the admin account, and backfill data. They use a
Mongo-backed state store with a lock, so they are safe to run from a single node in a cluster.

```bash
yarn migrate                       # run pending migrations
yarn migrate:create <description>  # scaffold a new timestamped migration
```

`create-admin-account` runs `scripts/reset-admin-pw.js`, which creates (or resets) a `superadmin`
account with the default password `adminadmin` so the admin app can be signed into locally. Change it
before exposing an environment to anyone else.

## Running

```bash
yarn start:dev   # watch mode
yarn start       # single run
yarn build       # compile to dist/
```

## Testing

Jest unit tests live beside the service under test with a `.spec.ts` suffix. MongoDB, Redis, queues,
and remote services are mocked at the unit boundary, so no infrastructure is required.

```bash
yarn test                          # all unit tests (runInBand)
yarn test src/services/content     # focused run
yarn test:cov                      # coverage
```

There is **no** `lint` script and **no** e2e suite in this package. Before finishing an API change,
run `yarn test` then `yarn build`.

## Maintenance Scripts

`scripts/` holds one-off operational scripts run with `node`, including
`audit-post-comment-counts.js` (counter drift audit), `migrate-settings.js`, and
`reset-admin-pw.js`. Counter-repair scripts are dry-run by default — read the script header before
running one against a real database.

## Further Reading

- [`AGENTS.md`](./AGENTS.md) — working rules for this app
- [`../.agents/rules/api.md`](../.agents/rules/api.md) — layering, payload/DTO, error, and queue rules
- [`../docs/architecture.md`](../docs/architecture.md) — system architecture
- [`../docs/domains/`](../docs/domains/) — domain documentation
- [`../docs/features/`](../docs/features/) — implemented feature documentation
