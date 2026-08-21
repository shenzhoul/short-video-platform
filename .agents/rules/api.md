# API Rules

These rules apply to `api/` and to equivalent NestJS code in `file-server/`.

## Layering

- Keep controllers, listeners, gateways, and jobs limited to transport or scheduling concerns.
- Put business rules, database access, and orchestration in services.
- Enforce feature-specific authorization in services even when guards provide coarse authentication or role checks.
- Validate permissions and invariants before mutation.

## Naming And Routes

- Use lowercase kebab-case filenames and camelCase TypeScript members.
- Group controllers and services by the current domains: `community`, `content`, `identity`, and `system`.
- Align audience-specific controller names and route prefixes:
  - `admin-*.controller.ts` for `/admin/...`
  - `creator-*.controller.ts` for `/creator/...`
  - plain feature names for public or normal user routes
- Do not introduce domain folders for features that are not implemented.

## Payloads And DTOs

- Define payload classes for body, query, and structured path input.
- Extend `api/src/kernel/common/search-request.ts` for searchable and paginated endpoints.
- Keep normalization and `class-validator`/`class-transformer` behavior in payloads rather than controllers.
- Return DTOs from controller-facing services; do not expose Mongoose documents.
- Treat DTO mapping as the privacy boundary and use explicit public, private, or admin shapes when audiences differ.

## Errors And Translation

- Use the exception hierarchy under `api/src/common/exceptions/`.
- Return not-found errors for missing resources rather than leaking raw errors as HTTP 500 responses.
- Use `__t` from `api/src/utils/translation.ts` for user-facing API messages and keep locale keys synchronized.
- Validate ObjectId-only route parameters with the existing ObjectId parsing pattern.

## Data, Settings, And Migrations

- Keep migrations in `api/migrations/`; use the existing timestamped migration runner.
- Seed system settings through the existing settings migration/data files and expose them through `SettingService`.
- Add indexes for new recurring query patterns.
- Default optional numeric fields before using them in a counter delta. An absent field makes the delta `NaN`, and `$max: [0, NaN]` resolves to `0` — silently destroying the counter instead of failing. When a counter can already be wrong in stored data, ship a dry-run-by-default maintenance script under `api/scripts/` rather than recomputing on the read path.
- Paginate list endpoints and avoid queries inside loops.
- Never give an indexed optional field a `default: null`. Mongoose then persists
  the field on **every** document, and a `unique + sparse` index skips only
  documents where the field is *missing* — an explicit `null` is still indexed, so
  the second document written collides with the first. Leave the field with no
  default so it is omitted, and prefer a **partial** index
  (`partialFilterExpression: { field: { $type: 'string' } }`) over `sparse` when
  the constraint should apply to a subset. Do not combine the two.
- Changing an existing index's options is not something `autoIndex` can do:
  `createIndex` fails with a conflict against the old definition. Ship a repair
  script that drops and recreates it, and verify the runtime index matches the
  schema declaration rather than assuming boot reconciled them.
- Catch a duplicate-key error narrowly. `error.code === 11000` alone says nothing
  about *which* index; check `error.keyPattern.<field>` before treating a
  collision as an idempotent no-op, or an unrelated conflict gets reported as
  success.

## Queues And Sockets

- Put jobs under `api/src/jobs/<domain>/`.
- Use `QueueService` for workers, recurring jobs, and delayed work.
- Use `QueueMessageService` for distributed event fan-out.
- Use `SocketUserService` and the current socket gateway/provider flow for online presence and socket delivery.
- Load the corresponding queue, scheduled-job, or WebSocket skill before editing these flows.
- Load `.agents/skills/direct-messaging/SKILL.md` before touching conversation, message, messaging-permission, or block/restrict code.
- Load `.agents/skills/post-sharing/SKILL.md` before touching share endpoints, shared-post messages, or `totalShare`.
- `nest build` succeeding proves nothing about dependency injection. A provider that is exported but missing from the `appProviders` array compiles cleanly and then fails at boot with "Nest can't resolve dependencies". After adding a service, start the app once and confirm it reaches "Nest application successfully started".

## Verification

- `api/package.json` exposes Jest unit tests and build scripts; run `yarn test`, then `yarn build`.
- `file-server/package.json` exposes `lint` and `build` but no test script; run `yarn lint` and `yarn build`.
- Put focused unit tests beside the service under test with a `.spec.ts` suffix. Mock MongoDB, Redis, queues, and remote services at the unit boundary.
