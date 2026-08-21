---
name: web-ssr
description: Next.js App Router server-side request context for the Douyin Clone user app. Use when a server page, layout, or generateMetadata function calls the API with session, cookies, forwarded IP, or request headers.
---

# User App SSR

Reuse the current request helper and nearest server-rendered page rather than calling Axios with an ad hoc context.

## Rules

- Forward only headers required by the API.
- Preserve authentication cookies/session data for private server requests.
- Forward client IP information consistently with the deployed proxy contract.
- Use public-safe data for public pages and metadata.
- Do not leak tokens or private DTO fields into client props or generated metadata.
- Keep request-specific data out of cross-request global caches.

## Current References

- `user/src/services/api-request.ts`
- `user/src/lib/auth-options.ts`
- `user/src/app/(public)/(main)/post/[id]/page.tsx`

## Verification

- Check anonymous SSR, authenticated SSR, missing/expired session, forwarded headers, and safe serialization.
- Run targeted user tests, `yarn lint`, and `yarn build`.
