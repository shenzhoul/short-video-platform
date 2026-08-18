---
title: Credentials Authentication
description: Current user/admin credentials login, session, and logout behavior.
audience: [user, admin, developer-agent]
domain: identity
status: active
updated: 2026-07-31
tags: [authentication, nextauth, session]
---

# Credentials Authentication

## User flow

1. The user or admin opens the corresponding `/auth/login` page.
2. A NextAuth credentials provider sends credentials to `POST /auth/login`.
3. The API validates the password credential and account status, then returns user data and API tokens.
4. NextAuth stores token/session fields used by server and browser API clients.
5. Logout calls one of the API logout endpoints and clears the web session.

## Main implementation

- API: `api/src/controllers/identity/auth/login.controller.ts`, `logout.controller.ts`
- Business logic: `api/src/services/identity/auth/auth.service.ts`, `token.service.ts`
- User app: `user/src/lib/auth-options.ts`, `user/src/components/auth/login-form.tsx`
- Admin app: `admin/src/lib/auth-options.ts`, `admin/src/components/auth/login-form.tsx`

## Boundaries

- User and admin NextAuth configurations use credentials providers only.
- No public registration API, password-reset API, 2FA, or configured OAuth provider is shipped.
- The existing OAuth callback page is a utility route, not evidence of an enabled provider.
