---
title: Pages and Routes
description: Implemented Next.js routes in the user and admin applications.
audience: [user, admin, developer-agent]
domain: cross
status: active
updated: 2026-08-26
tags: [routes, pages, user, admin]
---

# Pages and Routes

## User app

| Route | Access | Current purpose |
|---|---|---|
| `/` | Public | Home feed/landing entry |
| `/for-you` | Public | Recommended video feed |
| `/[creator]` | Public | Creator profile and posts |
| `/following` | Authenticated | Feed from followed creators; renders `AuthRequiredGate` when signed out |
| `/friend` | Authenticated | Feed from friends (mutual follow); added 2026-08-26, was a 404 |
| `/pip` | Public | Picture-in-picture player surface |
| `/auth/login` | Retired | No page. The proxy redirects to `/?authModal=login`, which opens the shared auth dialog |
| `/auth/logout` | Retired | No page (removed 2026-08-26). The proxy redirects to `/`; the GET performs no logout |
| `/auth/oauth/callback/[provider]` | Public utility | Callback handler route; no OAuth provider is configured in NextAuth |
| `/creator/publish` | Authenticated | Publishing entry for video, graphics, VR, and article tabs |
| `/creator/publish/video` | Authenticated | Video publishing editor |
| `/creator/publish/image` | Authenticated | Graphics publishing editor |

Login and signup are a dialog, not a route (2026-08-26): every guarded action and guarded route opens `AuthModalProvider`'s dialog over the current URL. Authenticated routes render `AuthRequiredGate` instead of redirecting. See `docs/features/authentication.md`.

Post details open in an in-place modal from the home feed or creator profile. Share links use `/?modal_id=<postId>` so the same modal can be restored without a standalone detail route.

## Admin app

| Route | Access | Current purpose |
|---|---|---|
| `/dashboard` | Admin | Admin landing dashboard |
| `/identity/users` | Admin | User list/search |
| `/identity/users/create` | Admin | Create a user |
| `/identity/users/update/[id]` | Admin | Edit a user |
| `/identity/users/admin-management` | Admin | Grant/revoke admin role |
| `/content/categories` | Admin | Post category list, search, and disable |
| `/content/categories/create` | Admin | Create a post category |
| `/content/categories/update/[id]` | Admin | Rename, describe, reorder, or disable a post category |
| `/system/settings` | Admin | General site and maintenance settings |
| `/system/logger/audit-logs` | Admin | Audit log viewer |
| `/system/logger/request-logs` | Admin | Request log viewer |
| `/system/logger/http-exception-logs` | Admin | HTTP exception viewer |
| `/system/logger/system-logs` | Admin | System log viewer |
| `/account/settings` | Admin | Current admin account settings |
| `/auth/login`, `/auth/logout`, `/auth/forgot` | Public/admin auth | Admin authentication flows |

Only routes present in the `app/` trees are listed. Menu links without matching pages are tracked as code defects and are not treated as shipped features.
