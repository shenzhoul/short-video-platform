---
title: Pages and Routes
description: Implemented Next.js routes in the user and admin applications.
audience: [user, admin, developer-agent]
domain: cross
status: active
updated: 2026-08-04
tags: [routes, pages, user, admin]
---

# Pages and Routes

## User app

| Route | Access | Current purpose |
|---|---|---|
| `/` | Public | Home feed/landing entry |
| `/for-you` | Public | Recommended video feed |
| `/[creator]` | Public | Creator profile and posts |
| `/pip` | Public | Picture-in-picture player surface |
| `/auth/login` | Public | Credentials login |
| `/auth/logout` | Public | Logout confirmation |
| `/auth/oauth/callback/[provider]` | Public utility | Callback handler route; no OAuth provider is configured in NextAuth |
| `/creator/publish` | Authenticated | Publishing entry for video, graphics, VR, and article tabs |
| `/creator/publish/video` | Authenticated | Video publishing editor |
| `/creator/publish/image` | Authenticated | Graphics publishing editor |

Post details open in an in-place modal from the home feed or creator profile. Share links use `/?modal_id=<postId>` so the same modal can be restored without a standalone detail route.

## Admin app

| Route | Access | Current purpose |
|---|---|---|
| `/dashboard` | Admin | Admin landing dashboard |
| `/identity/users` | Admin | User list/search |
| `/identity/users/create` | Admin | Create a user |
| `/identity/users/update/[id]` | Admin | Edit a user |
| `/identity/users/admin-management` | Admin | Grant/revoke admin role |
| `/system/settings` | Admin | General site and maintenance settings |
| `/system/logger/audit-logs` | Admin | Audit log viewer |
| `/system/logger/request-logs` | Admin | Request log viewer |
| `/system/logger/http-exception-logs` | Admin | HTTP exception viewer |
| `/system/logger/system-logs` | Admin | System log viewer |
| `/account/settings` | Admin | Current admin account settings |
| `/auth/login`, `/auth/logout`, `/auth/forgot` | Public/admin auth | Admin authentication flows |

Only routes present in the `app/` trees are listed. Menu links without matching pages are tracked as code defects and are not treated as shipped features.
