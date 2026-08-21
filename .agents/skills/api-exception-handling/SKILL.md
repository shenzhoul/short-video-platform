---
name: api-exception-handling
description: Exception and translated error patterns for the Douyin Clone NestJS API. Use when adding service errors, mapping missing resources, choosing HTTP status behavior, or changing user-facing API error messages.
---

# API Exception Handling

Inspect `api/src/common/exceptions/`, `api/src/utils/translation.ts`, and the nearest service before adding a new exception.

## Rules

- Throw domain errors from services; keep controllers focused on transport.
- Use the existing exception hierarchy for predictable HTTP status and response shape.
- Return a not-found exception for missing resources instead of a raw `Error`.
- Use `__t` for user-facing text and add the locale key in the same change.
- Do not expose provider errors, stack traces, secrets, or internal database details.
- Preserve the original error as internal logging context when it is safe to do so.

## Current References

- `api/src/kernel/exceptions/runtime.exception.ts`
- `api/src/kernel/exceptions/entity-not-found.exception.ts`
- `api/src/utils/translation.ts`
- `api/src/services/identity/auth/auth.service.ts`

## Verification

- Cover the success path, expected domain error, missing resource, and unexpected dependency failure.
- Confirm error status and public message.
- Run `yarn build` in `api/`.
