---
name: api-payload
description: Request payload class conventions for the Douyin Clone NestJS API. Use when adding or changing body, query, or structured parameter input with class-validator and class-transformer.
---

# API Payloads

## Rules

- Put request classes under `api/src/payloads/<domain>/`.
- Use explicit `Create`, `Update`, `Search`, or action-oriented names.
- Extend `SearchRequest` for searchable or paginated input.
- Keep coercion, trimming, defaults, and validation decorators in the payload class.
- Use optional decorators only when omission is genuinely supported.
- Do not reuse response DTOs as request payloads.
- Keep controllers typed to payload classes instead of loose objects.

## Current References

- `api/src/payloads/content/post/`
- `api/src/payloads/identity/user/`
- `api/src/payloads/system/setting/setting-update.payload.ts`
- `api/src/kernel/common/search-request.ts`

## Verification

- Check valid input, missing required input, wrong types, boundary values, and unknown/optional fields.
- Run `yarn build` in `api/`.
