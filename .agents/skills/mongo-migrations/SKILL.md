---
name: mongo-migrations
description: Timestamped MongoDB migrations for Douyin Clone. Use when changing persistent schema shape, backfilling data, adding indexes, or seeding system settings through api/migrations.
---

# Mongo Migrations

Use the migration runner already configured by `api/package.json`.

## Location And Naming

- Put migrations directly under `api/migrations/`.
- Use a timestamped filename such as `<timestamp>-<short-description>.js`.
- Put reusable seed data under `api/migrations/data/` when an existing migration imports it.

## Rules

- Make `up` safe to run against real existing data.
- Implement a meaningful `down` when rollback is safe; otherwise document why rollback is intentionally limited.
- Backfill before making application code depend on a new field.
- Build indexes explicitly and use stable names.
- Avoid loading an unbounded collection into memory.
- Do not invent a second migration layout under an API scripts directory.

## Current References

- `api/migrations/1735228800000-settings.js`
- `api/migrations/1756258634605-create-admin-account.js`
- `api/migrations/data/site-settings.js`
- migration scripts in `api/package.json`

## Verification

- Review behavior on empty, partially migrated, and already migrated data.
- Run the migration in an appropriate local environment only when credentials and rollback are safe.
- Run `yarn build` in `api/`.
