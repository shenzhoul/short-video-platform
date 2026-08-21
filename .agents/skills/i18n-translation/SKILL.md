---
name: i18n-translation
description: API translation-key workflow for Douyin Clone. Use when adding or changing user-facing API messages, exceptions, validation feedback, or calls to the __t helper.
---

# I18n Translation

## Workflow

1. Find the nearest existing translation key and naming convention.
2. Add or update the key in every maintained API locale.
3. Call `__t` from `api/src/utils/translation.ts`.
4. Pass interpolation values as a named object.
5. Keep logs diagnostic, but keep API messages safe and user-oriented.

Do not hardcode a new user-facing service or controller message when it belongs in the locale catalog. Do not translate identifiers, log-only diagnostics, or protocol values.

## Current References

- `api/src/utils/translation.ts`
- `api/i18n/`
- `api/src/common/exceptions/`
- `api/src/services/identity/auth/auth.service.ts`

## Verification

- Search for the key in all locale files.
- Exercise interpolation and fallback behavior.
- Run `yarn build` in `api/`.
