---
name: web-seo
description: Next.js App Router metadata and indexability rules for public Douyin Clone pages. Use when adding page titles, descriptions, canonicals, robots directives, Open Graph data, or dynamic metadata.
---

# User App SEO

## Rules

- Give every route an intentional title.
- Use `generateMetadata` when metadata depends on route data; otherwise use static `metadata`.
- Do not export both in the same route segment.
- Index only public pages that provide useful public content.
- Keep auth, private publishing, account, and utility pages `noindex`.
- Build metadata from public-safe DTO fields.
- Use the canonical site URL from current configuration rather than hardcoded deployment domains.

## Current References

- `user/src/app/layout.tsx`
- `user/src/app/(public)/(main)/post/[id]/page.tsx`
- `user/src/app/(public)/`
- `user/src/app/(private)/`

## Verification

- Check title, description, canonical, robots, Open Graph fallback, missing entity, and private-page behavior.
- Run targeted user tests, `yarn lint`, and `yarn build`.
