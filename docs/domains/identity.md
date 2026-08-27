---
title: Identity Domain
description: Authentication, user accounts, public profiles, and admin role management.
audience: [user, creator, admin, developer-agent]
domain: identity
status: active
updated: 2026-08-26
tags: [auth, user, profile, admin]
---

# Identity Domain

## Current model

The backend has two authorization roles: `user` and `admin`. “Creator” is a product/UI term for a user who owns a public profile and posts; it is not a separate role constant.

User lifecycle statuses are `active`, `inactive`, `under-review`, and `deleted`. Public profile lookup rejects deleted accounts and restricts unavailable accounts.

## Authentication

- User and admin apps use NextAuth credentials providers.
- The API authenticates email/password through `POST /auth/login`.
- Public self-registration is available through `POST /auth/register` (2026-08-26). It shares `UserAccountManagementService.createNewUserAccount` with the admin create-user route, always assigns a normal, active, unverified-email account, and never accepts a role, status, or internal flag from the client. `POST /admin/users` is unchanged and still admin-only.
- The user web app has no login page: a shared login/signup dialog opens over the current route. See `docs/features/authentication.md`.
- Passwords are hashed with scrypt (`PasswordHasherService`, format `scrypt$v=1$...`) as of 2026-08-26. Pre-migration salted-SHA256 credentials are verified with the old algorithm at login and re-hashed on success; nobody is asked to reset a password. The `auth` collection has a unique index on `{ userId, type }` and `createAuthPassword` is a single atomic upsert.
- Session callbacks retain API access/refresh tokens.
- Logout endpoints exist for authenticated, security, and public cleanup paths.
- No password-reset API, email-verification workflow, 2FA, or configured OAuth provider is currently shipped.

## Profiles

Authenticated users can read their own profile, update profile fields/password, upload an avatar, and upload a creator cover. Public profiles resolve by username. Content creation requires an active account with a verified email; admins bypass that check.

## Admin operations

Admins can search/create/update/delete users, update avatars, view user details, adjust balance fields, list admins, and toggle the admin role. Create-user persists the chosen account status (2026-08-26); it was previously discarded and forced to `active`.

## Main API routes

- `POST /auth/login`
- `POST /auth/register`
- `PUT /admin/auth/user/password` (registered 2026-08-26; previously written but unrouted)
- `GET /users/friends` (mutual-follow list)
- `POST /auth/logout`, `/auth/logout/security`, `/auth/logout/public`
- `GET /users/me`
- `GET /users/:username`
- `PUT /users/manager`, `/users/cover`, `/users/me/avatar`
- `/admin/users...`
- `/admin/permissions...`
- `PUT /admin/auth/user/password`
